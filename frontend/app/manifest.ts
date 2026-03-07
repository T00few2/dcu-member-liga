import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'DCU forårsliga',
        short_name: 'DCU forårsliga',
        description: 'E-cycling liga for DCU members',
        start_url: '/',
        display: 'standalone',
        background_color: '#0e2029',
        theme_color: '#0e2029',
        icons: [
            {
                src: '/icon-192.png',
                sizes: '192x192',
                type: 'image/png',
            },
            {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
            },
            {
                src: '/icon-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
            },
        ],
    }
}
