import {
    buildProfileSegmentIndex,
    matchSprintProfileSegment,
} from '@/components/races/SprintsByLap';
import { fromTimestamp } from '@/lib/formatDate';
import { formatOmgangeDisplay, getAllLapsValues } from '@/lib/raceLaps';
import { lapLengthKmFromElevation, tileProfileSegments } from '@/lib/routeProfileSegments';
import type { Race } from '@/types/live';

export const RACE_ANNOUNCEMENT_SUBJECT = 'DCU E-serien';
export const RACE_ANNOUNCEMENT_CLOSING_HTML = '<p>Er du ikke tilmeldt endnu? Du kan stadig nå det. Gå ind på løbet og tryk på “tilmeld”.</p>';

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
    return trimmed ? `DCU E-serien: ${trimmed}` : RACE_ANNOUNCEMENT_SUBJECT;
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
    const name = sprint.name.trim();
    const direction = (sprint.direction || '').trim().toLowerCase();
    const alreadyReverse = /\b(reverse|rev\.?)$/i.test(name);
    return direction === 'reverse' && !alreadyReverse ? `${name} Reverse` : name;
}

interface SprintSpan {
    sprint: SprintRow;
    fromKm: number;
    toKm: number;
    displayFrom: number;
    displayTo: number;
}

function sprintSpans(race: AnnouncementRace, profile: AnnouncementProfile | null | undefined, sprints: SprintRow[]): SprintSpan[] {
    const lapCount = Math.max(1, ...getAllLapsValues(race as Race));
    const lapKm = profile ? lapLengthKmFromElevation(profile, lapCount, 0) : 0;
    const segments = profile
        ? tileProfileSegments(profile.profileSegments ?? [], lapCount, lapKm)
        : [];
    const index = segments.length > 0 ? buildProfileSegmentIndex(segments) : null;
    const leadIn = profile?.leadInDistance ?? 0;
    return sprints.map((sprint) => {
        const match = index ? matchSprintProfileSegment(index, sprint) : null;
        if (!match) {
            return { sprint, fromKm: Number.POSITIVE_INFINITY, toKm: Number.POSITIVE_INFINITY, displayFrom: Number.POSITIVE_INFINITY, displayTo: Number.POSITIVE_INFINITY };
        }
        const fromKm = Math.min(match.fromKm, match.toKm);
        const toKm = Math.max(match.fromKm, match.toKm);
        return {
            sprint,
            fromKm,
            toKm,
            displayFrom: fromKm + leadIn,
            displayTo: toKm + leadIn,
        };
    });
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

function profileMarkup(race: AnnouncementRace, profile: AnnouncementProfile | null | undefined, sprints: SprintRow[]): string {
    if (!profile) return '';
    const samples = profileSamples(profile);
    if (samples.length < 2) return '';
    const altitudes = samples.map((sample) => sample.altitude);
    const minAlt = Math.min(...altitudes);
    const maxAlt = Math.max(...altitudes);
    const range = maxAlt - minAlt || 1;
    const maxKm = samples[samples.length - 1]?.km ?? 0;
    const spans = sprintSpans(race, profile, sprints).filter((span) => Number.isFinite(span.fromKm));
    const starAt = new Map<number, 'center' | 'right-edge'>();
    if (maxKm > 0) {
        for (const span of spans) {
            const covered: number[] = [];
            for (let index = 0; index < PROFILE_BARS; index++) {
                const barStart = (maxKm * index) / PROFILE_BARS;
                const barEnd = (maxKm * (index + 1)) / PROFILE_BARS;
                if (span.toKm >= barStart && span.fromKm <= barEnd) covered.push(index);
            }
            if (covered.length === 0) continue;
            const center = (covered[0] + covered[covered.length - 1]) / 2;
            const index = Math.floor(center);
            starAt.set(index, center === index ? 'center' : 'right-edge');
        }
    }
    const bars = samples.map((sample, index) => {
        const barStart = (maxKm * index) / PROFILE_BARS;
        const barEnd = (maxKm * (index + 1)) / PROFILE_BARS;
        const height = Math.max(4, Math.round(((sample.altitude - minAlt) / range) * (PROFILE_HEIGHT - 4)) + 4);
        const marked = spans.some((span) => span.toKm >= barStart && span.fromKm <= barEnd);
        const color = marked ? '#56A845' : '#c00418';
        const barClass = marked ? 'elev-sprint' : 'elev-bar';
        const anchor = starAt.get(index);
        const star = anchor
            ? `<tr><td height="14" style="height:14px;padding:0;position:relative;"><div class="elev-star" style="position:absolute;left:${anchor === 'right-edge' ? '100%' : '50%'};width:16px;margin-left:-8px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:14px;color:#d97706;">★</div></td></tr><tr><td height="22" style="height:22px;font-size:1px;line-height:22px;">&nbsp;</td></tr>`
            : '';
        return `<td valign="bottom" style="vertical-align:bottom;padding:0;font-size:0;line-height:0;overflow:visible;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${star}<tr><td class="${barClass}" height="${height}" bgcolor="${color}" style="height:${height}px;background:${color};font-size:1px;line-height:1px;">&nbsp;</td></tr></table></td>`;
    }).join('');
    return `<tr><td style="padding:4px 16px 8px;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="text-main" style="font-size:14px;font-weight:bold;color:#212121;">Ruteprofil</td>
<td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;"><span class="elev-star" style="color:#d97706;">★</span> <span class="text-muted" style="color:#313131;">Pointspurt</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:0 16px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;">
<tr>${bars}</tr>
</table>
</td></tr>`;
}

const SPRINT_RULE = 'border-bottom:1px solid #e9e9e9;';

function sprintMarkup(race: AnnouncementRace, profile: AnnouncementProfile | null | undefined, sprints: SprintRow[]): string {
    if (sprints.length === 0) return '';
    const spans = [...sprintSpans(race, profile, sprints)].sort((a, b) => {
        if (a.displayFrom !== b.displayFrom) return a.displayFrom - b.displayFrom;
        return (a.sprint.lap || 1) - (b.sprint.lap || 1) || a.sprint.count - b.sprint.count;
    });
    const hasKm = spans.some((span) => Number.isFinite(span.displayFrom));
    const leadIn = profile?.leadInDistance ?? 0;
    const formatKmPoint = (km: number) => km.toFixed(1);
    const cell = (text: string, align: 'left' | 'center' | 'right', extra = '') =>
        `<td class="text-main" align="${align}" style="padding:6px 8px;${SPRINT_RULE}color:#212121;${extra}">${text}</td>`;
    const head = (text: string, align: 'left' | 'center' | 'right') =>
        `<th class="text-muted" align="${align}" style="padding:6px 8px;${SPRINT_RULE}font-size:11px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:#313131;">${text}</th>`;
    const body = spans.map((span) => {
        const kmCells = hasKm
            ? `${cell(Number.isFinite(span.displayFrom) ? formatKmPoint(span.displayFrom) : '—', 'right')}${cell(Number.isFinite(span.displayTo) ? formatKmPoint(span.displayTo) : '—', 'right')}`
            : '';
        return `<tr>
${cell(escapeHtml(sprintLabel(span.sprint)), 'left', 'font-weight:bold;')}
${cell(String(span.sprint.lap || 1), 'center')}
${kmCells}
</tr>`;
    }).join('');
    const kmHeads = hasKm ? `${head('Fra km', 'right')}${head('Til km', 'right')}` : '';
    const leadNote = hasKm
        ? `<p class="text-muted" style="margin:8px 0 0;font-size:11px;color:#313131;">Distancer inkl lead-in${leadIn > 0 ? ` (${leadIn.toFixed(1)} km)` : ''}</p>`
        : '';
    return `<tr><td style="padding:4px 16px 16px;font-family:Arial,Helvetica,sans-serif;">
<div class="text-main" style="margin-bottom:8px;font-size:14px;font-weight:bold;color:#212121;">Pointsprint</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
<tr>
${head('Sprint', 'left')}
${head('Omgang', 'center')}
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
${profileMarkup(race, profile, sprintRows(race))}
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
  .elev-sprint { background: #56A845 !important; background-color: #56A845 !important; }
  .elev-star { color: #d97706 !important; }
}
[data-ogsc] .email-bg { background: #212121 !important; background-color: #212121 !important; }
[data-ogsc] .email-card, [data-ogsc] .race-card { background: #313131 !important; background-color: #313131 !important; }
[data-ogsc] .stat-tile { background: #3d3d3d !important; background-color: #3d3d3d !important; }
[data-ogsc] .text-main, [data-ogsc] .text-main p { color: #f8f8f8 !important; }
[data-ogsc] .text-muted { color: #e7e3d6 !important; }
[data-ogsc] .text-soft { color: #e9e9e9 !important; }
[data-ogsc] .text-accent { color: #ff6b6b !important; }
[data-ogsc] .elev-bar { background: #c00418 !important; background-color: #c00418 !important; }
[data-ogsc] .elev-sprint { background: #56A845 !important; background-color: #56A845 !important; }
[data-ogsc] .elev-star { color: #d97706 !important; }
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
