export interface CrankPoint {
    revs: number;
    time: number;
}

const CRANK_FLAG = 0x0020;

export function parseHeartRate(view: DataView): number | null {
    if (view.byteLength < 2) return null;
    const flags = view.getUint8(0);
    const hr = flags & 0x01 ? (view.byteLength >= 3 ? view.getUint16(1, true) : null) : view.getUint8(1);
    if (hr == null || hr > 250) return null;
    return hr;
}

export function cadenceFromCrank(
    previous: CrankPoint | null,
    revs: number,
    eventTime: number,
): { rpm: number | null; next: CrankPoint } {
    const next = { revs, time: eventTime };
    if (!previous) return { rpm: null, next };
    let deltaRevs = revs - previous.revs;
    if (deltaRevs < 0) deltaRevs += 65536;
    let deltaTime = eventTime - previous.time;
    if (deltaTime < 0) deltaTime += 65536;
    if (deltaRevs <= 0 || deltaTime <= 0) return { rpm: null, next };
    const rpm = (deltaRevs / (deltaTime / 1024)) * 60;
    if (!Number.isFinite(rpm) || rpm > 250) return { rpm: null, next };
    return { rpm: Math.round(rpm), next };
}

export function parseCyclingPower(
    view: DataView,
    previous: CrankPoint | null,
): { watts: number | null; cadence: number | null; crank: CrankPoint | null } {
    if (view.byteLength < 4) return { watts: null, cadence: null, crank: previous };
    const flags = view.getUint16(0, true);
    let offset = 2;
    const watts = view.getInt16(offset, true);
    offset += 2;
    if (flags & 0x0001) offset += 1;
    if (flags & 0x0004) offset += 2;
    if (flags & 0x0010) offset += 6;
    if (!(flags & CRANK_FLAG) || view.byteLength < offset + 4) {
        return { watts, cadence: null, crank: previous };
    }
    const revs = view.getUint16(offset, true);
    const eventTime = view.getUint16(offset + 2, true);
    const cadence = cadenceFromCrank(previous, revs, eventTime);
    return { watts, cadence: cadence.rpm, crank: cadence.next };
}

export function parseIndoorBike(view: DataView): { watts: number | null; cadence: number | null } {
    if (view.byteLength < 2) return { watts: null, cadence: null };
    const flags = view.getUint16(0, true);
    let offset = 2;
    const take = (bytes: number, present: boolean) => {
        if (!present) return;
        offset += bytes;
    };
    take(2, (flags & 0x0001) === 0);
    take(2, (flags & 0x0002) !== 0);
    let cadence: number | null = null;
    if (flags & 0x0004) {
        if (view.byteLength >= offset + 2) cadence = Math.round(view.getUint16(offset, true) / 2);
        offset += 2;
    }
    take(2, (flags & 0x0008) !== 0);
    take(3, (flags & 0x0010) !== 0);
    take(2, (flags & 0x0020) !== 0);
    let watts: number | null = null;
    if ((flags & 0x0040) && view.byteLength >= offset + 2) {
        watts = view.getInt16(offset, true);
    }
    return { watts, cadence };
}
