import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    Timestamp,
    increment,
    writeBatch,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { Post, Comment } from '@/types/posts';
import { API_URL } from './api';

function tsToString(ts: unknown): string {
    if (ts instanceof Timestamp) return ts.toDate().toISOString();
    if (typeof ts === 'string') return ts;
    return new Date().toISOString();
}

function normalizePost(id: string, data: Record<string, unknown>): Post {
    return {
        id,
        title: String(data.title ?? ''),
        slug: String(data.slug ?? ''),
        coverImageUrl: data.coverImageUrl ? String(data.coverImageUrl) : null,
        body: (data.body as Post['body']) ?? { type: 'doc', content: [] },
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        status: data.status === 'published' ? 'published' : 'draft',
        authorUid: String(data.authorUid ?? ''),
        authorName: String(data.authorName ?? ''),
        publishedAt: data.publishedAt ? tsToString(data.publishedAt) : null,
        createdAt: tsToString(data.createdAt),
        updatedAt: tsToString(data.updatedAt),
        commentCount: Number(data.commentCount ?? 0),
    };
}

function normalizeComment(id: string, data: Record<string, unknown>): Comment {
    return {
        id,
        postId: String(data.postId ?? ''),
        uid: String(data.uid ?? ''),
        displayName: String(data.displayName ?? 'Anonym'),
        body: String(data.body ?? ''),
        createdAt: tsToString(data.createdAt),
        parentId: data.parentId ? String(data.parentId) : null,
        reported: Boolean(data.reported),
    };
}

export async function getLatestPublishedPost(): Promise<Post | null> {
    const q = query(
        collection(db, 'posts'),
        where('status', '==', 'published'),
        orderBy('publishedAt', 'desc'),
        limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return normalizePost(d.id, d.data() as Record<string, unknown>);
}

export async function getPublishedPosts(): Promise<Post[]> {
    const q = query(
        collection(db, 'posts'),
        where('status', '==', 'published'),
        orderBy('publishedAt', 'desc'),
        limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => normalizePost(d.id, d.data() as Record<string, unknown>));
}

export async function getAllPosts(): Promise<Post[]> {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => normalizePost(d.id, d.data() as Record<string, unknown>));
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
    const q = query(collection(db, 'posts'), where('slug', '==', slug), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return normalizePost(d.id, d.data() as Record<string, unknown>);
}

export async function getPostById(id: string): Promise<Post | null> {
    const snap = await getDoc(doc(db, 'posts', id));
    if (!snap.exists()) return null;
    return normalizePost(snap.id, snap.data() as Record<string, unknown>);
}

export interface PostInput {
    title: string;
    slug: string;
    coverImageUrl: string | null;
    body: Post['body'];
    tags: string[];
    status: 'draft' | 'published';
    authorUid: string;
    authorName: string;
}

export async function createPost(input: PostInput): Promise<string> {
    const now = serverTimestamp();
    const ref = await addDoc(collection(db, 'posts'), {
        ...input,
        commentCount: 0,
        publishedAt: input.status === 'published' ? now : null,
        createdAt: now,
        updatedAt: now,
    });
    return ref.id;
}

export async function updatePost(id: string, input: Partial<PostInput> & { publishedAt?: string | null }): Promise<void> {
    const existing = await getPostById(id);
    const becomingPublished = input.status === 'published' && existing?.status !== 'published';
    await updateDoc(doc(db, 'posts', id), {
        ...input,
        ...(becomingPublished ? { publishedAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
    });
}

export async function deletePost(id: string): Promise<void> {
    await deleteDoc(doc(db, 'posts', id));
}

export async function getComments(postId: string): Promise<Comment[]> {
    const q = query(
        collection(db, 'posts', postId, 'comments'),
        orderBy('createdAt', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => normalizeComment(d.id, { ...d.data(), postId } as Record<string, unknown>));
}

export async function addComment(postId: string, input: { uid: string; displayName: string; body: string; parentId: string | null }): Promise<string> {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_URL}/posts/${postId}/comments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
            displayName: input.displayName,
            body: input.body,
            parentId: input.parentId,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to add comment');
    }
    const data = await res.json();
    return data.id;
}

export async function reportComment(postId: string, commentId: string): Promise<void> {
    await updateDoc(doc(db, 'posts', postId, 'comments', commentId), { reported: true });
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', postId, 'comments', commentId));
    batch.update(doc(db, 'posts', postId), { commentCount: increment(-1) });
    await batch.commit();
}

export function generateSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 80);
}
