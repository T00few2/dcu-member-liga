import {
    buildProfileSegmentIndex,
    matchSprintProfileSegment,
} from '@/components/races/SprintsByLap';
import { fromTimestamp } from '@/lib/formatDate';
import { formatOmgangeDisplay, getAllLapsValues } from '@/lib/raceLaps';
import { lapLengthKmFromElevation, tileProfileSegments } from '@/lib/routeProfileSegments';
import type { Race } from '@/types/live';

export const RACE_ANNOUNCEMENT_SUBJECT = 'Næste løb i DCU E-serien';
export const RACE_ANNOUNCEMENT_CLOSING_HTML = '<p>Er du allerede tilmeldt? Så er du klar. Ellers kan du stadig nå at melde dig.</p>';

const SITE_URL = 'https://www.dansk-ecykling.dk';

export type AnnouncementRace = Pick<
    Race,
    'name' | 'date' | 'routeName' | 'map' | 'laps' | 'totalDistance' | 'totalElevation' | 'eventMode' | 'eventConfiguration' | 'raceGroups' | 'singleModeCategories' | 'sprints'
>;

export interface AnnouncementProfileSegment {
    name: string;
    type: string;
    fromKm: number;
    toKm: number;
    direction?: string;
}

export interface AnnouncementProfile {
    distance: number[];
    altitude: number[];
    leadInDistance?: number;
    profileSegments?: AnnouncementProfileSegment[];
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

export function nextRaceSubject(name: string): string {
    const trimmed = name.trim();
    return trimmed ? `Næste løb: ${trimmed}` : RACE_ANNOUNCEMENT_SUBJECT;
}

function copenhagenPart(date: Date, type: Intl.DateTimeFormatPartTypes): string {
    return new Intl.DateTimeFormat('da-DK', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Europe/Copenhagen',
    }).formatToParts(date).find((part) => part.type === type)?.value ?? '';
}

export function raceAnnouncementIntroHtml(race: Pick<AnnouncementRace, 'date' | 'routeName' | 'map'>): string {
    const parsed = parsedDate(race.date);
    const route = (race.routeName || '').trim();
    const world = (race.map || '').trim();
    const place = route && world
        ? ` på ${escapeHtml(route)} i ${escapeHtml(world)}`
        : route
            ? ` på ${escapeHtml(route)}`
            : world
                ? ` i ${escapeHtml(world)}`
                : '';
    const opening = parsed
        ? `På ${copenhagenPart(parsed, 'weekday').toLocaleLowerCase('da-DK')} d. ${copenhagenPart(parsed, 'day')}. ${copenhagenPart(parsed, 'month').toLocaleLowerCase('da-DK')} køres næste afdeling i DCU E-Serien klokken ${copenhagenPart(parsed, 'hour')}.${copenhagenPart(parsed, 'minute')}${place}.`
        : `Næste afdeling i DCU E-Serien køres snart${place}.`;
    return `<p>${opening}</p>${RACE_ANNOUNCEMENT_CLOSING_HTML}`;
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

const PROFILE_BARS = 80;
const PROFILE_HEIGHT = 72;

interface SprintRow {
    name: string;
    count: number;
    lap?: number;
    direction?: string;
}

function sprintRows(race: AnnouncementRace): SprintRow[] {
    const grouped = race.eventMode === 'grouped' ? race.raceGroups?.[0]?.sprints : undefined;
    const configured = race.eventConfiguration?.[0]?.sprints;
    const single = race.singleModeCategories?.[0]?.sprints;
    const chosen = (grouped && grouped.length > 0)
        ? grouped
        : (configured && configured.length > 0)
            ? configured
            : (single && single.length > 0)
                ? single
                : race.sprints;
    return (chosen || [])
        .filter((sprint) => sprint?.name)
        .map((sprint) => ({
            name: sprint.name,
            count: sprint.count || 1,
            lap: sprint.lap,
            direction: sprint.direction,
        }));
}

function sprintLabel(sprint: SprintRow): string {
    const direction = (sprint.direction || '').trim().toLowerCase();
    return direction === 'reverse' ? `${sprint.name} Reverse` : sprint.name;
}

function profileSamples(profile: AnnouncementProfile): { km: number; altitude: number }[] {
    const count = Math.min(profile.distance.length, profile.altitude.length);
    if (count < 2) return [];
    const samples: { km: number; altitude: number }[] = [];
    for (let i = 0; i < PROFILE_BARS; i++) {
        const index = Math.min(count - 1, Math.floor((i * count) / PROFILE_BARS));
        samples.push({
            km: (profile.distance[index] ?? 0) / 1000,
            altitude: profile.altitude[index] ?? 0,
        });
    }
    return samples;
}

function profileMarkup(profile: AnnouncementProfile | null | undefined, sprints: SprintRow[]): string {
    if (!profile) return '';
    const samples = profileSamples(profile);
    if (samples.length < 2) return '';
    const altitudes = samples.map((sample) => sample.altitude);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const range = maxAlt - minAlt || 1;
    const maxKm = samples[samples.length - 1]?.km ?? 0;
    const sprintBands = (profile.profileSegments || []).filter((segment) => segment.type === 'sprint' || sprints.some((sprint) => sprint.name === segment.name));
    const bars = samples.map((sample, index) => {
        const nextKm = samples[index + 1]?.km ?? sample.km;
        const height = Math.max(4, Math.round(((sample.altitude - minAlt) / range) * (PROFILE_HEIGHT - 4)) + 4);
        const marked = sprintBands.some((segment) => {
            const from = Math.min(segment.fromKm, segment.toKm);
            const to = Math.max(segment.fromKm, segment.toKm);
            return to >= sample.km && from <= nextKm;
        });
        const cap = marked
            ? `<tr><td class="elev-sprint" height="4" bgcolor="#d97706" style="height:4px;background:#d97706;font-size:1px;line-height:1px;">&nbsp;</td></tr>`
            : '';
        return `<td valign="bottom" height="${PROFILE_HEIGHT + 4}" style="vertical-align:bottom;padding:0;font-size:0;line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cap}<tr><td class="elev-bar" height="${height}" bgcolor="#c00418" style="height:${height}px;background:#c00418;font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td>`;
    }).join('');
    const endLabel = `${new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 }).format(maxKm)} km`;
    return `<tr><td style="padding:4px 16px 8px;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="text-main" style="font-size:14px;font-weight:bold;color:#212121;">Ruteprofil</td>
<td class="text-muted" align="right" style="font-size:11px;color:#d97706;">★ Pointspurt</td>
</tr></table>
</td></tr>
<tr><td style="padding:0 16px 2px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${bars}</tr></table>
</td></tr>
<tr><td style="padding:2px 16px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="text-muted" style="color:#313131;">0</td>
<td class="text-muted" align="right" style="color:#313131;">${escapeHtml(endLabel)}</td>
</tr></table>
</td></tr>`;
}

function sprintMarkup(race: AnnouncementRace, profile: AnnouncementProfile | null | undefined, sprints: SprintRow[]): string {
    if (sprints.length === 0) return '';
    const lapCount = Math.max(1, ...getAllLapsValues(race as Race));
    const lapKm = profile ? lapLengthKmFromElevation(profile, lapCount, 0) : 0;
    const segments = profile
        ? tileProfileSegments(profile.profileSegments ?? [], lapCount, lapKm)
        : [];
    const index = segments.length > 0 ? buildProfileSegmentIndex(segments) : null;
    const leadIn = profile?.leadInDistance ?? 0;
    const kmFor = (sprint: SprintRow) => {
        if (!index) return null;
        const match = matchSprintProfileSegment(index, sprint);
        if (!match) return null;
        return {
            from: Math.min(match.fromKm, match.toKm) + leadIn,
            to: Math.max(match.fromKm, match.toKm) + leadIn,
        };
    };
    const rows = [...sprints].sort((a, b) => {
        const aFrom = kmFor(a)?.from ?? Number.POSITIVE_INFINITY;
        const bFrom = kmFor(b)?.from ?? Number.POSITIVE_INFINITY;
        if (aFrom !== bFrom) return aFrom - bFrom;
        return (a.lap || 1) - (b.lap || 1) || a.count - b.count;
    });
    const hasKm = rows.some((sprint) => kmFor(sprint) !== null);
    const formatKmPoint = (km: number) => km.toFixed(1);
    const body = rows.map((sprint) => {
        const km = kmFor(sprint);
        const kmCells = hasKm
            ? `<td class="text-main" align="right" style="padding:6px 0 6px 8px;color:#212121;">${km ? formatKmPoint(km.from) : '—'}</td><td class="text-main" align="right" style="padding:6px 0 6px 8px;color:#212121;">${km ? formatKmPoint(km.to) : '—'}</td>`
            : '';
        return `<tr>
<td class="text-main" style="padding:6px 8px 6px 0;border-bottom:1px solid #e9e9e9;font-weight:bold;color:#212121;">${escapeHtml(sprintLabel(sprint))}</td>
<td class="text-muted" align="center" style="padding:6px 8px;border-bottom:1px solid #e9e9e9;color:#313131;">${sprint.lap || 1}</td>
${kmCells}
</tr>`;
    }).join('');
    const kmHeads = hasKm
        ? `<th class="text-muted" align="right" style="padding:6px 0 6px 8px;border-bottom:1px solid #e9e9e9;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#313131;">Fra km</th><th class="text-muted" align="right" style="padding:6px 0 6px 8px;border-bottom:1px solid #e9e9e9;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#313131;">Til km</th>`
        : '';
    const leadNote = hasKm
        ? `<p class="text-muted" style="margin:8px 0 0;font-size:11px;color:#313131;">Distancer inkl lead-in${leadIn > 0 ? ` (${leadIn.toFixed(1)} km)` : ''}</p>`
        : '';
    return `<tr><td style="padding:4px 16px 16px;font-family:Arial,Helvetica,sans-serif;">
<div class="text-main" style="margin-bottom:8px;font-size:14px;font-weight:bold;color:#212121;">Pointsprint</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
<tr>
<th class="text-muted" align="left" style="padding:6px 8px 6px 0;border-bottom:1px solid #e9e9e9;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#313131;">Sprint</th>
<th class="text-muted" align="center" style="padding:6px 8px;border-bottom:1px solid #e9e9e9;font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#313131;">Omgang</th>
${kmHeads}
</tr>
${body}
</table>
${leadNote}
</td></tr>`;
}

function raceCard(race: AnnouncementRace, profile?: AnnouncementProfile | null): string {
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
${profileMarkup(profile, sprintRows(race))}
${sprintMarkup(race, profile, sprintRows(race))}
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
  .elev-bar { background: #c00418 !important; background-color: #c00418 !important; }
  .elev-sprint { background: #d97706 !important; background-color: #d97706 !important; }
}
[data-ogsc] .email-bg { background: #212121 !important; background-color: #212121 !important; }
[data-ogsc] .email-card, [data-ogsc] .race-card { background: #313131 !important; background-color: #313131 !important; }
[data-ogsc] .stat-tile { background: #3d3d3d !important; background-color: #3d3d3d !important; }
[data-ogsc] .text-main, [data-ogsc] .text-main p { color: #f8f8f8 !important; }
[data-ogsc] .text-muted { color: #e7e3d6 !important; }
[data-ogsc] .text-soft { color: #e9e9e9 !important; }
[data-ogsc] .text-accent { color: #ff6b6b !important; }
[data-ogsc] .elev-bar { background: #c00418 !important; background-color: #c00418 !important; }
[data-ogsc] .elev-sprint { background: #d97706 !important; background-color: #d97706 !important; }
`;

export function buildRaceAnnouncementHtml(options: {
    siteUrl: string;
    introHtml: string;
    race: AnnouncementRace;
    profile?: AnnouncementProfile | null;
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
${raceCard(options.race, options.profile)}
<tr><td align="center" style="padding:8px 32px 28px;">
<a class="email-btn" href="${escapeHtml(homeUrl)}" style="display:inline-block;background:#c00418;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1;padding:14px 22px;border-radius:6px;">Gå til løbet</a>
</td></tr>
<tr><td class="text-soft" style="padding:0 32px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#313131;">Venlig hilsen<br><br>DCU Udvalg for e-cykling</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
