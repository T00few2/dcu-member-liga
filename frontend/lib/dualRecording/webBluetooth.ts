/** Minimal Web Bluetooth shapes. The DOM lib in this project does not include them. */

export interface BleCharacteristic {
    value?: DataView | null;
    startNotifications: () => Promise<unknown>;
    addEventListener: (type: string, listener: (event: Event) => void) => void;
}

export interface BleDevice {
    name?: string;
    gatt?: { connect: () => Promise<BleServer> };
    addEventListener: (type: string, listener: () => void) => void;
}

export interface BleServer {
    getPrimaryService: (name: string) => Promise<{
        getCharacteristic: (name: string) => Promise<BleCharacteristic>;
    }>;
}

export interface BleNavigator {
    userAgent: string;
    bluetooth?: {
        requestDevice: (options: {
            filters: { services: string[] }[];
            optionalServices?: string[];
        }) => Promise<BleDevice>;
    };
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
}

export function bleNavigator(): BleNavigator | undefined {
    if (typeof navigator === 'undefined') return undefined;
    return navigator as unknown as BleNavigator;
}
