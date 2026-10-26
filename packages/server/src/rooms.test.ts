import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { NestFactory } from '@nestjs/core';
import type { Pool } from 'pg';
import { applyEntryCommand, beginEntry, createPreEntryGame, gameStateSchema } from '@nomad-city-online/game-core';
import type { GameState } from '@nomad-city-online/game-core';
import { migrateRoomStore, PostgresRoomStore } from './postgres-room-store.js';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { parseRoomSnapshot } from './room-state.js';
import type { RoomSnapshot, RoomStore } from './room-state.js';
import { RoomService } from './room-service.js';
import { RoomQueue } from './room-queue.js';
import { RoomModule } from './room.module.js';

// Compile-time proof that the production driver implements this adapter's SQL port.
const pgPort = (pool: Pool): RoomSqlExecutor => pool;
void pgPort;
const db = new PGlite();
const sql: RoomSqlExecutor = { query: async (text, values) => {
  const result = await db.query<Record<string, unknown>>(text, values);
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
} };
const store = new PostgresRoomStore(sql);
let sequence = 0;
function snapshot(): RoomSnapshot {
  const id = `room-test-${++sequence}`, g = createPreEntryGame(`game-${id}`, [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }]);
  return parseRoomSnapshot({ roomId: id, definition: g.definition,
    state: beginEntry(g.state, g.definition, { expectedVersion: 0, startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2'], greenDeckOrder: ['G03', 'G02', 'G04', 'G05', 'G06'] }),
    members: [{ userId: 'bob', playerId: 'p1' }, { userId: 'alice', playerId: 'p2' }] });
}
const principal = { authenticatedUserId: 'bob' };
function payload(s: GameState, nodeId = 'A-01') { return { apiVersion: '1.0.0', requestId: 'req-1', channel: 'entry', command: { gameId: s.gameId, expectedVersion: s.stateVersion, type: 'select-initial-node', nodeId } }; }
const nextState = (s: RoomSnapshot, nodeId = 'A-01') => applyEntryCommand(s.state, s.definition, { authenticatedPlayerId: 'p1' }, payload(s.state, nodeId).command);
async function fixture() { const s = snapshot(); expect(await store.create(s)).toBe(true); return s; }
function override(base: RoomStore, patch: Partial<RoomStore>): RoomStore {
  return { create: base.create.bind(base), read: base.read.bind(base), compareAndSwap: base.compareAndSwap.bind(base), ...patch };
}
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeAll(async () => { await migrateRoomStore(sql); });
afterAll(async () => { await db.close(); });

describe('fixed room membership and genuine SQL adapter contracts (PGlite)', () => {
  it('persists and restores a validated definition, roster and single state', async () => {
    const s = await fixture(), read = await new PostgresRoomStore(sql).read(s.roomId);
    expect(read).toEqual(s); expect(read).not.toBe(s); expect(Object.isFrozen(read!.state)).toBe(true);
  });
  it.each([
    [{ userId: 'same', playerId: 'p1' }, { userId: 'same', playerId: 'p2' }],
    [{ userId: 'bob', playerId: 'p1' }, { userId: 'alice', playerId: 'p1' }],
    [{ userId: 'bob', playerId: 'p1' }, { userId: 'alice', playerId: 'outsider' }],
  ])('rejects duplicate or incomplete mappings %#', members => { expect(() => parseRoomSnapshot({ ...snapshot(), members })).toThrow(); });
  it('rejects unknown room fields and damaged authoritative snapshots', () => {
    const s = snapshot(); expect(() => parseRoomSnapshot({ ...s, ownerPlayerId: 'p1' })).toThrow();
    const raw = gameStateSchema.parse(s.state); raw.stateVersion = -1;
    expect(() => parseRoomSnapshot({ ...s, state: raw })).toThrow();
  });
  it('does not overwrite a duplicate room or attach the same game to another room', async () => {
    const s = await fixture(); expect(await store.create(s)).toBe(false);
    expect(await store.create({ ...s, roomId: `different-${s.roomId}` })).toBe(false);
    expect(await store.read(s.roomId)).toEqual(s);
  });
  it('is idempotent when explicitly applying the initial migration', async () => { await expect(migrateRoomStore(sql)).resolves.toBeUndefined(); });
  it('returns null for a missing room and rejects unsafe identifier input', async () => {
    expect(await store.read('missing-room')).toBeNull(); await expect(store.read("x' OR 1=1 --")).rejects.toThrow();
  });
  it('commits one version and rejects a repeated compare-and-swap', async () => {
    const s = await fixture(), next = nextState(s);
    expect(await store.compareAndSwap(s.roomId, s.state.stateVersion, next)).toBe(true);
    expect(await store.compareAndSwap(s.roomId, s.state.stateVersion, next)).toBe(false);
    expect((await store.read(s.roomId))!.state).toEqual(next);
    expect((await store.read(s.roomId))!.members).toEqual(s.members);
  });
  it('allows exactly one of two independent store writers to win the same version', async () => {
    const s = await fixture(), other = new PostgresRoomStore(sql);
    const results = await Promise.all([store.compareAndSwap(s.roomId, s.state.stateVersion, nextState(s)), other.compareAndSwap(s.roomId, s.state.stateVersion, nextState(s, 'A-02'))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.read(s.roomId))!.state.stateVersion).toBe(s.state.stateVersion + 1);
  });
  it.each([-1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 1.5])('rejects unsafe expected version %s', async version => {
    const s = await fixture(); await expect(store.compareAndSwap(s.roomId, version, nextState(s))).rejects.toThrow();
    expect(await store.read(s.roomId)).toEqual(s);
  });
  it('rejects wrong-game states and commits which skip versions', async () => {
    const s = await fixture(), other = snapshot();
    await expect(store.compareAndSwap(s.roomId, s.state.stateVersion, nextState(other))).rejects.toThrow();
    const raw = gameStateSchema.parse(nextState(s)); raw.stateVersion++;
    await expect(store.compareAndSwap(s.roomId, s.state.stateVersion, raw)).rejects.toThrow();
    expect(await store.read(s.roomId)).toEqual(s);
  });
  it.each([
    "state_version = state_version + 1",
    "state = jsonb_set(state, '{gameId}', '\"wrong\"'::jsonb)",
    "state = jsonb_set(state, '{stateVersion}', 'null'::jsonb)",
    "definition = jsonb_set(definition, '{gameId}', 'null'::jsonb)",
  ])('enforces SQL metadata checks for %s', async clause => {
    const s = await fixture(); await expect(sql.query(`UPDATE nco_rooms SET ${clause} WHERE room_id = $1`, [s.roomId])).rejects.toThrow();
    expect(await store.read(s.roomId)).toEqual(s);
  });
});

describe('room queue scheduling', () => {
  it('serializes the same room while allowing another room to proceed', async () => {
    const q = new RoomQueue(), entered = deferred(), release = deferred(), order: string[] = [];
    const first = q.run('a', async () => { order.push('a1'); entered.resolve(); await release.promise; order.push('a1-done'); });
    await entered.promise;
    const second = q.run('a', async () => { order.push('a2'); });
    await q.run('b', async () => { order.push('b'); });
    expect(order).toEqual(['a1', 'b']); expect(q.pendingRoomCount).toBe(1);
    release.resolve(); await Promise.all([first, second]); expect(order).toEqual(['a1', 'b', 'a1-done', 'a2']); expect(q.pendingRoomCount).toBe(0);
  });
  it('releases failed tasks and deletes their queue tails', async () => {
    const q = new RoomQueue(); await expect(q.run('a', async () => { throw Error('fault'); })).rejects.toThrow('fault');
    expect(await q.run('a', async () => 7)).toBe(7); expect(q.pendingRoomCount).toBe(0);
  });
});

describe('authenticated-user mapping, durable acknowledgements and safe recovery', () => {
  it('derives the player from stored membership and never returns a raw state', async () => {
    const s = await fixture(), service = new RoomService(store), result = await service.submit(s.roomId, principal, payload(s.state));
    expect(result.status).toBe('committed');
    if (result.status !== 'committed') throw Error('Expected committed result');
    expect(result.view.private.playerId).toBe('p1'); expect(result.view.public.board.cityNodeByPlayer.p1).toBe('A-01');
    expect(result.reply.stateVersion).toBe((await store.read(s.roomId))!.state.stateVersion);
    expect(Object.hasOwn(result, 'state')).toBe(false); expect(JSON.stringify(result)).not.toContain('remainingGreenEventIds');
  });
  it.each(['outsider', '__proto__', 'constructor'])('hides both missing and unauthorized rooms from %s', async user => {
    const s = await fixture(), service = new RoomService(store), auth = { authenticatedUserId: user };
    const denied = await service.readView(s.roomId, auth);
    expect(denied).toEqual(await service.readView('absent-room', auth));
    expect(await service.submit(s.roomId, auth, payload(s.state))).toEqual(denied);
    expect(await store.read(s.roomId)).toEqual(s);
  });
  it('does not let a legitimate user act for a different seat', async () => {
    const s = await fixture(), result = await new RoomService(store).submit(s.roomId, { authenticatedUserId: 'alice' }, payload(s.state));
    expect(result).toMatchObject({ status: 'rejected', reply: { error: { code: 'RULE_REJECTED', ruleCode: 'WRONG_ACTOR' } } });
    expect(await store.read(s.roomId)).toEqual(s);
  });
  it('rejects spoofed body identities and extra trusted-context fields', async () => {
    const s = await fixture(), service = new RoomService(store);
    expect(await service.submit(s.roomId, principal, { ...payload(s.state), userId: 'alice' })).toMatchObject({ status: 'rejected', reply: { error: { code: 'INVALID_REQUEST' } } });
    expect(await service.readView(s.roomId, { ...principal, authenticatedPlayerId: 'p2' } as never)).toMatchObject({ status: 'unavailable', error: { code: 'ROOM_UNAVAILABLE' } });
  });
  it('returns success only after the store confirms a durable write', async () => {
    const s = await fixture(), entered = deferred(), release = deferred(); let settled = false;
    const gated = override(store, { compareAndSwap: async (...args) => { entered.resolve(); await release.promise; return store.compareAndSwap(...args); } });
    const pending = new RoomService(gated).submit(s.roomId, principal, payload(s.state)).then(r => { settled = true; return r; });
    await entered.promise; expect(settled).toBe(false); expect((await store.read(s.roomId))!.state).toEqual(s.state);
    release.resolve(); expect((await pending).status).toBe('committed');
  });
  it('never returns candidate state or a success reply when persistence fails', async () => {
    const s = await fixture(), failing = override(store, { compareAndSwap: async () => { throw Error('internal database secret'); } });
    const service = new RoomService(failing);
    const result = await service.submit(s.roomId, principal, payload(s.state));
    expect(result).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(await store.read(s.roomId)).toEqual(s);
    expect((await new RoomService(store).submit(s.roomId, principal, payload(s.state))).status).toBe('committed');
  });
  it('reports CAS contention without falsely acknowledging an accepted pure-function candidate', async () => {
    const s = await fixture(), conflict = override(store, { compareAndSwap: async () => false });
    expect(await new RoomService(conflict).submit(s.roomId, principal, payload(s.state))).toEqual({ status: 'unavailable', error: { code: 'COMMIT_CONFLICT' } });
    expect(await store.read(s.roomId)).toEqual(s);
  });
  it('rejects a duplicate version after the first submission commits', async () => {
    const s = await fixture(), service = new RoomService(store);
    const results = await Promise.all([service.submit(s.roomId, principal, payload(s.state)), service.submit(s.roomId, principal, payload(s.state))]);
    expect(results[0]!.status).toBe('committed'); expect(results[1]).toMatchObject({ status: 'rejected', reply: { error: { code: 'STALE_VERSION' } } });
  });
  it('uses CAS to resolve submissions through independent service queues', async () => {
    const s = await fixture(), bothRead = deferred(); let reads = 0;
    const barrier = override(store, { read: async id => { const row = await store.read(id); if (++reads === 2) bothRead.resolve(); await bothRead.promise; return row; } });
    const results = await Promise.all([new RoomService(barrier).submit(s.roomId, principal, payload(s.state)), new RoomService(barrier).submit(s.roomId, principal, payload(s.state, 'A-02'))]);
    expect(results.filter(r => r.status === 'committed')).toHaveLength(1);
    expect(results.find(r => r.status !== 'committed')).toEqual({ status: 'unavailable', error: { code: 'COMMIT_CONFLICT' } });
  });
  it('captures the principal and request before a queued caller can mutate them', async () => {
    const s = await fixture(), queue = new RoomQueue(), entered = deferred(), release = deferred();
    const held = queue.run(s.roomId, async () => { entered.resolve(); await release.promise; }); await entered.promise;
    const auth = { authenticatedUserId: 'bob' }, body = payload(s.state);
    const pending = new RoomService(store, queue).submit(s.roomId, auth, body);
    auth.authenticatedUserId = 'alice'; body.command.nodeId = 'A-02'; release.resolve(); await held;
    const result = await pending; expect(result.status).toBe('committed');
    if (result.status === 'committed') expect(result.view.public.board.cityNodeByPlayer.p1).toBe('A-01');
  });
  it('reconnects a fresh provider to the stored state and selects the correct member private view', async () => {
    const s = await fixture(); await new RoomService(store).submit(s.roomId, principal, payload(s.state));
    const reconnected = await new RoomService(new PostgresRoomStore(sql)).readView(s.roomId, { authenticatedUserId: 'alice' });
    expect(reconnected.status).toBe('ready'); if (reconnected.status === 'ready') { expect(reconnected.view.private.playerId).toBe('p2'); expect(reconnected.view.public.stateVersion).toBe(s.state.stateVersion + 1); }
  });
  it('normalizes read failures without disclosing database error details', async () => {
    const s = await fixture(), broken = override(store, { read: async () => { throw Error('connection secret'); } }), service = new RoomService(broken);
    expect(await service.readView(s.roomId, principal)).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(await service.submit(s.roomId, principal, payload(s.state))).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
  });
  it('persists trusted transitions with the same queue/CAS contract and rejects a stale grant', async () => {
    const s = await fixture(), service = new RoomService(store);
    expect(await service.commitTrustedTransition(s.roomId, s.state.stateVersion, nextState)).toEqual({ status: 'committed', stateVersion: s.state.stateVersion + 1 });
    expect(await service.commitTrustedTransition(s.roomId, s.state.stateVersion, nextState)).toEqual({ status: 'unavailable', error: { code: 'COMMIT_CONFLICT' } });
    const after = (await store.read(s.roomId))!;
    await expect(service.commitTrustedTransition(s.roomId, after.state.stateVersion, room => room.state)).rejects.toThrow();
    expect(await store.read(s.roomId)).toEqual(after);
  });
  it('boots and closes a real Nest application context with the room provider', async () => {
    const app = await NestFactory.createApplicationContext(RoomModule.register(sql), { logger: false });
    try { const s = await fixture(); expect((await app.get(RoomService).readView(s.roomId, principal)).status).toBe('ready'); }
    finally { await app.close(); }
  });
});
