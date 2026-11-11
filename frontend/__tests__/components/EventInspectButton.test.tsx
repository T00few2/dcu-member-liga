import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EventInspectButton from '@/components/admin/league-manager/EventInspectButton';

vi.mock('@/lib/firebase', () => ({
    auth: { currentUser: { getIdToken: async () => 'token' } },
}));

const inspected = {
    id: 5780631,
    name: 'DCU race',
    description: '',
    type: 'EVENT_TYPE_RACE',
    sport: 'CYCLING',
    eventStart: '2026-11-11T18:00:00.000+00:00',
    imageUrl: null,
    url: 'https://www.zwift.com/events/view/5780631',
    rulesId: 1,
    rules: ['NO_POWERUPS'],
    cullingType: 'CULLING_SUBGROUP_ONLY',
    lateJoinInMinutes: 30,
    visible: true,
    privateEvent: false,
    unlisted: true,
    restricted: true,
    invisibleToNonParticipants: true,
    categoryEnforcement: false,
    accessExpression: null,
    rangeAccessLabel: null,
    partnerClientId: 'dcu',
    signedUpCount: 10,
    joinedCount: 8,
    bikeHash: 1,
    bikeName: 'Tarmac',
    frontWheelHash: null,
    frontWheelName: null,
    rearWheelHash: null,
    rearWheelName: null,
    upgradePhysicsDisabled: false,
    physics: {},
    steering: 'enabled',
    brakingDisabled: false,
    unlocks: [],
    tags: ['showplacements'],
    routeId: 99,
    routeName: 'Neon Shore Loop',
    routeWorld: 'Makuri Islands',
    routeDistanceInMeters: 32951,
    routeAscentInMeters: 253,
    leadInDistanceInMeters: null,
    leadInAscentInMeters: null,
    mapId: 9,
    worldId: 1,
    world: 'Watopia',
    laps: 1,
    distanceInMeters: 0,
    durationInSeconds: 0,
    subgroups: [],
    raw: { id: 5780631, name: 'DCU race' },
};

describe('EventInspectButton', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => inspected,
        })));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('stays closed until the id is a number', () => {
        render(<EventInspectButton eventId="" />);
        expect(screen.getByRole('button', { name: 'Inspect Zwift event' })).toBeDisabled();
    });

    it('opens the inspection and treats a missing steering tag as enabled', async () => {
        const user = userEvent.setup();
        render(<EventInspectButton eventId="5780631" />);
        await user.click(screen.getByRole('button', { name: 'Inspect Zwift event' }));
        expect(await screen.findByRole('dialog', { name: 'Event inspection' })).toBeInTheDocument();
        expect(await screen.findByText('Neon Shore Loop · 99')).toBeInTheDocument();
        expect(screen.getByText('Enabled')).toBeInTheDocument();
        expect(screen.getByText(/When that tag is missing, steering is enabled/)).toBeInTheDocument();
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('/admin/zwift/events/5780631');
    });
});
