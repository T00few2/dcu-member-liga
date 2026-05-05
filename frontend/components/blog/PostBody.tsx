'use client';

import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';

interface Props {
    content: JSONContent;
}

export default function PostBody({ content }: Props) {
    const editor = useEditor({
        extensions: [StarterKit, Image],
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
