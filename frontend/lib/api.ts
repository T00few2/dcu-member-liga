export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/** Build a ZwiftInsider route-guide URL from a route name. */
export const getZwiftInsiderUrl = (routeName: string): string => {
    if (!routeName) return '#';
    const slug = routeName.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return `https://zwiftinsider.com/route/${slug}/`;
};
