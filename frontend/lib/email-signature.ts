const SIGNATURE_MARKER = 'dcu udvalg for e-cykling';
const SIGNATURE_HTML = '<p>Venlig hilsen</p><p><br></p><p>DCU Udvalg for e-cykling</p>';

export function defaultDcuSignatureHtml(): string {
    return SIGNATURE_HTML;
}

export function withDcuSignature(messageHtml: string): string {
    const raw = messageHtml ?? '';
    if (raw.toLowerCase().includes(SIGNATURE_MARKER)) {
        return raw;
    }

    const trimmed = raw.trim();
    if (!trimmed) return SIGNATURE_HTML;

    return `${trimmed}<p><br></p>${SIGNATURE_HTML}`;
}
