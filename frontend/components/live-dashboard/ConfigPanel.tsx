'use client';

import { User } from 'firebase/auth';
import type { LiveConfig } from '@/types/overlay';

interface ConfigPanelProps {
    config: LiveConfig;
    user: User | null;
    updateConfig: <K extends keyof LiveConfig>(field: K, value: LiveConfig[K]) => void;
}

export default function ConfigPanel({ config, user, updateConfig }: ConfigPanelProps) {
    return (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-8">
            <h2 className="text-xl font-semibold mb-4 text-slate-200 border-b border-slate-700 pb-2">
                Configuration
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Core Settings */}
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Row Limit</label>
                        <input 
                            type="number" 
                            value={config.limit}
                            onChange={(e) => updateConfig('limit', parseInt(e.target.value) || 10)}
                            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">
                            Name Max Length (optional)
                        </label>
                        <input 
                            type="number" 
                            min={1}
                            value={config.nameMax}
                            onChange={(e) => updateConfig('nameMax', e.target.value)}
                            placeholder="# characters"
                            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                </div>

                {/* Cycle & Display */}
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">
                            Cycle Time (seconds)
                        </label>
                        <input 
                            type="number" 
                            value={config.cycle}
                            onChange={(e) => updateConfig('cycle', parseInt(e.target.value) || 0)}
                            placeholder="0 to disable"
                            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                            Cycles view between Race Results and League Standings. Set to 0 to disable.
                        </p>
                    </div>
                </div>

                {/* Toggles */}
                <div className="space-y-3">
                    <label className="flex items-center space-x-3 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={config.transparent}
                            onChange={(e) => updateConfig('transparent', e.target.checked)}
                            className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-slate-300">Transparent Background</span>
                    </label>
                    
                    <label className="flex items-center space-x-3 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={config.scroll}
                            onChange={(e) => updateConfig('scroll', e.target.checked)}
                            className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-slate-300">Auto-Scroll</span>
                    </label>
                </div>

                {/* Full Screen Options */}
                <div className="space-y-3">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                        Full Screen Options
                    </div>
                    <label className="flex items-center space-x-3 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={config.includeBanner}
                            onChange={(e) => updateConfig('includeBanner', e.target.checked)}
                            className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-slate-300">Include Banner</span>
                    </label>
                    <label className="flex items-center space-x-3 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={config.fitToScreen}
                            onChange={(e) => updateConfig('fitToScreen', e.target.checked)}
                            className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-slate-300">Fit to Screen</span>
                    </label>
                </div>
            </div>

            {/* Calculation Settings Panel (Authenticated Only) */}
            {user && (
                <div className="mt-6 pt-6 border-t border-slate-700">
                    <h3 className="text-sm font-semibold uppercase text-slate-400 mb-4 tracking-wider">
                        Calculation Settings (For "Calc" Buttons)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Source Data</label>
                            <select 
                                value={config.source}
                                onChange={(e) => updateConfig('source', e.target.value as LiveConfig['source'])}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="finishers">Finishers (Final Results)</option>
                                <option value="joined">Joined (Currently in Pen/Race)</option>
                                <option value="signed_up">Signed Up (Registration List)</option>
                            </select>
                        </div>
                        <div className="flex items-end pb-2">
                            <label className="flex items-center space-x-3 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={config.filterRegistered}
                                    onChange={(e) => updateConfig('filterRegistered', e.target.checked)}
                                    className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                />
                                <span className="text-slate-300">Filter Registered (Show Only Registered)</span>
                            </label>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
