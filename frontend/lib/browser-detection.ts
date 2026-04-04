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
