import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPreEntryGame } from '@nomad-city-online/game-core';
import { RoomDirectory } from './room-directory.js';
import { migrateRoomStore, PostgresRoomStore } from './postgres-room-store.js';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { createAutomaticBaseRoomSnapshot } from './base-room-factory.js';

const db = new PGlite(), sql: RoomSqlExecutor = { query: async (text, values) => {
  const r = await db.query<Record<string, unknown>>(text, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
} };
const directory = new RoomDirectory(sql), store = new PostgresRoomStore(sql);
const principal = { authenticatedUserId: 'directory-owner' };
const ownIds = ['directory-A', 'directory-Z', 'directory-a', 'directory-z'];
beforeAll(async () => {
  await migrateRoomStore(sql); await migrateRoomStore(sql);
  for (const [index, id] of [...ownIds, 'directory-0-other'].entries()) {
    const count = index === 2 ? 3 : index === 3 ? 4 : 2;
    const colors = ['red', 'blue', 'green', 'yellow'] as const;
    const players = colors.slice(0, count).map((color, n) => ({ id: `p${n + 1}`, color }));
    const members = players.map((p, n) => ({ playerId: p.id, userId: n === 0 && index < 4 ? 'directory-owner' : `other-${index}-${n}` }));
    const room = createAutomaticBaseRoomSnapshot({ roomId: id, gameId: `game-${id}`, players, members,
      startingPlayerId: 'p1', clockwisePlayerIds: players.map(p => p.id) });
    expect(await store.create(room)).toBe(true);
  }
  const legacy = createPreEntryGame('game-directory-legacy', [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }]);
  await store.create({ roomId: 'legacy-room', ...legacy, members: [{ userId: 'legacy-user', playerId: 'p2' }, { userId: 'legacy-other', playerId: 'p1' }] });
});
afterAll(() => db.close());
describe('membership-filtered room directory', () => {
  it('lists only the caller rooms in stable C order, using bounded keyset pages', async () => {
    const a = await directory.list(principal, { limit: 2 });
    expect(a.status).toBe('listed'); if (a.status !== 'listed') return;
    expect(a.rooms.map(r => r.roomId)).toEqual(ownIds.slice(0, 2)); expect(a.nextAfterRoomId).toBe(ownIds[1]);
    const b = await directory.list(principal, { limit: 2, afterRoomId: a.nextAfterRoomId });
    expect(b.status).toBe('listed'); if (b.status !== 'listed') return;
    expect(b.rooms.map(r => r.roomId)).toEqual(ownIds.slice(2)); expect(b.nextAfterRoomId).toBeNull();
    expect(b.rooms.map(r => r.playerCount)).toEqual([3, 4]);
  });
  it('returns an empty page for nonmembers, without a global count or room existence hint', async () => {
    expect(await directory.list({ authenticatedUserId: 'outsider' }, {})).toEqual({ status: 'listed', rooms: [], nextAfterRoomId: null });
    expect(await directory.list({ authenticatedUserId: 'outsider' }, { afterRoomId: ownIds[0] })).toEqual({ status: 'listed', rooms: [], nextAfterRoomId: null });
  });
  it('uses only the authenticated principal, with exact matching rather than substring matching', async () => {
    expect(await directory.list({ authenticatedUserId: 'directory' }, {})).toEqual({ status: 'listed', rooms: [], nextAfterRoomId: null });
    const result = await directory.list({ authenticatedUserId: 'other-4-1' }, {});
    expect(result).toMatchObject({ status: 'listed', rooms: [{ roomId: 'directory-0-other', playerId: 'p2' }] });
  });
  it('allowlists detached, frozen metadata without reading or mutating a full game', async () => {
    const before = await store.read(ownIds[0]!);
    const spy = vi.spyOn(sql, 'query');
    const result = await directory.list(principal, {});
    expect(spy).toHaveBeenCalledTimes(1); expect(spy.mock.calls[0]![0]).not.toMatch(/SELECT\s+\*|UPDATE|INSERT/i); spy.mockRestore();
    expect(result.status).toBe('listed'); if (result.status !== 'listed') return;
    expect(Object.keys(result.rooms[0]!).sort()).toEqual(['gameId', 'phase', 'playerCount', 'playerId', 'roomId', 'roundNumber', 'scored', 'stateVersion'].sort());
    expect(result.rooms[0]).toMatchObject({ stateVersion: 1, phase: 'entry', roundNumber: null, scored: false });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.rooms[0])).toBe(true);
    expect(await store.read(ownIds[0]!)).toEqual(before);
  });
  it('keeps legacy unstarted rooms discoverable without inventing a round or setup history', async () => {
    expect(await directory.list({ authenticatedUserId: 'legacy-user' }, {})).toEqual({ status: 'listed', nextAfterRoomId: null,
      rooms: [{ roomId: 'legacy-room', gameId: 'game-directory-legacy', playerId: 'p2', playerCount: 2, stateVersion: 0, phase: 'entry', roundNumber: null, scored: false }] });
  });
  it('never repeats the cursor room and can resume beyond the last page', async () => {
    const result = await directory.list(principal, { limit: 1, afterRoomId: ownIds[0] });
    expect(result).toMatchObject({ rooms: [{ roomId: ownIds[1] }], nextAfterRoomId: ownIds[1] });
    expect(await directory.list(principal, { afterRoomId: ownIds.at(-1) })).toEqual({ status: 'listed', rooms: [], nextAfterRoomId: null });
  });
  it.each([null, [], { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { afterRoomId: "' OR true --" }, { userId: 'other-4-1' }, { limit: 1, state: {} }])('rejects malformed or identity-injecting requests without SQL %#', async input => {
    const query = vi.fn(); const target = new RoomDirectory({ query });
    expect(await target.list(principal, input)).toMatchObject({ error: { code: 'INVALID_MESSAGE' } }); expect(query).not.toHaveBeenCalled();
  });
  it('rejects an untrusted principal without SQL', async () => {
    const query = vi.fn();
    expect(await new RoomDirectory({ query }).list({ authenticatedUserId: 'bad identity' }, {})).toMatchObject({ error: { code: 'AUTH_REQUIRED' } }); expect(query).not.toHaveBeenCalled();
  });
  it('normalizes query and corrupt metadata failures without partial success or raw errors', async () => {
    const broken = new RoomDirectory({ query: async () => { throw Error('DO_NOT_LEAK'); } });
    expect(await broken.list(principal, {})).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
    const corrupt = new RoomDirectory({ query: async () => ({ rows: [{ room_id: 'private-room', state_version: '9007199254740992' }], rowCount: 1 }) });
    expect(await corrupt.list(principal, {})).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
  });
  it('allows a fresh directory instance to recover the same persisted membership page', async () => {
    expect(await new RoomDirectory(sql).list(principal, {})).toEqual(await directory.list(principal, {}));
  });
});
