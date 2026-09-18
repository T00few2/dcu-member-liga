import type { PowerUnit } from '../_lib/stats-types';

type PowerUnitToggleProps = {
    value: PowerUnit;
    onChange: (unit: PowerUnit) => void;
};

export function PowerUnitToggle({ value, onChange }: PowerUnitToggleProps) {
    return (
        <div className="inline-flex rounded-lg border border-input overflow-hidden" role="group" aria-label="Effekt-enhed">
            <button
                type="button"
                onClick={() => onChange('watts')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${value === 'watts' ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted/60'}`}
            >
                W
            </button>
            <button
                type="button"
                onClick={() => onChange('wkg')}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-input ${value === 'wkg' ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground hover:bg-muted/60'}`}
            >
                W/kg
            </button>
        </div>
    );
}
