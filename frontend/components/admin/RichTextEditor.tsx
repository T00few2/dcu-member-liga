'use client';

import { useEditor, EditorContent, Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';

const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px'];
const FONT_SIZE_LABELS: Record<string, string> = {
    '12px': 'Small',
    '14px': 'Normal',
    '16px': 'Medium',
    '18px': 'Large',
    '20px': 'XL',
    '24px': 'XXL',
};

const FontSize = Extension.create({
    name: 'fontSize',
    addGlobalAttributes() {
        return [
            {
                types: ['textStyle'],
                attributes: {
                    fontSize: {
                        default: null,
                        parseHTML: el => el.style.fontSize || null,
                        renderHTML: attrs => {
                            if (!attrs.fontSize) return {};
                            return { style: `font-size: ${attrs.fontSize}` };
                        },
                    },
                },
            },
        ];
    },
    addCommands() {
        return {
            setFontSize:
                (size: string) =>
                ({ chain }: { chain: any }) =>
                    chain().setMark('textStyle', { fontSize: size }).run(),
            unsetFontSize:
                () =>
                ({ chain }: { chain: any }) =>
                    chain().setMark('textStyle', { fontSize: null }).run(),
        };
    },
});

interface Props {
    onChange: (html: string) => void;
    disabled?: boolean;
}

export default function RichTextEditor({ onChange, disabled }: Props) {
    const editor = useEditor({
        extensions: [StarterKit, Underline, TextStyle, FontSize],
        content: '',
        editable: !disabled,
        onUpdate({ editor }) {
            onChange(editor.getHTML());
        },
    });

    if (!editor) return null;

    const currentFontSize =
        FONT_SIZES.find(s => editor.isActive('textStyle', { fontSize: s })) ?? '';

    const toolbarBtn = (active: boolean) =>
        `border border-border rounded px-2 py-1 text-sm leading-none transition-colors ${
            active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'
        } disabled:opacity-40`;

    return (
        <div>
            <div className="flex items-center gap-1 flex-wrap border border-border rounded-t-lg px-2 py-1.5 bg-muted/30 border-b-0">
                <button
                    type="button"
                    title="Bold"
                    disabled={disabled}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    className={toolbarBtn(editor.isActive('bold'))}
                >
                    <strong>B</strong>
                </button>
                <button
                    type="button"
                    title="Italic"
                    disabled={disabled}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    className={toolbarBtn(editor.isActive('italic'))}
                >
                    <em>I</em>
                </button>
                <button
                    type="button"
                    title="Underline"
                    disabled={disabled}
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                    className={toolbarBtn(editor.isActive('underline'))}
                >
                    <span className="underline">U</span>
                </button>

                <div className="w-px h-5 bg-border mx-1" />

                <select
                    title="Font size"
                    disabled={disabled}
                    value={currentFontSize}
                    onChange={e => {
                        const size = e.target.value;
                        if (size) {
                            (editor.chain().focus() as any).setFontSize(size).run();
                        } else {
                            (editor.chain().focus() as any).unsetFontSize().run();
                        }
                    }}
                    className="border border-border rounded px-1.5 py-1 text-sm bg-card text-foreground disabled:opacity-40"
                >
                    <option value="">Size</option>
                    {FONT_SIZES.map(s => (
                        <option key={s} value={s}>
                            {FONT_SIZE_LABELS[s]} ({s})
                        </option>
                    ))}
                </select>
            </div>

            <div className="border border-border rounded-b-lg min-h-48 px-3 py-2 text-sm bg-card focus-within:ring-1 focus-within:ring-primary">
                <EditorContent editor={editor} className="tiptap-editor" />
            </div>
        </div>
    );
}
