import type { StoredSession } from '@/lib/dualRecording/samples';

const DB_NAME = 'dcu-dual-record';
const STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveDualSession(session: StoredSession): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(session, session.raceId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

export async function loadDualSession(raceId: string): Promise<StoredSession | null> {
    const db = await openDb();
    const session = await new Promise<StoredSession | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(raceId);
        request.onsuccess = () => resolve((request.result as StoredSession | undefined) ?? null);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return session;
}

export async function clearDualSession(raceId: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(raceId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}
