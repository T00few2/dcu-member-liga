'use client';

import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

interface ClubApiTabProps {
    user: User | null;
}

interface ClubApiClient {
    username: string;
    club: string;
    revoked: boolean;
    createdAt?: string | null;
    updatedAt?: string | null;
    lastUsedAt?: string | null;
}

interface IssuedSecret {
    username: string;
    club: string;
    secret: string;
    curl: string;
}

async function adminFetch(user: User, path: string, init: RequestInit = {}) {
    const token = await user.getIdToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return fetch(`${API_URL}${path}`, { ...init, headers });
}

function formatWhen(value?: string | null) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('da-DK');
}

export default function ClubApiTab({ user }: ClubApiTabProps) {
    const [clients, setClients] = useState<ClubApiClient[]>([]);
    const [clubs, setClubs] = useState<string[]>([]);
    const [club, setClub] = useState('');
    const [username, setUsername] = useState('');
    const [issued, setIssued] = useState<IssuedSecret | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setError('');
        try {
            const response = await adminFetch(user, '/admin/club-api/clients');
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setError(body.message || 'Could not load club API logins.');
                return;
            }
            setClients(body.clients || []);
            setClubs(body.clubs || []);
        } catch {
            setError('Could not load club API logins.');
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        void load();
    }, [load]);

    const showIssued = (body: { client: ClubApiClient; secret: string }) => {
        const curl = `curl -u "${body.client.username}:${body.secret}" ${API_URL}/club-api`;
        setIssued({
            username: body.client.username,
            club: body.client.club,
            secret: body.secret,
            curl,
        });
    };

    const createClient = async () => {
        if (!user || !club || !username.trim()) return;
        setBusy(true);
        setError('');
        try {
            const response = await adminFetch(user, '/admin/club-api/clients', {
                method: 'POST',
                body: JSON.stringify({ club, username: username.trim() }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setError(body.message || 'Could not create the login.');
                return;
            }
            setUsername('');
            showIssued(body);
            await load();
        } catch {
            setError('Could not create the login.');
        } finally {
            setBusy(false);
        }
    };

    const rotate = async (clientUsername: string) => {
        if (!user) return;
        if (!window.confirm('Replace the secret now? The current secret stops working immediately.')) return;
        setBusy(true);
        setError('');
        try {
            const response = await adminFetch(user, `/admin/club-api/clients/${encodeURIComponent(clientUsername)}/rotate`, {
                method: 'POST',
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setError(body.message || 'Could not replace the secret.');
                return;
            }
            showIssued(body);
            await load();
        } catch {
            setError('Could not replace the secret.');
        } finally {
            setBusy(false);
        }
    };

    const setRevoked = async (clientUsername: string, revoked: boolean) => {
        if (!user) return;
        if (revoked && !window.confirm('Revoke this login? The club can no longer call the API.')) return;
        setBusy(true);
        setError('');
        try {
            const action = revoked ? 'revoke' : 'restore';
            const response = await adminFetch(user, `/admin/club-api/clients/${encodeURIComponent(clientUsername)}/${action}`, {
                method: 'POST',
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setError(body.message || 'Could not update the login.');
                return;
            }
            await load();
        } catch {
            setError('Could not update the login.');
        } finally {
            setBusy(false);
        }
    };

    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            setError('Could not copy. Select the text and copy it manually.');
        }
    };

    if (!user) return null;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-foreground">Club API</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    A club sends its username and secret on every request. The secret is shown once, when you create or replace it.
                </p>
            </div>

            {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            {issued && (
                <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                    <p className="font-medium text-card-foreground">
                        Secret for {issued.club} ({issued.username})
                    </p>
                    <p className="text-sm text-muted-foreground">
                        Copy this now. It is not shown again. The field list is <span className="font-mono">GET /club-api</span>.
                        Each login can make 60 requests a minute.
                    </p>
                    <label className="block text-sm">
                        <span className="text-muted-foreground">Secret</span>
                        <input readOnly value={issued.secret} className="mt-1 w-full font-mono text-sm bg-muted border border-border rounded px-3 py-2" />
                    </label>
                    <label className="block text-sm">
                        <span className="text-muted-foreground">Base URL</span>
                        <input readOnly value={API_URL} className="mt-1 w-full font-mono text-sm bg-muted border border-border rounded px-3 py-2" />
                    </label>
                    <label className="block text-sm">
                        <span className="text-muted-foreground">Example</span>
                        <textarea readOnly value={issued.curl} rows={2} className="mt-1 w-full font-mono text-sm bg-muted border border-border rounded px-3 py-2" />
                    </label>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => copy(issued.secret)} className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 text-sm font-medium">
                            Copy secret
                        </button>
                        <button type="button" onClick={() => copy(issued.curl)} className="border border-border px-4 py-2 rounded hover:bg-muted text-sm font-medium">
                            Copy example
                        </button>
                    </div>
                </div>
            )}

            <form
                className="bg-card border border-border rounded-lg p-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                onSubmit={(event) => {
                    event.preventDefault();
                    void createClient();
                }}
            >
                <label className="block text-sm">
                    <span className="text-muted-foreground">Club</span>
                    <select
                        value={club}
                        onChange={(event) => setClub(event.target.value)}
                        className="mt-1 w-full bg-background border border-border rounded px-3 py-2"
                    >
                        <option value="">Choose a club</option>
                        {clubs.map((name) => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                </label>
                <label className="block text-sm">
                    <span className="text-muted-foreground">Username</span>
                    <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="example-club"
                        className="mt-1 w-full bg-background border border-border rounded px-3 py-2"
                    />
                </label>
                <button
                    type="submit"
                    disabled={busy || !club || !username.trim()}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium disabled:opacity-50"
                >
                    Create login
                </button>
            </form>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
                {loading ? (
                    <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                ) : clients.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No club API logins yet.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-muted text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3 font-medium">Club</th>
                                    <th className="px-4 py-3 font-medium">Username</th>
                                    <th className="px-4 py-3 font-medium">Last used</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {clients.map((client) => (
                                    <tr key={client.username}>
                                        <td className="px-4 py-3">{client.club}</td>
                                        <td className="px-4 py-3 font-mono">{client.username}</td>
                                        <td className="px-4 py-3 text-muted-foreground">{formatWhen(client.lastUsedAt)}</td>
                                        <td className="px-4 py-3">{client.revoked ? 'Revoked' : 'Active'}</td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                                            <button type="button" disabled={busy} onClick={() => rotate(client.username)} className="text-primary hover:underline disabled:opacity-50">
                                                New secret
                                            </button>
                                            {client.revoked ? (
                                                <button type="button" disabled={busy} onClick={() => setRevoked(client.username, false)} className="text-primary hover:underline disabled:opacity-50">
                                                    Restore
                                                </button>
                                            ) : (
                                                <button type="button" disabled={busy} onClick={() => setRevoked(client.username, true)} className="text-red-600 hover:underline disabled:opacity-50">
                                                    Revoke
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
