import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'DCU forårsliga',
        short_name: 'DCU forårsliga',
        description: 'E-cycling liga for DCU members',
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
