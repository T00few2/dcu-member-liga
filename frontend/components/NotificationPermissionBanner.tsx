'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';

const DISMISS_KEY = 'notif-banner-dismissed';

export default function NotificationPermissionBanner() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    setShow(true);
  }, [user]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setShow(false);
  };

  const requestPermission = async () => {
    const permission = await Notification.requestPermission();
    if (permission === 'granted' || permission === 'denied') {
      setShow(false);
      if (permission === 'denied') {
        localStorage.setItem(DISMISS_KEY, 'true');
      }
    }
  };

  if (!show) return null;

  return (
    <div
      role="alert"
      className="w-full bg-[#1a3a4a] border-b border-[#2a5a6a] text-slate-100 px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3 max-w-2xl mx-auto">
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none mt-0.5" aria-hidden>🔔</span>
          <div>
            <strong>Få besked om nye løb og resultater</strong>
            <p className="mt-0.5 text-slate-300">
              Tillad notifikationer og gå aldrig glip af et nyt løb eller opdaterede resultater.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={requestPermission}
            className="bg-[#2a8a9a] text-white text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-[#3a9aaa] transition-colors whitespace-nowrap"
          >
            Tillad notifikationer
          </button>
          <button
            onClick={dismiss}
            aria-label="Luk"
            className="text-slate-400 hover:text-slate-100 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
