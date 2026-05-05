'use client';

import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';

interface Props {
    content: JSONContent;
}

export default function PostBody({ content }: Props) {
    const editor = useEditor({
        extensions: [StarterKit, Underline, Image, Link],
        content,
        editable: false,
        immediatelyRender: false,
    });

    if (!editor) return null;

    return (
        <div className="blog-content">
            <EditorContent editor={editor} />
        </div>
    );
}
