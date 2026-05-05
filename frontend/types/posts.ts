import { JSONContent } from '@tiptap/react';

export interface Post {
    id: string;
    title: string;
    slug: string;
    coverImageUrl: string | null;
    body: JSONContent;
    tags: string[];
    status: 'draft' | 'published';
    authorUid: string;
    authorName: string;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
    commentCount: number;
}

export interface Comment {
    id: string;
    postId: string;
    uid: string;
    displayName: string;
    body: string;
    createdAt: string;
    parentId: string | null;
    reported: boolean;
}
