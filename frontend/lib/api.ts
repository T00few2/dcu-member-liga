export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/** Build a ZwiftMap URL from a world name and route name. */
export const getZwiftMapUrl = (mapName: string, routeName: string): string => {
    if (!mapName || !routeName) return '#';
    const toSlug = (s: string) => s.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return `https://zwiftmap.com/${toSlug(mapName)}/${toSlug(routeName)}`;
};
