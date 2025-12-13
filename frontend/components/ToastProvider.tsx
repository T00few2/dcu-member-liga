'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

type Toast = {
  id: string;
  type: ToastType;
  message: string;
};

type ToastContextType = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<Record<string, number>>({});

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timeout = timeoutsRef.current[id];
    if (timeout) {
      window.clearTimeout(timeout);
      delete timeoutsRef.current[id];
    }
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const toast: Toast = { id, type, message };
      setToasts((prev) => [...prev, toast].slice(-3)); // keep last 3

      timeoutsRef.current[id] = window.setTimeout(() => removeToast(id), 3500);
    },
    [removeToast]
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 space-y-2">
      {toasts.map((t) => {
        const styles =
          t.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-800'
            : t.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-border bg-card text-card-foreground';

        return (
          <div
            key={t.id}
            className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur ${styles}`}
            role="status"
            aria-live="polite"
          >
            <div className="text-sm font-medium leading-snug">{t.message}</div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="text-muted-foreground hover:text-foreground -mr-1 -mt-1 p-1"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}


