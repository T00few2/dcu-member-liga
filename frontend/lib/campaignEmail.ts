import { fromTimestamp } from '@/lib/formatDate';

export const RACE_ANNOUNCEMENT_SUBJECT = 'Kommende løb i DCU E-serien';
export const RACE_ANNOUNCEMENT_INTRO_HTML = '<p>Her er de kommende løb.</p>';

const SITE_URL = 'https://www.dansk-ecykling.dk';

export interface AnnouncementRace {
    name: string;
    date: string;
    routeName?: string;
    map?: string;
    laps?: number;
    totalDistance?: number;
}

export function publicSiteUrl(): string {
    const configured = process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;
    return configured.replace(/\/$/, '');
}

export function futureRaces<T extends { date: string }>(races: T[], now = Date.now()): T[] {
    return races
        .filter((race) => {
            const time = fromTimestamp(race.date)?.getTime();
            return Number.isFinite(time) && (time as number) > now;
        })
        .sort((a, b) => (fromTimestamp(a.date)?.getTime() ?? 0) - (fromTimestamp(b.date)?.getTime() ?? 0));
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function formatRaceWhen(date: string): string {
    const parsed = fromTimestamp(date);
    if (!parsed || Number.isNaN(parsed.getTime())) return 'Dato ukendt';
    return new Intl.DateTimeFormat('da-DK', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Copenhagen',
    }).format(parsed);
}

function raceDetail(race: AnnouncementRace): string {
    const parts: string[] = [];
    const route = (race.routeName || race.map || '').trim();
    if (route) parts.push(route);
    if (race.laps && race.laps > 0) {
        parts.push(race.laps === 1 ? '1 omgang' : `${race.laps} omgange`);
    }
    if (race.totalDistance && race.totalDistance > 0) {
        const km = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(race.totalDistance);
        parts.push(`${km} km`);
    }
    return parts.join(' · ');
}

function raceBlock(race: AnnouncementRace): string {
    const detail = raceDetail(race);
    const detailRow = detail
        ? `<div style="margin-top:4px;font-size:14px;line-height:1.4;color:#374151;">${escapeHtml(detail)}</div>`
        : '';
    return `<tr><td style="padding:0 32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;">
<div style="font-size:13px;line-height:1.4;color:#6b7280;">${escapeHtml(formatRaceWhen(race.date))}</div>
<div style="margin-top:2px;font-size:18px;line-height:1.3;font-weight:bold;color:#111827;">${escapeHtml(race.name || 'Løb')}</div>
${detailRow}
</td></tr>
</table>
</td></tr>`;
}

export function buildRaceAnnouncementHtml(options: {
    siteUrl: string;
    introHtml: string;
    races: AnnouncementRace[];
}): string {
    const siteUrl = options.siteUrl.replace(/\/$/, '');
    const logoUrl = `${siteUrl}/brand/dcu-e-serien-logo-white.png`;
    const scheduleUrl = `${siteUrl}/schedule`;
    const intro = options.introHtml.trim();
    const introRow = intro
        ? `<tr><td style="padding:4px 32px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111827;">${intro}</td></tr>`
        : '';

    return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;">
<tr><td align="center" bgcolor="#111827" style="background:#111827;padding:28px 24px;">
<img src="${escapeHtml(logoUrl)}" alt="DCU E-serien" width="220" style="display:block;margin:0 auto;border:0;width:220px;height:auto;">
</td></tr>
<tr><td style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.4;color:#111827;">Hej $[FNAME|]$</td></tr>
${introRow}
${options.races.map(raceBlock).join('\n')}
<tr><td align="center" style="padding:8px 32px 28px;">
<a href="${escapeHtml(scheduleUrl)}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1;padding:14px 22px;border-radius:6px;">Se programmet</a>
</td></tr>
<tr><td style="padding:0 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#374151;">Venlig hilsen<br><br>DCU Udvalg for e-cykling</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
