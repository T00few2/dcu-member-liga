'use client';

import { useEffect, useState } from 'react';
import { isInAppBrowser } from '@/lib/browser-detection';

/**
 * Shows a sticky banner when the site is opened inside an in-app browser
 * (Facebook Messenger, Instagram, Facebook app, etc.).
 *
 * Google blocks OAuth sign-in in these WebViews, so we tell the user to open
 * the page in their real browser before they try to sign up or log in.
 */
export default function InAppBrowserBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isInAppBrowser());
  }, []);

  if (!show) return null;

  return (
    <div
      role="alert"
      className="w-full bg-amber-50 border-b border-amber-300 text-amber-900 px-4 py-3 text-sm text-center"
    >
      <strong>Tilmelding virker ikke i Messengers browser.</strong>{' '}
      Tryk på menu-ikonet (
      <span aria-hidden>&#8942;</span> eller{' '}
      <span aria-hidden>&#8729;&#8729;&#8729;</span>) og vælg{' '}
      <em>&quot;Åbn i Safari&quot;</em> eller{' '}
      <em>&quot;Åbn i Chrome&quot;</em> for at fortsætte.
    </div>
  );
}
