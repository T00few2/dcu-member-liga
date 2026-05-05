'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { JSONContent } from '@tiptap/react';
import { createPost, generateSlug } from '@/lib/posts';
import { useAuth } from '@/lib/auth-context';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';

const BlogEditor = dynamic(() => import('@/components/blog/BlogEditor'), { ssr: false });

export default function NewPostPage() {
    const { user, isAdmin, loading: authLoading } = useAuth();
    const router = useRouter();

    const [title, setTitle] = useState('');
    const [slug, setSlug] = useState('');
    const [slugManual, setSlugManual] = useState(false);
    const [tags, setTags] = useState('');
    const [status, setStatus] = useState<'draft' | 'published'>('draft');
    const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
    const [coverUploading, setCoverUploading] = useState(false);
    const [body, setBody] = useState<JSONContent>({ type: 'doc', content: [] });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setTitle(val);
        if (!slugManual) setSlug(generateSlug(val));
    };

    const handleCoverUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setCoverUploading(true);
        try {
            const storageRef = ref(storage, `posts/covers/${Date.now()}-${file.name}`);
            const snap = await uploadBytes(storageRef, file);
            setCoverImageUrl(await getDownloadURL(snap.ref));
        } finally {
            setCoverUploading(false);
            e.target.value = '';
        }
    }, []);

    const handleSave = async (saveStatus: 'draft' | 'published') => {
        if (!user) return;
        if (!title.trim()) { setError('Titel er påkrævet.'); return; }
        if (!slug.trim()) { setError('Slug er påkrævet.'); return; }

        setSaving(true);
        setError('');
        try {
            await createPost({
                title: title.trim(),
                slug: slug.trim(),
                coverImageUrl,
                body,
                tags: tags.split(',').map(t => t.trim()).filter(Boolean),
                status: saveStatus,
                authorUid: user.uid,
                authorName: user.displayName ?? user.email ?? 'Admin',
            });
            router.push('/admin#nyheder');
        } catch (e) {
            setError('Kunne ikke gemme. Prøv igen.');
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    if (authLoading) return <div className="p-8 text-center">Loading...</div>;
    if (!isAdmin) return null;

    return (
        <div className="max-w-4xl mx-auto mt-8 px-4 pb-16">
            <div className="flex items-center gap-4 mb-6">
                <button onClick={() => router.back()} className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Tilbage</button>
                <h1 className="text-2xl font-bold text-foreground">Nyt indlæg</h1>
            </div>

            <div className="space-y-6">
                {/* Title */}
                <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Titel</label>
                    <input
                        type="text"
                        value={title}
                        onChange={handleTitleChange}
                        placeholder="Race Preview: ZRL R19 W4"
                        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>

                {/* Slug */}
                <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Slug</label>
                    <input
                        type="text"
                        value={slug}
                        onChange={e => { setSlug(e.target.value); setSlugManual(true); }}
                        placeholder="race-preview-zrl-r19-w4"
                        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                    />
                    <p className="text-xs text-muted-foreground mt-1">URL: /nyheder/{slug || '...'}</p>
                </div>

                {/* Tags */}
                <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Tags <span className="font-normal text-muted-foreground">(kommasepareret)</span></label>
                    <input
                        type="text"
                        value={tags}
                        onChange={e => setTags(e.target.value)}
                        placeholder="race-preview, zrl, sæson-19"
                        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>

                {/* Cover image */}
                <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Coverbillede</label>
                    {coverImageUrl ? (
                        <div className="relative">
                            <img src={coverImageUrl} alt="Cover" className="w-full max-h-48 object-cover rounded-lg border border-border" />
                            <button
                                onClick={() => setCoverImageUrl(null)}
                                className="absolute top-2 right-2 bg-card border border-border rounded px-2 py-1 text-xs hover:bg-muted transition-colors"
                            >
                                Fjern
                            </button>
                        </div>
                    ) : (
                        <label className="flex items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors text-sm text-muted-foreground">
                            {coverUploading ? 'Uploader...' : '+ Upload coverbillede'}
                            <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} disabled={coverUploading} />
                        </label>
                    )}
                </div>

                {/* Body */}
                <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Indhold</label>
                    <BlogEditor onChange={setBody} />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                    {error && <span className="text-sm text-destructive flex-1">{error}</span>}
                    <div className="flex gap-3 ml-auto">
                        <button
                            onClick={() => handleSave('draft')}
                            disabled={saving}
                            className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/60 disabled:opacity-50 transition-colors"
                        >
                            {saving && status === 'draft' ? 'Gemmer...' : 'Gem som kladde'}
                        </button>
                        <button
                            onClick={() => { setStatus('published'); handleSave('published'); }}
                            disabled={saving}
                            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                            {saving && status === 'published' ? 'Publicerer...' : 'Publicer'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
