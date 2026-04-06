/**
 * Detects whether the current browser is an in-app WebView
 * (e.g. Facebook Messenger, Instagram, Facebook app).
 *
 * Google OAuth (signInWithPopup / signInWithRedirect) is blocked in these
 * environments with error 403 disallowed_useragent.  Users must open the
 * page in a real browser (Safari, Chrome, etc.) instead.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Matches Facebook app, Messenger, Instagram in-app browsers
  return /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger|Instagram/i.test(ua);
}

export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Safari: contains "Safari" but not "Chrome" or "Chromium"
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS/i.test(ua);
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export function isMobileDevice(): boolean {
  return isIOS() || isAndroid();
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true
  );
}
