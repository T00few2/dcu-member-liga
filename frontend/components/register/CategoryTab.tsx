'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { useLeagueSettingsQuery, useProfileQuery } from '@/hooks/queries';
import {
    ZR_CATEGORY_GEMS,
    ZR_CATEGORY_STYLES,
    catLower,
    effectiveLigaCategories,
    ratingMatchingCategoryBounds,
    type LigaCategoryDef,
} from '@/lib/ligaCategories';

const GRACE_POINTS_FALLBACK = 35;

function catMeta(name: string, cats: LigaCategoryDef[]) {
    const idx = cats.findIndex(c => c.name === name);
    if (idx < 0) {
        return {
            name,
            lower: 0,
            upper: null as number | null,
            color: ZR_CATEGORY_STYLES[name] ?? 'bg-slate-100 text-slate-800 border-slate-300',
            gem: ZR_CATEGORY_GEMS[name]?.gem ?? '●',
        };
    }
    return {
        name,
        lower: catLower(cats, idx),
        upper: cats[idx].upper,
        color: `${ZR_CATEGORY_STYLES[name] ?? 'bg-slate-100 text-slate-800'} border-current/20`,
        gem: ZR_CATEGORY_GEMS[name]?.gem ?? '●',
    };
}

const statusLabel: Record<string, { label: string; cls: string }> = {
    ok:    { label: 'OK',            cls: 'bg-green-100 text-green-800 border-green-300' },
    grace: { label: 'Grace-periode', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    over:  { label: 'Over grænse',   cls: 'bg-red-100 text-red-800 border-red-300' },
};

interface LigaCategory {
    category: string;
    upperBoundary: number | null;
    graceLimit: number | null;
    assignedRating: number;
    status: string;
    assignedAt?: number;
    lastCheckedRating?: number;
    lastCheckedAt?: number;
    locked?: boolean;
    lockedAt?: number;
    autoAssignedCategory?: string;
    selfSelectedCategory?: string;
    manualAssignedCategory?: string;
}

interface Profile {
    name: string;
    zwiftId: string;
    ligaCategory?: LigaCategory;
}

function CategoryExplanation({ gracePoints }: { gracePoints: number }) {
    return (
        <div className="bg-muted/30 border border-border rounded-lg p-6 space-y-4 text-sm text-muted-foreground leading-relaxed">
            <h3 className="text-base font-semibold text-foreground">Hvordan fungerer kategorierne?</h3>
            <p>
                DCU E-serien bruger <strong className="text-foreground">ZwiftRacing (vELO)</strong>-ratingsystemet til at placere ryttere i fair kategorier.
                Din kategori bestemmes automatisk ud fra dit <strong className="text-foreground">max30-rating</strong> – dit højeste vELO-gennemsnit over de seneste 30 dage.
            </p>
            <div className="space-y-2">
                <p className="font-medium text-foreground">Automatisk tildeling</p>
                <p>
                    Når du tilmelder dig, henter vi dit aktuelle max30-rating fra ZwiftRacing og placerer dig i den tilsvarende kategori.
                    Kategorien opdateres automatisk dagligt frem til dit første løb.
                    Kategorierne spænder fra <strong className="text-foreground">Copper</strong> (0 vELO) til <strong className="text-foreground">Diamond</strong> (2200+ vELO).
                </p>
            </div>
            <div className="space-y-2">
                <p className="font-medium text-foreground">Selvvalg af kategori</p>
                <p>
                    Du kan vælge din auto-tildelte kategori eller en <em>højere</em> kategori – f.eks. hvis du ønsker en større udfordring.
                    Det er ikke muligt at vælge en lavere kategori end den auto-tildelte.
                </p>
            </div>
            <div className="space-y-2">
                <p className="font-medium text-foreground">Grace-periode ({gracePoints} vELO-point)</p>
                <p>
                    Har du nået over din kategoris øvre grænse, men er inden for grace-grænsen (+{gracePoints} vELO), er du i grace-periode.
                    Du fuldfører sæsonen i din nuværende kategori, men bør forberede dig på at rykke op.
                </p>
            </div>
            <div className="space-y-2">
                <p className="font-medium text-foreground">Låsning efter løb</p>
                <p>
                    Så snart du har gennemført et officielt sæsonløb, låses din kategori for resten af sæsonen.
                    En admin kan tvinge en oprykning (aldrig en nedrykning) hvis nødvendigt.
                </p>
            </div>
        </div>
    );
}

export default function CategoryTab() {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    const { data: profile, isLoading: loading } = useProfileQuery();
    const { data: leagueSettings } = useLeagueSettingsQuery();
    const cats = useMemo(() => effectiveLigaCategories(leagueSettings), [leagueSettings]);
    const gracePoints = leagueSettings?.gracePeriod ?? GRACE_POINTS_FALLBACK;

    const [selected, setSelected] = useState<string>('');
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

    const lc = profile?.ligaCategory;
    const catIndex = (name: string) => cats.findIndex(c => c.name === name);
    const currentCatIndex = lc ? catIndex(lc.category) : -1;

    const floorCategory = lc?.manualAssignedCategory || lc?.autoAssignedCategory;
    const autoAssignedIndex = floorCategory
        ? catIndex(floorCategory)
        : currentCatIndex;
    const upgradeOptions = autoAssignedIndex >= 0
        ? cats.filter((_, i) => i <= autoAssignedIndex).map(c => catMeta(c.name, cats))
        : [];

    const handleSave = async () => {
        if (!selected || !user) return;
        setSaving(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/category/select`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ category: selected }),
            });
            const data = await res.json();
            if (res.ok) {
                setToast({ msg: data.message, ok: true });
                await queryClient.invalidateQueries({ queryKey: ['profile'] });
                setSelected('');
            } else {
                setToast({ msg: data.message || 'Noget gik galt', ok: false });
            }
        } catch {
            setToast({ msg: 'Netværksfejl – prøv igen', ok: false });
        } finally {
            setSaving(false);
            setTimeout(() => setToast(null), 4000);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
        );
    }

    if (!profile) return null;

    const meta = lc ? catMeta(lc.category, cats) : null;
    const st = lc ? (statusLabel[lc.status] ?? statusLabel.ok) : null;

    return (
        <div className="space-y-6">
            {/* Current category card */}
            <div className="bg-muted/20 border border-border rounded-lg p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                            Din kategori
                        </p>
                        {lc && meta ? (
                            <div className="flex items-center gap-3">
                                <span className="text-4xl">{meta.gem}</span>
                                <div>
                                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold border ${meta.color}`}>
                                        {lc.category}
                                    </span>
                                    {lc.selfSelectedCategory && lc.selfSelectedCategory === lc.category && lc.selfSelectedCategory !== lc.autoAssignedCategory && (
                                        <span className="ml-2 text-xs text-muted-foreground">(selvvalgt)</span>
                                    )}
                                    {lc.autoAssignedCategory && lc.autoAssignedCategory !== lc.category && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Auto-tildelt: {lc.autoAssignedCategory}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-muted-foreground italic">Ingen kategori tildelt endnu</p>
                        )}
                    </div>

                    {lc && st && (
                        <div className="text-right">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Status</p>
                            <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${st.cls}`}>
                                {st.label}
                            </span>
                        </div>
                    )}
                </div>

                {lc && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div className="bg-muted/30 rounded p-3">
                            <p className="text-xs text-muted-foreground">
                                {lc.manualAssignedCategory ? 'Tildelt rating' : 'Seneste vELO'}
                            </p>
                            <p className="font-semibold">
                                {ratingMatchingCategoryBounds(lc) ?? '—'} vELO
                            </p>
                        </div>
                        <div className="bg-muted/30 rounded p-3">
                            <p className="text-xs text-muted-foreground">Øvre grænse</p>
                            <p className="font-semibold">
                                {lc.upperBoundary != null ? `${lc.upperBoundary} vELO` : '∞'}
                            </p>
                        </div>
                        <div className="bg-muted/30 rounded p-3">
                            <p className="text-xs text-muted-foreground">Grace-grænse</p>
                            <p className="font-semibold">
                                {lc.graceLimit != null ? `${lc.graceLimit} vELO` : '∞'}
                            </p>
                        </div>
                    </div>
                )}

                {lc?.locked && (
                    <div className="mt-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                        <span>🔒</span>
                        <span>Din kategori er låst efter gennemført løb. Kontakt admin for oprykning.</span>
                    </div>
                )}
            </div>

            {/* Self-select category */}
            {!lc?.locked && (
                <div className="bg-muted/20 border border-border rounded-lg p-5">
                    <h2 className="text-base font-semibold mb-1">Vælg kategori</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        Din kategori opdateres automatisk dagligt frem til dit første løb. Du kan vælge din auto-tildelte kategori eller en højere kategori.
                    </p>

                    {upgradeOptions.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                            {autoAssignedIndex === 0
                                ? `Du er allerede i den højeste kategori (${cats[0]?.name || 'top'}).`
                                : lc
                                ? 'Ingen kategorier tilgængelige.'
                                : 'Tilmeld dig for at se dine kategorimuligheder.'}
                        </p>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                    Vælg kategori
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {upgradeOptions.map(cat => (
                                        <button
                                            key={cat.name}
                                            onClick={() => setSelected(cat.name)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                                                selected === cat.name
                                                    ? `${cat.color} ring-2 ring-offset-1 ring-primary`
                                                    : `${cat.color} opacity-70 hover:opacity-100`
                                            }`}
                                        >
                                            <span>{cat.gem}</span>
                                            <span>{cat.name}</span>
                                            <span className="text-xs opacity-70">
                                                ({cat.lower}+ vELO)
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={handleSave}
                                disabled={!selected || saving}
                                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                                {saving ? 'Gemmer…' : 'Gem'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div
                    className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg shadow-lg text-sm font-medium z-50 transition ${
                        toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                    }`}
                >
                    {toast.msg}
                </div>
            )}

            {/* Explanation */}
            <CategoryExplanation gracePoints={gracePoints} />

            {/* Category table */}
            <div className="bg-muted/20 border border-border rounded-lg p-5">
                <h3 className="text-base font-semibold mb-4">Alle kategorier</h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                                <th className="text-left pb-2 pr-4">Gem</th>
                                <th className="text-left pb-2 pr-4">Kategori</th>
                                <th className="text-right pb-2 pr-4">Nedre grænse</th>
                                <th className="text-right pb-2">Øvre grænse</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {cats.map(row => {
                                const cat = catMeta(row.name, cats);
                                const isCurrent = lc?.category === cat.name;
                                return (
                                    <tr key={cat.name} className={isCurrent ? 'font-semibold' : ''}>
                                        <td className="py-2 pr-4 text-lg">{cat.gem}</td>
                                        <td className="py-2 pr-4">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cat.color}`}>
                                                {cat.name}
                                            </span>
                                            {isCurrent && (
                                                <span className="ml-2 text-xs text-primary">← dig</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-4 text-right font-mono text-xs">{cat.lower}</td>
                                        <td className="py-2 text-right font-mono text-xs">
                                            {cat.upper != null ? cat.upper : '∞'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
