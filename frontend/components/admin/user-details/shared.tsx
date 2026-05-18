'use client';

import React from 'react';

// ── Formatters ─────────────────────────────────────────────────────────────────

export function fmtDate(ms?: number | null) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ms?: number | null) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtFinishTime(ms?: number | null) {
    if (!ms || ms === 0) return 'DNF';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(ms?: number) {
    if (!ms) return '—';
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ── Style maps ─────────────────────────────────────────────────────────────────

export const CATEGORY_STYLES: Record<string, string> = {
    Diamond:  'bg-cyan-100 text-cyan-800',
    Ruby:     'bg-red-100 text-red-800',
    Emerald:  'bg-green-100 text-green-800',
    Sapphire: 'bg-blue-100 text-blue-800',
    Amethyst: 'bg-purple-100 text-purple-800',
    Platinum: 'bg-slate-100 text-slate-700',
    Gold:     'bg-yellow-100 text-yellow-800',
    Silver:   'bg-gray-100 text-gray-700',
    Bronze:   'bg-orange-100 text-orange-800',
    Copper:   'bg-amber-100 text-amber-800',
};

export const VERIFICATION_STYLES: Record<string, string> = {
    approved:  'bg-green-100 text-green-800',
    submitted: 'bg-blue-100 text-blue-800',
    pending:   'bg-yellow-100 text-yellow-800',
    rejected:  'bg-red-100 text-red-800',
    none:      'bg-gray-100 text-gray-600',
};

// ── CP duration labels ─────────────────────────────────────────────────────────

export const CP_LABELS: Record<number, string> = {
    5: '5s', 10: '10s', 20: '20s', 30: '30s',
    60: '1min', 120: '2min', 300: '5min',
    600: '10min', 720: '12min', 1200: '20min',
    1800: '30min', 3600: '60min',
};

export function cpLabel(duration: number) {
    return CP_LABELS[duration] ?? `${duration}s`;
}

// ── Shared UI primitives ───────────────────────────────────────────────────────

export function Badge({ label, className }: { label: string; className?: string }) {
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className ?? 'bg-gray-100 text-gray-700'}`}>
            {label}
        </span>
    );
}

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">{title}</h3>
            {children}
        </div>
    );
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex justify-between items-start gap-4 py-1.5 border-b border-border/50 last:border-0">
            <span className="text-sm text-muted-foreground shrink-0">{label}</span>
            <span className="text-sm text-foreground text-right">{value ?? '—'}</span>
        </div>
    );
}
