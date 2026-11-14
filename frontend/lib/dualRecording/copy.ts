export function dualSideLabel(source?: string | null): string {
    if (source === 'direct') return 'Wattmåler';
    if (source === 'upload') return 'FIT-fil';
    return 'Strava';
}

export const DUAL_EXPERIMENTAL_DA =
    'Eksperimentelt. Du kan stadig blive bedt om at uploade turen til Strava.';

export const DUAL_PAIRING_DA =
    'Par hometraineren i Zwift, og lad wattmåleren være til optagelsen. De fleste wattmålere tager kun én Bluetooth-forbindelse. Du kan også forbinde træneren her (valgfrit). Hvis træneren kun har én Bluetooth-forbindelse, så par den i Zwift over ANT+, eller optag uden den.';
