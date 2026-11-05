/**
 * The Code of Conduct is a Google Doc (the single source). The modal shows it in an iframe;
 * `/llms.txt` (read by the Discord help bot) includes its plain-text export.
 */
export const CODE_OF_CONDUCT_DOC_ID = '1lQE0w8ylJLoBscj6rgWZ4nGYqKbCsoin9HR4wBiF3V4';
export const CODE_OF_CONDUCT_PREVIEW_URL = `https://docs.google.com/document/d/${CODE_OF_CONDUCT_DOC_ID}/preview`;
export const CODE_OF_CONDUCT_EDIT_URL =
    `https://docs.google.com/document/d/${CODE_OF_CONDUCT_DOC_ID}/edit?tab=t.0#heading=h.epmyt5apdaf3`;
export const CODE_OF_CONDUCT_TEXT_URL = `https://docs.google.com/document/d/${CODE_OF_CONDUCT_DOC_ID}/export?format=txt`;

const MAX_CHARS = 20000;

/** The doc's text without the BOM, the underline separators and extra blank lines. */
export function cleanCodeOfConductText(raw: string): string {
    return raw
        .replace(/^﻿/, '')
        .replace(/\r\n/g, '\n')
        .replace(/^_{5,}\s*$/gm, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_CHARS);
}

/** Server-side: the current text (refreshed at most hourly), or null if the doc can't be read. */
export async function loadCodeOfConductText(): Promise<string | null> {
    try {
        const res = await fetch(CODE_OF_CONDUCT_TEXT_URL, { next: { revalidate: 3600 } });
        if (!res.ok) return null;
        const text = cleanCodeOfConductText(await res.text());
        return text || null;
    } catch {
        return null;
    }
}
