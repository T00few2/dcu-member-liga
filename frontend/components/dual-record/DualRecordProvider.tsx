'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { parseCyclingPower, parseHeartRate, parseIndoorBike, type CrankPoint } from '@/lib/dualRecording/ble';
import { bleNavigator, type BleDevice } from '@/lib/dualRecording/webBluetooth';
import { clearDualSession, loadDualSession, saveDualSession } from '@/lib/dualRecording/idb';
import { summarizeSamples, type DualSample, type DualSummary } from '@/lib/dualRecording/samples';

const POWER_SERVICE = 'cycling_power';
const POWER_CHAR = 'cycling_power_measurement';
const HR_SERVICE = 'heart_rate';
const HR_CHAR = 'heart_rate_measurement';
const TRAINER_SERVICE = 'fitness_machine';
const TRAINER_CHAR = 'indoor_bike_data';

type Phase = 'idle' | 'arming' | 'recording' | 'summary' | 'uploading' | 'uploaded';

interface LiveNumbers {
    watts: number | null;
    cadence: number | null;
    hr: number | null;
    trainerWatts: number | null;
    pmConnected: boolean;
    hrConnected: boolean;
    trainerConnected: boolean;
    pmLive: boolean;
    hrLive: boolean;
}

interface DualRecordContextValue {
    raceId: string | null;
    phase: Phase;
    live: LiveNumbers;
    summary: DualSummary | null;
    error: string;
    resumed: boolean;
    bind: (raceId: string) => void;
    connectPower: () => Promise<void>;
    connectHeartRate: () => Promise<void>;
    connectTrainer: () => Promise<void>;
    reconnectPower: () => Promise<void>;
    start: () => Promise<void>;
    resumeRecording: () => void;
    finish: () => void;
    upload: () => Promise<void>;
}

const EMPTY_LIVE: LiveNumbers = {
    watts: null,
    cadence: null,
    hr: null,
    trainerWatts: null,
    pmConnected: false,
    hrConnected: false,
    trainerConnected: false,
    pmLive: false,
    hrLive: false,
};

const DualRecordContext = createContext<DualRecordContextValue | null>(null);

export function useDualRecord(): DualRecordContextValue {
    const value = useContext(DualRecordContext);
    if (!value) throw new Error('useDualRecord must be used inside DualRecordProvider');
    return value;
}

export default function DualRecordProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [raceId, setRaceId] = useState<string | null>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [live, setLive] = useState<LiveNumbers>(EMPTY_LIVE);
    const [summary, setSummary] = useState<DualSummary | null>(null);
    const [error, setError] = useState('');
    const [resumed, setResumed] = useState(false);
    const samples = useRef<DualSample[]>([]);
    const devices = useRef<{ powerMeter?: string; heartRate?: string; trainer?: string }>({});
    const powerDevice = useRef<BleDevice | null>(null);
    const powerOk = useRef(false);
    const crank = useRef<CrankPoint | null>(null);
    const raceRef = useRef<string | null>(null);
    const phaseRef = useRef<Phase>('idle');

    useEffect(() => { phaseRef.current = phase; }, [phase]);

    const persist = useCallback(async (id: string) => {
        if (!samples.current.length) return;
        await saveDualSession({
            raceId: id,
            samples: samples.current,
            devices: devices.current,
            updatedAt: Date.now(),
        });
    }, []);

    const bind = useCallback((nextRaceId: string) => {
        if (raceRef.current === nextRaceId && phaseRef.current === 'recording') return;
        raceRef.current = nextRaceId;
        setRaceId(nextRaceId);
        setError('');
        void loadDualSession(nextRaceId).then((saved) => {
            if (!saved || raceRef.current !== nextRaceId) return;
            samples.current = saved.samples;
            devices.current = saved.devices || {};
            setResumed(saved.samples.length > 0);
            if (phaseRef.current === 'recording') return;
            setSummary(summarizeSamples(saved.samples));
            setPhase('summary');
        }).catch(() => undefined);
    }, []);

    useEffect(() => {
        if (phase !== 'recording' || !raceId) return undefined;
        const id = raceId;
        const timer = window.setInterval(() => { void persist(id); }, 2000);
        let lock: { release: () => Promise<void> } | null = null;
        let audio: AudioContext | null = null;
        const claim = async () => {
            try {
                lock = await bleNavigator()?.wakeLock?.request('screen') ?? null;
            } catch {
                lock = null;
            }
        };
        void claim();
        try {
            const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (Ctx) {
                audio = new Ctx();
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                gain.gain.value = 0.0001;
                osc.connect(gain);
                gain.connect(audio.destination);
                osc.start();
                void audio.resume();
            }
        } catch {
            audio = null;
        }
        const onVisible = () => { if (document.visibilityState === 'visible') void claim(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
            void lock?.release();
            void audio?.close();
        };
    }, [phase, raceId, persist]);

    const noteSample = useCallback((patch: Partial<DualSample>) => {
        if (phaseRef.current !== 'recording') return;
        const previous = samples.current[samples.current.length - 1];
        const has = (key: keyof DualSample) => Object.prototype.hasOwnProperty.call(patch, key);
        samples.current.push({
            t: Date.now(),
            watts: has('watts') ? patch.watts ?? null : (powerOk.current ? previous?.watts ?? null : null),
            cadence: has('cadence') ? patch.cadence ?? null : previous?.cadence ?? null,
            hr: has('hr') ? patch.hr ?? null : previous?.hr ?? null,
            trainerWatts: has('trainerWatts') ? patch.trainerWatts ?? null : previous?.trainerWatts ?? null,
        });
    }, []);

    const watch = useCallback(async (
        device: BleDevice,
        serviceName: string,
        characteristicName: string,
        onValue: (view: DataView) => void,
        onDisconnect?: () => void,
    ) => {
        const server = await device.gatt?.connect();
        if (!server) throw new Error('Ingen forbindelse');
        const service = await server.getPrimaryService(serviceName);
        const characteristic = await service.getCharacteristic(characteristicName);
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = (event.target as unknown as { value?: DataView | null }).value;
            if (value) onValue(value);
        });
        if (onDisconnect) {
            device.addEventListener('gattserverdisconnected', onDisconnect);
        }
    }, []);

    const connectPower = useCallback(async () => {
        setError('');
        const ble = bleNavigator();
        if (!ble?.bluetooth) {
            setError('Denne browser kan ikke forbinde til wattmålere.');
            return;
        }
        try {
            const device = await ble.bluetooth.requestDevice({
                filters: [{ services: [POWER_SERVICE] }],
                optionalServices: [POWER_SERVICE],
            });
            powerDevice.current = device;
            devices.current.powerMeter = device.name || 'Wattmåler';
            await watch(device, POWER_SERVICE, POWER_CHAR, (view) => {
                const parsed = parseCyclingPower(view, crank.current);
                crank.current = parsed.crank;
                powerOk.current = true;
                setLive((current) => ({
                    ...current,
                    watts: parsed.watts,
                    cadence: parsed.cadence ?? current.cadence,
                    pmConnected: true,
                    pmLive: true,
                }));
                noteSample({ watts: parsed.watts, cadence: parsed.cadence });
            }, () => {
                powerOk.current = false;
                setLive((current) => ({ ...current, pmConnected: false }));
                noteSample({ watts: null });
            });
            setLive((current) => ({ ...current, pmConnected: true }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunne ikke forbinde wattmåleren');
        }
    }, [noteSample, watch]);

    const connectHeartRate = useCallback(async () => {
        setError('');
        const ble = bleNavigator();
        if (!ble?.bluetooth) return;
        try {
            const device = await ble.bluetooth.requestDevice({
                filters: [{ services: [HR_SERVICE] }],
                optionalServices: [HR_SERVICE],
            });
            devices.current.heartRate = device.name || 'Pulsmåler';
            await watch(device, HR_SERVICE, HR_CHAR, (view) => {
                const hr = parseHeartRate(view);
                setLive((current) => ({ ...current, hr, hrConnected: true, hrLive: hr != null }));
                noteSample({ hr });
            });
            setLive((current) => ({ ...current, hrConnected: true }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunne ikke forbinde pulsmåleren');
        }
    }, [noteSample, watch]);

    const connectTrainer = useCallback(async () => {
        setError('');
        const ble = bleNavigator();
        if (!ble?.bluetooth) return;
        try {
            const device = await ble.bluetooth.requestDevice({
                filters: [{ services: [TRAINER_SERVICE] }],
                optionalServices: [TRAINER_SERVICE],
            });
            devices.current.trainer = device.name || 'Træner';
            await watch(device, TRAINER_SERVICE, TRAINER_CHAR, (view) => {
                const parsed = parseIndoorBike(view);
                setLive((current) => ({
                    ...current,
                    trainerWatts: parsed.watts ?? current.trainerWatts,
                    trainerConnected: true,
                }));
                if (parsed.watts != null) noteSample({ trainerWatts: parsed.watts });
            });
            setLive((current) => ({ ...current, trainerConnected: true }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kunne ikke forbinde træneren');
        }
    }, [noteSample, watch]);

    const reconnectPower = useCallback(async () => {
        const device = powerDevice.current;
        if (!device) {
            await connectPower();
            return;
        }
        try {
            await watch(device, POWER_SERVICE, POWER_CHAR, (view) => {
                const parsed = parseCyclingPower(view, crank.current);
                crank.current = parsed.crank;
                powerOk.current = true;
                setLive((current) => ({
                    ...current,
                    watts: parsed.watts,
                    cadence: parsed.cadence ?? current.cadence,
                    pmConnected: true,
                    pmLive: true,
                }));
                noteSample({ watts: parsed.watts, cadence: parsed.cadence });
            }, () => {
                powerOk.current = false;
                setLive((current) => ({ ...current, pmConnected: false }));
                noteSample({ watts: null });
            });
        } catch {
            await connectPower();
        }
    }, [connectPower, noteSample, watch]);

    const start = useCallback(async () => {
        if (!live.pmLive || !live.hrLive) return;
        samples.current = [];
        setResumed(false);
        setPhase('recording');
        phaseRef.current = 'recording';
        try {
            await bleNavigator()?.wakeLock?.request('screen');
        } catch {
            /* The recording still runs while the page stays open. */
        }
    }, [live.hrLive, live.pmLive]);

    const resumeRecording = useCallback(() => {
        if (!live.pmLive || !live.hrLive) return;
        setPhase('recording');
        phaseRef.current = 'recording';
    }, [live.hrLive, live.pmLive]);

    const finish = useCallback(() => {
        if (phaseRef.current !== 'recording') return;
        const id = raceRef.current;
        setSummary(summarizeSamples(samples.current));
        setPhase('summary');
        if (id) void persist(id);
    }, [persist]);

    const upload = useCallback(async () => {
        const id = raceRef.current;
        if (!user || !id) return;
        setPhase('uploading');
        setError('');
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/profile/races/${id}/dual-recording`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ samples: samples.current, devices: devices.current }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || 'Upload fejlede');
            if (body.summary) setSummary(body.summary);
            await clearDualSession(id);
            setPhase('uploaded');
        } catch (err) {
            setPhase('summary');
            setError(err instanceof Error ? err.message : 'Upload fejlede');
        }
    }, [user]);

    const value = useMemo<DualRecordContextValue>(() => ({
        raceId,
        phase,
        live,
        summary,
        error,
        resumed,
        bind,
        connectPower,
        connectHeartRate,
        connectTrainer,
        reconnectPower,
        start,
        resumeRecording,
        finish,
        upload,
    }), [
        raceId, phase, live, summary, error, resumed, bind, connectPower, connectHeartRate,
        connectTrainer, reconnectPower, start, resumeRecording, finish, upload,
    ]);

    return <DualRecordContext.Provider value={value}>{children}</DualRecordContext.Provider>;
}
