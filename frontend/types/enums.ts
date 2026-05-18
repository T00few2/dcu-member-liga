// Named union types for values that were previously bare string literals throughout the codebase.
// Use these instead of repeating the same literal unions in every file.

export type EventMode = 'single' | 'multi' | 'grouped';
export type ResultsPhase = 'provisional' | 'finalized';
export type RaceType = 'scratch' | 'points' | 'time-trial';
export type SegmentType = 'sprint' | 'split';
