// Overlay configuration types and constants

export interface OverlayColorScheme {
    name: string;
    overlayText: string;
    overlayMuted: string;
    overlayAccent: string;
    overlayPositive: string;
    overlayHeaderText: string;
    overlayHeaderBg: string;
    overlayRowText: string;
    overlayRowBg: string;
    overlayRowAltBg: string;
    overlayBorder: string;
    overlayBackground: string;
}

export interface LiveConfig {
    limit: number;
    cycle: number;
    transparent: boolean;
    scroll: boolean;
    sprints: boolean;
    lastSprint: boolean;
    full: boolean;
    includeBanner: boolean;
    fitToScreen: boolean;
    lastSplit: boolean;
    showCheckboxes: boolean;
    // Overlay colors
    overlayText: string;
    overlayMuted: string;
    overlayAccent: string;
    overlayPositive: string;
    overlayHeaderText: string;
    overlayHeaderBg: string;
    overlayRowText: string;
    overlayRowBg: string;
    overlayRowAltBg: string;
    overlayBorder: string;
    overlayBackground: string;
    // Calculation settings
    source: 'finishers' | 'joined' | 'signed_up';
    filterRegistered: boolean;
    nameMax: string;
}

export const DEFAULT_LIVE_CONFIG: LiveConfig = {
    limit: 10,
    cycle: 0,
    transparent: true,
    scroll: false,
    sprints: true,
    lastSprint: false,
    full: false,
    includeBanner: true,
    fitToScreen: true,
    lastSplit: false,
    showCheckboxes: false,
    overlayText: '',
    overlayMuted: '',
    overlayAccent: '',
    overlayPositive: '',
    overlayHeaderText: '',
    overlayHeaderBg: '',
    overlayRowText: '',
    overlayRowBg: '',
    overlayRowAltBg: '',
    overlayBorder: '',
    overlayBackground: '',
    source: 'joined',
    filterRegistered: false,
    nameMax: '',
};

export const DEFAULT_OVERLAY_PALETTES: OverlayColorScheme[] = [
    {
        name: 'Default Blue',
        overlayText: '',
        overlayMuted: '',
        overlayAccent: '',
        overlayPositive: '',
        overlayHeaderText: '',
        overlayHeaderBg: '',
        overlayRowText: '',
        overlayRowBg: '',
        overlayRowAltBg: '',
        overlayBorder: '',
        overlayBackground: '',
    },
    {
        name: 'High Contrast',
        overlayText: '#f8fafc',
        overlayMuted: '#94a3b8',
        overlayAccent: '#38bdf8',
        overlayPositive: '#4ade80',
        overlayHeaderText: '#ffffff',
        overlayHeaderBg: '#0f172a',
        overlayRowText: '#f8fafc',
        overlayRowBg: 'rgba(15, 23, 42, 0.85)',
        overlayRowAltBg: 'rgba(30, 41, 59, 0.85)',
        overlayBorder: 'rgba(148, 163, 184, 0.35)',
        overlayBackground: '#0b1220',
    },
    {
        name: 'Vivid Purple',
        overlayText: '#f5f3ff',
        overlayMuted: '#c4b5fd',
        overlayAccent: '#a855f7',
        overlayPositive: '#22c55e',
        overlayHeaderText: '#faf5ff',
        overlayHeaderBg: 'rgba(88, 28, 135, 0.9)',
        overlayRowText: '#f5f3ff',
        overlayRowBg: 'rgba(30, 27, 75, 0.7)',
        overlayRowAltBg: 'rgba(49, 46, 129, 0.7)',
        overlayBorder: 'rgba(168, 85, 247, 0.45)',
        overlayBackground: '#0f0b24',
    },
    {
        name: 'Warm Amber',
        overlayText: '#fef3c7',
        overlayMuted: '#f59e0b',
        overlayAccent: '#f97316',
        overlayPositive: '#84cc16',
        overlayHeaderText: '#fffbeb',
        overlayHeaderBg: 'rgba(120, 53, 15, 0.9)',
        overlayRowText: '#fef3c7',
        overlayRowBg: 'rgba(69, 26, 3, 0.7)',
        overlayRowAltBg: 'rgba(92, 33, 6, 0.7)',
        overlayBorder: 'rgba(245, 158, 11, 0.4)',
        overlayBackground: '#1a1209',
    },
];

// Helper to extract color properties from config
export function getOverlaySchemeFromConfig(name: string, config: LiveConfig): OverlayColorScheme {
    return {
        name,
        overlayText: config.overlayText,
        overlayMuted: config.overlayMuted,
        overlayAccent: config.overlayAccent,
        overlayPositive: config.overlayPositive,
        overlayHeaderText: config.overlayHeaderText,
        overlayHeaderBg: config.overlayHeaderBg,
        overlayRowText: config.overlayRowText,
        overlayRowBg: config.overlayRowBg,
        overlayRowAltBg: config.overlayRowAltBg,
        overlayBorder: config.overlayBorder,
        overlayBackground: config.overlayBackground,
    };
}
