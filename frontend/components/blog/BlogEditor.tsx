'use client';

import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useRef, useCallback } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';

interface Props {
    initialContent?: JSONContent;
    onChange: (content: JSONContent) => void;
    disabled?: boolean;
}

export default function BlogEditor({ initialContent, onChange, disabled = false }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const editor = useEditor({
        extensions: [
            StarterKit,
            Underline,
            Image.configure({ inline: false, allowBase64: false }),
            Link.configure({ openOnClick: false, autolink: true }),
            Placeholder.configure({ placeholder: 'Skriv dit indlæg her...' }),
        ],
        content: initialContent ?? '',
        editable: !disabled,
        onUpdate({ editor }) {
            onChange(editor.getJSON());
        },
    });

    const uploadImage = useCallback(async (file: File) => {
        if (!editor) return;
        const storageRef = ref(storage, `posts/images/${Date.now()}-${file.name}`);
        const snap = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snap.ref);
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    }, [editor]);

    const handleImagePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) uploadImage(file);
        e.target.value = '';
    }, [uploadImage]);

    const setLink = useCallback(() => {
        if (!editor) return;
        const prev = editor.getAttributes('link').href ?? '';
        const url = window.prompt('URL', prev);
        if (url === null) return;
        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }
    }, [editor]);

    if (!editor) return null;

    const btn = (active: boolean, title?: string) =>
        `border border-border rounded px-2 py-1 text-sm leading-none transition-colors ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'} disabled:opacity-40` + (title ? '' : '');

    return (
        <div>
            <div className="flex items-center gap-1 flex-wrap border border-border rounded-t-lg px-2 py-1.5 bg-muted/30 border-b-0">
                {/* Text style */}
                <button type="button" title="Fed" disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))}><strong>B</strong></button>
                <button type="button" title="Kursiv" disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))}><em>I</em></button>
                <button type="button" title="Understreget" disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive('underline'))}><span className="underline">U</span></button>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Headings */}
                <button type="button" title="Overskrift 2" disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))}>H2</button>
                <button type="button" title="Overskrift 3" disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(editor.isActive('heading', { level: 3 }))}>H3</button>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Lists */}
                <button type="button" title="Punktliste" disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))}>• Liste</button>
                <button type="button" title="Nummerliste" disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))}>1. Liste</button>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Block */}
                <button type="button" title="Citat" disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))}>❝</button>
                <button type="button" title="Kodeblok" disabled={disabled} onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={btn(editor.isActive('codeBlock'))}>{"</>"}</button>
                <button type="button" title="Horisontal linje" disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()} className={btn(false)}>—</button>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Link & Image */}
                <button type="button" title="Link" disabled={disabled} onClick={setLink} className={btn(editor.isActive('link'))}>🔗</button>
                <button type="button" title="Billede" disabled={disabled} onClick={() => fileInputRef.current?.click()} className={btn(false)}>🖼</button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />

                <div className="w-px h-5 bg-border mx-1" />

                {/* History */}
                <button type="button" title="Fortryd" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} className={btn(false)}>↶</button>
                <button type="button" title="Gentag" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} className={btn(false)}>↷</button>
            </div>

            <div className="border border-border rounded-b-lg min-h-96 px-4 py-3 text-sm bg-card focus-within:ring-1 focus-within:ring-primary blog-editor-content">
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
