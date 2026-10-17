import { fromTimestamp } from '@/lib/formatDate';
import { formatOmgangeDisplay } from '@/lib/raceLaps';
import type { Race } from '@/types/live';

export const RACE_ANNOUNCEMENT_SUBJECT = 'Næste løb i DCU E-serien';
export const RACE_ANNOUNCEMENT_INTRO_HTML = '<p>Her er det næste løb.</p>';

const SITE_URL = 'https://www.dansk-ecykling.dk';

export type AnnouncementRace = Pick<
    Race,
    'name' | 'date' | 'routeName' | 'map' | 'laps' | 'totalDistance' | 'totalElevation' | 'eventMode' | 'eventConfiguration' | 'raceGroups' | 'singleModeCategories'
>;

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

export function nextRaceSubject(name: string): string {
    const trimmed = name.trim();
    return trimmed ? `Næste løb: ${trimmed}` : RACE_ANNOUNCEMENT_SUBJECT;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parsedDate(date: string): Date | null {
    const parsed = fromTimestamp(date);
    if (!parsed || Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function formatRaceWhen(date: string): string {
    const parsed = parsedDate(date);
    if (!parsed) return 'Dato ukendt';
    return new Intl.DateTimeFormat('da-DK', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Copenhagen',
    }).format(parsed);
}

function formatStart(date: string): string {
    const parsed = parsedDate(date);
    if (!parsed) return '–';
    return new Intl.DateTimeFormat('da-DK', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Copenhagen',
        timeZoneName: 'short',
    }).format(parsed);
}

function formatKm(km: number): string {
    return `${new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(km)} km`;
}

function statCell(label: string, value: string): string {
    return `<td class="stat-tile" width="33%" align="center" bgcolor="#f8f8f8" style="background:#f8f8f8;padding:12px 8px;font-family:Arial,Helvetica,sans-serif;">
<div class="text-muted" style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#313131;">${escapeHtml(label)}</div>
<div class="text-main" style="margin-top:4px;font-size:16px;font-weight:bold;color:#212121;">${escapeHtml(value)}</div>
</td>`;
}

function raceCard(race: AnnouncementRace): string {
    const route = (race.routeName || '').trim();
    const map = (race.map || '').trim();
    const distance = race.totalDistance && race.totalDistance > 0 ? formatKm(race.totalDistance) : '–';
    const elevation = race.totalElevation && race.totalElevation > 0 ? `${Math.round(race.totalElevation)} m` : '–';
    const laps = formatOmgangeDisplay(race as Race);
    return `<tr><td style="padding:0 32px 16px;">
<table class="race-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e9e9e9;border-radius:8px;">
<tr><td style="padding:16px 16px 8px;font-family:Arial,Helvetica,sans-serif;">
<div class="text-accent" style="font-size:13px;font-weight:bold;color:#c00418;">${escapeHtml(formatRaceWhen(race.date))}</div>
<div class="text-main" style="margin-top:4px;font-size:22px;line-height:1.3;font-weight:bold;color:#212121;">${escapeHtml(race.name || 'Løb')}</div>
<div class="text-muted" style="margin-top:4px;font-size:14px;color:#313131;">Start: ${escapeHtml(formatStart(race.date))}</div>
</td></tr>
<tr><td style="padding:0 16px 12px;font-family:Arial,Helvetica,sans-serif;">
<div class="text-main" style="font-size:15px;font-weight:bold;color:#212121;">${escapeHtml(map || 'Rute følger')}</div>
<div class="text-muted" style="margin-top:2px;font-size:14px;color:#313131;">${escapeHtml(route || 'Rute følger')}</div>
</td></tr>
<tr><td style="padding:0 16px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
${statCell('Distance', distance)}
<td width="8"></td>
${statCell('Højdemeter', elevation)}
<td width="8"></td>
${statCell('Omgange', laps)}
</tr>
</table>
</td></tr>
</table>
</td></tr>`;
}

const DARK_STYLES = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .email-bg { background: #212121 !important; background-color: #212121 !important; }
  .email-card, .race-card { background: #313131 !important; background-color: #313131 !important; }
  .race-card { border-color: #4a4a4a !important; }
  .stat-tile { background: #3d3d3d !important; background-color: #3d3d3d !important; }
  .text-main, .text-main p, .text-main span, .text-main li { color: #f8f8f8 !important; }
  .text-muted, .text-muted p { color: #e7e3d6 !important; }
  .text-soft { color: #e9e9e9 !important; }
  .text-accent { color: #ff6b6b !important; }
  .email-btn, .email-btn span { background: #c00418 !important; color: #ffffff !important; }
}
[data-ogsc] .email-bg { background: #212121 !important; background-color: #212121 !important; }
[data-ogsc] .email-card, [data-ogsc] .race-card { background: #313131 !important; background-color: #313131 !important; }
[data-ogsc] .stat-tile { background: #3d3d3d !important; background-color: #3d3d3d !important; }
[data-ogsc] .text-main, [data-ogsc] .text-main p { color: #f8f8f8 !important; }
[data-ogsc] .text-muted { color: #e7e3d6 !important; }
[data-ogsc] .text-soft { color: #e9e9e9 !important; }
[data-ogsc] .text-accent { color: #ff6b6b !important; }
`;

export function buildRaceAnnouncementHtml(options: {
    siteUrl: string;
    introHtml: string;
    race: AnnouncementRace;
}): string {
    const siteUrl = options.siteUrl.replace(/\/$/, '');
    const logoUrl = `${siteUrl}/brand/dcu-e-serien-logo-white.png`;
    const homeUrl = `${siteUrl}/`;
    const intro = options.introHtml.trim();
    const introRow = intro
        ? `<tr><td class="text-main" style="padding:4px 32px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#212121;">${intro}</td></tr>`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>${DARK_STYLES}</style>
</head>
<body class="email-bg" bgcolor="#f3f4f6" style="margin:0;padding:0;background:#f3f4f6;">
<table class="email-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background:#f3f4f6;">
<tr><td class="email-bg" align="center" bgcolor="#f3f4f6" style="padding:24px 12px;background:#f3f4f6;">
<table class="email-card" role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;">
<tr><td class="email-header" align="center" bgcolor="#212121" style="background:#212121;padding:28px 24px;">
<img src="${escapeHtml(logoUrl)}" alt="DCU E-serien" width="220" style="display:block;margin:0 auto;border:0;width:220px;height:auto;">
</td></tr>
<tr><td class="text-main" style="padding:28px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.4;color:#212121;">Hej $[FNAME|]$</td></tr>
${introRow}
${raceCard(options.race)}
<tr><td align="center" style="padding:8px 32px 28px;">
<a class="email-btn" href="${escapeHtml(homeUrl)}" style="display:inline-block;background:#c00418;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1;padding:14px 22px;border-radius:6px;">Tilmeld dig</a>
</td></tr>
<tr><td class="text-soft" style="padding:0 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#313131;">Venlig hilsen<br><br>DCU Udvalg for e-cykling</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
