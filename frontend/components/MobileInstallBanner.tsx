'use client';

import { useEffect, useState } from 'react';
import { isIOS, isAndroid, isMobileDevice, isStandalone, isInAppBrowser } from '@/lib/browser-detection';

const DISMISS_KEY = 'pwa-install-dismissed';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function MobileInstallBanner() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Don't show if already installed, on desktop, or in an in-app browser
    if (isStandalone() || !isMobileDevice() || isInAppBrowser()) return;

    // Don't show if recently dismissed
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < DISMISS_TTL_MS) return;

    if (isIOS()) {
      setPlatform('ios');
      setShow(true);
    } else if (isAndroid()) {
      // Wait for the beforeinstallprompt event (Chrome on Android)
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setPlatform('android');
        setShow(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
    setDeferredPrompt(null);
  };

  if (!show) return null;

  return (
    <div
      role="alert"
      className="w-full bg-amber-50 border-b border-amber-300 text-amber-900 px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3 max-w-2xl mx-auto">
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none mt-0.5" aria-hidden>📲</span>
          <div>
            <strong>Tilføj til hjemmeskærm</strong>
            {platform === 'ios' && (
              <p className="mt-0.5">
                Tryk på del-ikonet (
                <span aria-hidden className="font-bold">⬆</span>
                ) nederst i Safari, og vælg{' '}
                <em>&quot;Føj til hjemmeskærm&quot;</em> for at få nem adgang til appen.
              </p>
            )}
            {platform === 'android' && (
              <p className="mt-0.5">
                Installér appen for hurtig adgang til resultater og løb direkte fra din startskærm.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {platform === 'android' && (
            <button
              onClick={install}
              className="bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-amber-700 transition-colors"
            >
              Installer
            </button>
          )}
          <button
            onClick={dismiss}
            aria-label="Luk"
            className="text-amber-700 hover:text-amber-900 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
