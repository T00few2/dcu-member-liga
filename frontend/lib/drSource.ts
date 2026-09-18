export function isVoluntaryDualRecording(source?: string | null): boolean {
    return source === 'opt_in';
}

export function dualRecordingSourceCopy(source?: string | null): {
    short: string;
    title: string;
} {
    if (isVoluntaryDualRecording(source)) {
        return {
            short: 'Frivillig',
            title: 'Frivillig dual recording — ikke grundlag for DC',
        };
    }
    return {
        short: 'Påkrævet',
        title: 'Påkrævet dual recording — overvej DC ved underkendelse',
    };
}
