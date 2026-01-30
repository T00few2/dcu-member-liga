'use client';

import type { LiveConfig, OverlayColorScheme } from '@/types/overlay';
import { DEFAULT_OVERLAY_PALETTES } from '@/types/overlay';

interface ColorInputProps {
    label: string;
    value: string;
    defaultColor: string;
    placeholder: string;
    onChange: (value: string) => void;
}

function ColorInput({ label, value, defaultColor, placeholder, onChange }: ColorInputProps) {
    return (
        <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={value || defaultColor}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                    title={`Pick ${label.toLowerCase()}`}
                />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                />
            </div>
        </div>
    );
}

interface OverlayColorPanelProps {
    config: LiveConfig;
    savedSchemes: OverlayColorScheme[];
    schemeName: string;
    onSchemeNameChange: (name: string) => void;
    onApplyPalette: (palette: OverlayColorScheme) => void;
    onSaveScheme: () => void;
    onDeleteScheme: (name: string) => void;
    updateConfig: <K extends keyof LiveConfig>(field: K, value: LiveConfig[K]) => void;
}

export default function OverlayColorPanel({
    config,
    savedSchemes,
    schemeName,
    onSchemeNameChange,
    onApplyPalette,
    onSaveScheme,
    onDeleteScheme,
    updateConfig,
}: OverlayColorPanelProps) {
    return (
        <div className="bg-slate-800 rounded-lg border border-slate-700 mb-8">
            <details className="group">
                <summary className="list-none cursor-pointer select-none px-6 py-4 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-slate-200">
                            Overlay Colors (OBS / Non-Full)
                        </h2>
                        <p className="text-xs text-slate-400 mt-1">
                            Optional. Use any valid CSS color (hex, rgb, hsl, named). Empty = default.
                        </p>
                    </div>
                    <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">
                        ▾
                    </span>
                </summary>
                
                <div className="px-6 pb-6 pt-2 border-t border-slate-700">
                    {/* Palette Buttons */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        {DEFAULT_OVERLAY_PALETTES.map(palette => (
                            <button
                                key={palette.name}
                                onClick={() => onApplyPalette(palette)}
                                className="px-3 py-1 text-xs font-semibold rounded border border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white"
                                type="button"
                            >
                                {palette.name}
                            </button>
                        ))}
                        {savedSchemes.map(scheme => (
                            <button
                                key={scheme.name}
                                onClick={() => onApplyPalette(scheme)}
                                className="relative pl-3 pr-6 py-1 text-xs font-semibold rounded border border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white"
                                type="button"
                            >
                                {scheme.name}
                                <span
                                    className="absolute right-1 top-1 text-[10px] text-slate-400 hover:text-red-300"
                                    title="Delete scheme"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteScheme(scheme.name);
                                    }}
                                >
                                    ✕
                                </span>
                            </button>
                        ))}
                        <button
                            onClick={() => onApplyPalette(DEFAULT_OVERLAY_PALETTES[0])}
                            className="px-3 py-1 text-xs font-semibold rounded border border-slate-700 text-slate-400 hover:text-white"
                            type="button"
                        >
                            Reset
                        </button>
                    </div>

                    {/* Save Scheme */}
                    <div className="flex flex-col gap-3 mb-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                type="text"
                                value={schemeName}
                                onChange={(e) => onSchemeNameChange(e.target.value)}
                                placeholder="Scheme name"
                                className="min-w-[220px] bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                                onClick={onSaveScheme}
                                className="px-3 py-2 text-xs font-semibold rounded border border-blue-700 text-blue-200 hover:text-white hover:border-blue-400"
                                type="button"
                            >
                                Save Scheme
                            </button>
                        </div>
                    </div>

                    {/* Color Inputs Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <ColorInput
                            label="Base Text"
                            value={config.overlayText}
                            defaultColor="#ffffff"
                            placeholder="#ffffff"
                            onChange={(v) => updateConfig('overlayText', v)}
                        />
                        <ColorInput
                            label="Muted Text"
                            value={config.overlayMuted}
                            defaultColor="#94a3b8"
                            placeholder="#94a3b8"
                            onChange={(v) => updateConfig('overlayMuted', v)}
                        />
                        <ColorInput
                            label="Accent"
                            value={config.overlayAccent}
                            defaultColor="#60a5fa"
                            placeholder="#60a5fa"
                            onChange={(v) => updateConfig('overlayAccent', v)}
                        />
                        <ColorInput
                            label="Positive"
                            value={config.overlayPositive}
                            defaultColor="#4ade80"
                            placeholder="#4ade80"
                            onChange={(v) => updateConfig('overlayPositive', v)}
                        />
                        <ColorInput
                            label="Header Text"
                            value={config.overlayHeaderText}
                            defaultColor="#ffffff"
                            placeholder="#ffffff"
                            onChange={(v) => updateConfig('overlayHeaderText', v)}
                        />
                        <ColorInput
                            label="Header Background"
                            value={config.overlayHeaderBg}
                            defaultColor="#0f172a"
                            placeholder="rgba(15, 23, 42, 0.9)"
                            onChange={(v) => updateConfig('overlayHeaderBg', v)}
                        />
                        <ColorInput
                            label="Row Text"
                            value={config.overlayRowText}
                            defaultColor="#ffffff"
                            placeholder="#ffffff"
                            onChange={(v) => updateConfig('overlayRowText', v)}
                        />
                        <ColorInput
                            label="Row Background"
                            value={config.overlayRowBg}
                            defaultColor="#0f172a"
                            placeholder="rgba(15, 23, 42, 0.4)"
                            onChange={(v) => updateConfig('overlayRowBg', v)}
                        />
                        <ColorInput
                            label="Row Alt Background"
                            value={config.overlayRowAltBg}
                            defaultColor="#1e293b"
                            placeholder="rgba(30, 41, 59, 0.4)"
                            onChange={(v) => updateConfig('overlayRowAltBg', v)}
                        />
                        <ColorInput
                            label="Border"
                            value={config.overlayBorder}
                            defaultColor="#334155"
                            placeholder="rgba(51, 65, 85, 0.5)"
                            onChange={(v) => updateConfig('overlayBorder', v)}
                        />
                        <ColorInput
                            label="Overlay Background"
                            value={config.overlayBackground}
                            defaultColor="#0f172a"
                            placeholder="#0f172a"
                            onChange={(v) => updateConfig('overlayBackground', v)}
                        />
                    </div>
                </div>
            </details>
        </div>
    );
}
