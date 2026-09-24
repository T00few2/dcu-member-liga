const FIREBASE_STORAGE_HOST =
    'https://firebasestorage.googleapis.com/v0/b/dcu-member-liga-479507.firebasestorage.app/o';

/** Public hero clip hosted on Firebase Storage so it does not count as Vercel Fast Data Transfer. */
export const HERO_VIDEO_URL =
    process.env.NEXT_PUBLIC_HERO_VIDEO_URL
    || `${FIREBASE_STORAGE_HOST}/public%2Fhero-video.mp4?alt=media`;

export const HERO_POSTER_URL =
    process.env.NEXT_PUBLIC_HERO_POSTER_URL
    || `${FIREBASE_STORAGE_HOST}/public%2Fhero-video-poster.jpg?alt=media`;
