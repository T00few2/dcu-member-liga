'use client';

import type { Segment, SelectedSegment } from '@/types/admin';
import { groupSegmentsByLap } from '@/hooks/useLeagueData';

interface SegmentPickerProps {
    segments: Segment[];
    selectedSprints: SelectedSegment[];
    onToggle: (segment: Segment) => void;
    segmentType: 'sprint' | 'split';
    maxLaps?: number;
    compact?: boolean;
}

export default function SegmentPicker({
    segments,
    selectedSprints,
    onToggle,
    segmentType,
    maxLaps,
    compact = false,
}: SegmentPickerProps) {
    const segmentsByLap = groupSegmentsByLap(segments);
    const label = segmentType === 'split' ? 'Split Segments' : 'Sprint Segments';

    if (segments.length === 0) {
        return (
            <p className="text-sm text-muted-foreground italic">
                No segments found. Select a route first.
            </p>
        );
    }

    if (compact) {
        return (
            <div className="max-h-60 overflow-y-auto bg-muted/10">
                {Object.keys(segmentsByLap)
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map(lapKey => {
                        const lapNum = parseInt(lapKey);
                        if (maxLaps && lapNum > maxLaps) return null;

                        return (
                            <div key={lapNum} className="mb-2">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 bg-muted/30 px-1 rounded">
                                    Lap {lapNum}
                                </div>
                                {segmentsByLap[lapNum].map(seg => {
                                    const uniqueKey = `${seg.id}_${seg.count}`;
                                    const isSelected = selectedSprints.some(s => s.key === uniqueKey);
                                    
                                    return (
                                        <label
                                            key={uniqueKey}
                                            className="flex items-center gap-2 p-1.5 hover:bg-muted/50 rounded cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => onToggle(seg)}
                                                className="w-3 h-3 rounded border-input text-primary focus:ring-primary"
                                            />
                                            <div className="text-xs truncate" title={`${seg.name} (${seg.direction})`}>
                                                {seg.name}
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        );
                    })}
            </div>
        );
    }

    return (
        <div className="space-y-4 max-h-96 overflow-y-auto">
            {Object.keys(segmentsByLap)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .map(lapKey => {
                    const lapNum = parseInt(lapKey);
                    if (maxLaps && lapNum > maxLaps) return null;

                    return (
                        <div key={lapNum} className="border border-border rounded-md overflow-hidden">
                            <div className="bg-muted/30 px-3 py-2 text-sm font-semibold text-muted-foreground border-b border-border">
                                Lap {lapNum}
                            </div>
                            <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                {segmentsByLap[lapNum].map(seg => {
                                    const uniqueKey = `${seg.id}_${seg.count}`;
                                    const isSelected = selectedSprints.some(s => s.key === uniqueKey);
                                    
                                    return (
                                        <label
                                            key={uniqueKey}
                                            className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer border border-transparent hover:border-border transition"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => onToggle(seg)}
                                                className="w-4 h-4 rounded border-input text-primary focus:ring-primary"
                                            />
                                            <div className="text-sm">
                                                <div className="font-medium text-foreground">{seg.name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {seg.direction} • Occurrence #{seg.count}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
        </div>
    );
}

// Collapsible variant for use in category configuration
interface CollapsibleSegmentPickerProps extends SegmentPickerProps {
    title?: string;
}

export function CollapsibleSegmentPicker({
    segments,
    selectedSprints,
    onToggle,
    segmentType,
    maxLaps,
    title,
}: CollapsibleSegmentPickerProps) {
    const label = title || (segmentType === 'split' ? 'Split Segments' : 'Sprint Segments');
    const segmentsByLap = groupSegmentsByLap(segments);

    return (
        <details className="group border border-input rounded bg-background">
            <summary className="list-none flex justify-between items-center p-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <span>
                    {label} ({selectedSprints.length} selected)
                </span>
                <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                    ▼
                </span>
            </summary>
            
            <div className="p-2 border-t border-input max-h-60 overflow-y-auto bg-muted/10">
                {Object.keys(segmentsByLap)
                    .sort((a, b) => parseInt(a) - parseInt(b))
                    .map(lapKey => {
                        const lapNum = parseInt(lapKey);
                        if (maxLaps && lapNum > maxLaps) return null;

                        return (
                            <div key={lapNum} className="mb-2">
                                <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1 bg-muted/30 px-1 rounded">
                                    Lap {lapNum}
                                </div>
                                {segmentsByLap[lapNum].map(seg => {
                                    const uniqueKey = `${seg.id}_${seg.count}`;
                                    const isSelected = selectedSprints.some(s => s.key === uniqueKey);
                                    
                                    return (
                                        <label
                                            key={uniqueKey}
                                            className="flex items-center gap-2 p-1.5 hover:bg-muted/50 rounded cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => onToggle(seg)}
                                                className="w-3 h-3 rounded border-input text-primary focus:ring-primary"
                                            />
                                            <div className="text-xs truncate" title={`${seg.name} (${seg.direction})`}>
                                                {seg.name}
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        );
                    })}
                {segments.length === 0 && (
                    <div className="text-xs text-muted-foreground p-2 text-center italic">
                        No segments found. Select Route first.
                    </div>
                )}
            </div>
        </details>
    );
}
