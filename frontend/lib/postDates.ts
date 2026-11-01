// Danish time on both the server and in the browser, so a post published late in the evening
// shows the same date wherever the page is drawn.
const TIME_ZONE = 'Europe/Copenhagen';

export function formatPostDate(iso: string): string {
    return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
}

export function formatCommentDateTime(iso: string): string {
    return new Date(iso).toLocaleString('da-DK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
}
