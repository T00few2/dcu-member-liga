import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'DCU Member League',
        short_name: 'DCU League',
        description: 'E-cycling league for DCU members',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a', // slate-900
        theme_color: '#0f172a',
        icons: [
            {
                src: '/app_icon.png',
                sizes: '192x192',
                type: 'image/png',
            },
            {
                src: '/app_icon.png',
                sizes: '512x512',
                type: 'image/png',
            },
        ],
    }
}
