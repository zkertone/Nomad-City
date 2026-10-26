import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as core from '@nomad-city-online/game-core';
import type { GameState } from '@nomad-city-online/game-core';
import { createAutomaticBaseRoomSnapshot } from './base-room-factory.js';
import { baseSetupIds } from './automatic-base-plan.js';
import { parseRoomSnapshot } from './room-state.js';
import type { RoomSnapshot, RoomStore } from './room-state.js';
import { PostgresRoomStore, migrateRoomStore } from './postgres-room-store.js';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { RoomService } from './room-service.js';

const db = new PGlite(), sql: RoomSqlExecutor = { query: async (text, values) => {
  const r = await db.query<Record<string, unknown>>(text, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
} };
const store = new PostgresRoomStore(sql), principal = { authenticatedUserId: 'user-p1' };
const seats = [{ id: 'p1', color: 'red' as const }, { id: 'p2', color: 'blue' as const }, { id: 'p3', color: 'green' as const }, { id: 'p4', color: 'yellow' as const }];
let sequence = 0;
function input(count = 3) {
  const id = `auto-${++sequence}`;
  const green = core.FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === 'green' && (count === 4 || !c.hasFourPlayerMark)).map(c => c.id);
  return { roomId: id, gameId: `game-${id}`, players: seats.slice(0, count), members: seats.slice(0, count).map(p => ({ userId: `user-${p.id}`, playerId: p.id })),
    startingPlayerId: 'p1', clockwisePlayerIds: seats.slice(0, count).map(p => p.id),
    setupOrders: { ...baseSetupIds(count), greenDeckOrder: ['G03', ...green.filter(id => id !== 'G03')] } };
}
function initial(count = 3) { return createAutomaticBaseRoomSnapshot(input(count)); }
function env(s: GameState) { return { gameId: s.gameId, expectedVersion: s.stateVersion }; }
function completedEntry(room: RoomSnapshot, lastChoicePending = false) {
  let s = room.state;
  for (const [i, playerId] of s.entry!.playerOrder.entries()) {
    s = core.applyEntryCommand(s, room.definition, { authenticatedPlayerId: playerId }, { ...env(s), type: 'select-initial-node', nodeId: ['A-01', 'A-02', 'B-02', 'C-01'][i] });
    if (lastChoicePending && i === room.definition.players.length - 1) break;
    s = core.applyEntryCommand(s, room.definition, { authenticatedPlayerId: playerId }, { ...env(s), type: 'choose-green-event', choiceId: `${s.entry!.pendingEvent!.cardId}:1` });
  }
  if (s.entry!.status === 'bonus-influence') s = core.applyEntryCommand(s, room.definition, { authenticatedPlayerId: 'p2' }, { ...env(s), type: 'choose-entry-influence', slotId: null });
  return parseRoomSnapshot({ ...room, state: s });
}
function override(patch: Partial<RoomStore>): RoomStore { return { create: store.create.bind(store), read: store.read.bind(store), compareAndSwap: store.compareAndSwap.bind(store), ...patch }; }
async function save(room: RoomSnapshot) { expect(await store.create(room)).toBe(true); return room; }
function request(s: GameState, channel: string, command: Record<string, unknown>) { return { apiVersion: '1.0.0', requestId: 'auto-request', channel, command: { ...env(s), ...command } }; }
async function send(service: RoomService, id: string, channel: string, command: Record<string, unknown>, playerId?: string) {
  const room = (await store.read(id))!;
  const actor = playerId ?? core.getRoundTurn(room.state, room.definition).actorId!;
  const result = await service.submit(id, { authenticatedUserId: `user-${actor}` }, request(room.state, channel, command));
  expect(result.status).toBe('committed'); if (result.status !== 'committed') throw Error(JSON.stringify(result)); return result;
}
beforeAll(async () => { await migrateRoomStore(sql); });
afterAll(async () => { await db.close(); });

describe('explicit automatic-base provisioning and private persisted setup', () => {
  it.each([2, 3, 4])('provisions %i-player entry with a complete immutable private plan', count => {
    const options = input(count), before = JSON.stringify(options), room = createAutomaticBaseRoomSnapshot(options);
    expect(room.state.schemaVersion).toBe('1.1.0'); expect(room.state.entry!.status).toBe('selecting-node'); expect(room.state.stateVersion).toBe(1);
    expect(room.lifecycle!.facilityDeckOrder).toHaveLength(44); expect(Object.isFrozen(room.lifecycle!.facilityDeckOrder)).toBe(true);
    expect(JSON.stringify(options)).toBe(before);
    expect(JSON.stringify(core.getGamePlayerView(room.state, room.definition, { authenticatedPlayerId: 'p1' }))).not.toContain('DeckOrder');
  });
  it('supports the secure default setup and explicit trusted clockwise/starting-player selection', () => {
    const { setupOrders: _orders, ...options } = input();
    const room = createAutomaticBaseRoomSnapshot({ ...options, startingPlayerId: 'p2' });
    expect(room.state.entry!.playerOrder).toEqual(['p2', 'p3', 'p1']);
    expect([...room.lifecycle!.facilityDeckOrder].sort()).toEqual([...baseSetupIds(3).facilityDeckOrder].sort());
  });
  it.each(['startingPlayerId', 'clockwisePlayerIds', 'members'])('rejects invalid trusted setup %s', key => {
    const value = key === 'startingPlayerId' ? 'unknown' : [];
    expect(() => createAutomaticBaseRoomSnapshot({ ...input(), [key]: value })).toThrow();
  });
  it.each(['facilityDeckOrder', 'yellowDeckOrder', 'redDeckOrder', 'patternOrder'] as const)('rejects duplicated/unknown %s instead of inventing missing cards', key => {
    const options = input(); const order = options.setupOrders[key];
    expect(() => createAutomaticBaseRoomSnapshot({ ...options, setupOrders: { ...options.setupOrders, [key]: [...order.slice(1), order[1]] } })).toThrow();
    expect(() => createAutomaticBaseRoomSnapshot({ ...options, setupOrders: { ...options.setupOrders, [key]: ['unknown'] } })).toThrow();
  });
  it('rejects unknown fields and executable legacy progress carrying a fresh-game profile', () => {
    expect(() => createAutomaticBaseRoomSnapshot({ ...input(), winnerPlayerIds: ['p1'] })).toThrow();
    const s = completedEntry(initial()), plan = s.lifecycle!;
    let state = core.beginRoundFlow(s.state, s.definition, { expectedVersion: s.state.stateVersion,
      facilityDeckOrder: core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id),
      deckOrder: { yellow: plan.yellowDeckOrder, red: plan.redDeckOrder } });
    state = core.applyRoundCommand(state, s.definition, { authenticatedPlayerId: 'p1' }, { ...env(state), type: 'place-round-role', roleId: 'ROLE-02' });
    expect(() => parseRoomSnapshot({ ...s, state })).toThrow(/pristine/);
  });
  it('leaves migrated manual rooms manual and never upgrades them on reads', async () => {
    const { lifecycle: _plan, ...manual } = completedEntry(initial()); await save(manual);
    const result = await new RoomService(store).readView(manual.roomId, principal);
    expect(result.status).toBe('ready'); expect(Object.hasOwn(result, 'automatic')).toBe(false);
    expect(await store.read(manual.roomId)).toEqual(manual);
  });
});

describe('persisted automatic initialization and interruption recovery', () => {
  it.each([2, 3, 4])('initializes all capabilities for %i players once and waits for actual role choices', async count => {
    const room = await save(completedEntry(initial(count))), service = new RoomService(store);
    const result = await service.readView(room.roomId, principal); expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('Expected ready');
    expect(result.view.public.snapshotVersion).toBe('1.16.0'); expect(result.view.public.stateVersion).toBe(room.state.stateVersion + 10);
    expect(result.automatic).toEqual({ status: 'waiting-for-player', stateVersion: result.view.public.stateVersion });
    const saved = (await store.read(room.roomId))!;
    expect(saved.lifecycle).toEqual(room.lifecycle); expect(saved.state.facilities!.supply.supply).toEqual(room.lifecycle!.facilityDeckOrder.slice(0, 6));
    expect(saved.state.facilities!.supply.drawPile).toEqual(room.lifecycle!.facilityDeckOrder.slice(6));
    expect(saved.state.players).toEqual(room.state.players); expect(saved.state.board).toEqual(room.state.board);
    expect(Object.keys(core.getMarkerLedger(saved.state, saved.definition))).toHaveLength(count * 30);
    expect(saved.state.roundFlow!.stage).toBe(count === 2 ? 'role-removal' : 'role-placement');
    expect(await new RoomService(store).readView(room.roomId, principal)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('facilityDeckOrder');
  });
  it.each(Array.from({ length: 10 }, (_, i) => i))('resumes the same plan after %i successful startup commits', async cutoff => {
    const room = await save(completedEntry(initial())); let calls = 0;
    const failing = override({ compareAndSwap: async (...args) => { if (calls++ === cutoff) throw Error('write interrupted'); return store.compareAndSwap(...args); } });
    const interrupted = await new RoomService(failing).readView(room.roomId, principal);
    expect(interrupted).toMatchObject({ status: 'ready', automatic: { status: 'pending', issue: 'STORAGE_UNAVAILABLE' } });
    const midway = (await store.read(room.roomId))!; expect(midway.state.stateVersion).toBe(room.state.stateVersion + cutoff);
    expect(midway.lifecycle).toEqual(room.lifecycle);
    const observing = new RoomService(store); await observing.readCommittedView(room.roomId, principal);
    expect((await store.read(room.roomId))!.state.stateVersion).toBe(midway.state.stateVersion);
    const recovered = await observing.readView(room.roomId, principal);
    expect(recovered).toMatchObject({ status: 'ready', automatic: { status: 'waiting-for-player' } });
    const after = (await store.read(room.roomId))!;
    expect(after.state.stateVersion).toBe(room.state.stateVersion + 10);
    expect(after.state.facilities!.supply.drawPile).toEqual(room.lifecycle!.facilityDeckOrder.slice(6));
  });
  it('does not let nonmembers trigger automatic mutations', async () => {
    const room = await save(completedEntry(initial())), service = new RoomService(store);
    expect(await service.readView(room.roomId, { authenticatedUserId: 'outsider' })).toMatchObject({ status: 'unavailable', error: { code: 'ROOM_UNAVAILABLE' } });
    expect(await store.read(room.roomId)).toEqual(room);
  });
  it('blocks new player actions when a preceding automatic commit is unconfirmed', async () => {
    const room = await save(completedEntry(initial()));
    const service = new RoomService(override({ compareAndSwap: async () => false }));
    const result = await service.submit(room.roomId, principal, request(room.state, 'round', { type: 'place-round-role', roleId: 'ROLE-02' }));
    expect(result).toMatchObject({ status: 'unavailable', error: { code: 'AUTOMATION_PENDING' }, automatic: { issue: 'COMMIT_CONFLICT' } });
    expect(await store.read(room.roomId)).toEqual(room);
  });
  it('keeps an already saved player acknowledgement successful when a following automatic write fails', async () => {
    const room = await save(completedEntry(initial(), true)), actor = room.state.entry!.pendingEvent!.playerId;
    const payload = request(room.state, 'entry', { type: 'choose-green-event', choiceId: `${room.state.entry!.pendingEvent!.cardId}:1` });
    let calls = 0; const failing = override({ compareAndSwap: async (...args) => { if (++calls === 2) throw Error('automatic save failed'); return store.compareAndSwap(...args); } });
    const result = await new RoomService(failing).submit(room.roomId, { authenticatedUserId: `user-${actor}` }, payload);
    expect(result).toMatchObject({ status: 'committed', reply: { ok: true, stateVersion: room.state.stateVersion + 1 }, automatic: { status: 'pending', issue: 'STORAGE_UNAVAILABLE' } });
    const afterPlayer = (await store.read(room.roomId))!; expect(afterPlayer.state.entry!.status).toBe('complete');
    const recovered = await new RoomService(store).readView(room.roomId, principal);
    expect(recovered).toMatchObject({ status: 'ready', view: { public: { stateVersion: afterPlayer.state.stateVersion + 10 } } });
    expect((await store.read(room.roomId))!.state.players).toEqual(afterPlayer.state.players);
    expect(await new RoomService(store).submit(room.roomId, { authenticatedUserId: `user-${actor}` }, payload)).toMatchObject({ status: 'rejected', reply: { error: { code: 'STALE_VERSION' } } });
  });
  it('uses CAS across independent recovering services without duplicate initialization', async () => {
    const room = await save(completedEntry(initial())); let reads = 0, release!: () => void;
    const both = new Promise<void>(resolve => { release = resolve; });
    const barrier = override({ read: async id => { const snapshot = await store.read(id); if (++reads === 2) release(); await both; return snapshot; } });
    await Promise.all([new RoomService(barrier).readView(room.roomId, principal), new RoomService(barrier).readView(room.roomId, principal)]);
    await new RoomService(store).readView(room.roomId, principal);
    expect((await store.read(room.roomId))!.state.stateVersion).toBe(room.state.stateVersion + 10);
  });
});

/** Isolated final-round fixture only. The compiled WebSocket check plays all eight real rounds. */
async function finalHarvest(impossible = false) {
  const room = await save(completedEntry(initial())), service = new RoomService(store); await service.readView(room.roomId, principal);
  const raw = core.gameStateSchema.parse((await store.read(room.roomId))!.state); raw.roundFlow!.roundNumber = 8;
  await sql.query('UPDATE nco_rooms SET state = $2::jsonb WHERE room_id = $1', [room.roomId, JSON.stringify(raw)]);
  for (const player of seats.slice(0, 3)) await send(service, room.roomId, 'round', { type: 'place-round-role', roleId: player.id === 'p1' ? 'ROLE-01' : 'ROLE-02' });
  await send(service, room.roomId, 'role', { type: 'use-base-role', roleId: 'ROLE-01', mode: 'strategy', strategyChoice: { kind: 'liskarm-place', slotIds: ['route:A-route-01:slot:1', 'route:B-route-02:slot:1'] } });
  while ((await store.read(room.roomId))!.state.roundFlow!.stage === 'player-actions') {
    const actor = core.getRoundTurn((await store.read(room.roomId))!.state, room.definition).actorId!;
    await send(service, room.roomId, 'round', { type: 'choose-major-action', action: 'dispatch' });
    if ((await store.read(room.roomId))!.state.influenceAction!.status === 'ready') await send(service, room.roomId, 'influence', { type: 'finish-dispatch' });
    const beforeFinish = (await store.read(room.roomId))!;
    await service.readView(room.roomId, { authenticatedUserId: `user-${actor}` });
    expect((await store.read(room.roomId))!.state.stateVersion).toBe(beforeFinish.state.stateVersion);
    await send(service, room.roomId, 'round', { type: 'finish-player-turn' });
  }
  expect((await store.read(room.roomId))!.state.harvest!.status).toBe('planning');
  if (impossible) {
    // Position fixture for the rulebook's impossible-removal branch, not claimed player history.
    const copy = core.gameStateSchema.parse((await store.read(room.roomId))!.state);
    for (const [slot, marker] of Object.entries(copy.board.influenceBySlot)) if (marker?.ownerPlayerId === 'p1') { copy.markerSupplyByPlayer.p1!.push(marker.markerId); copy.board.influenceBySlot[slot] = null; }
    core.parseGameState(copy, room.definition);
    await sql.query('UPDATE nco_rooms SET state = $2::jsonb WHERE room_id = $1', [room.roomId, JSON.stringify(copy)]);
  }
  for (const playerId of ['p1', 'p2']) await send(service, room.roomId, 'harvest', { type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } }, playerId);
  const before = (await store.read(room.roomId))!;
  await service.readView(room.roomId, principal); expect((await store.read(room.roomId))!.state.stateVersion).toBe(before.state.stateVersion);
  const last = await send(service, room.roomId, 'harvest', { type: 'set-harvest-plan', plan: { nodeIds: [], routeIds: [] } }, 'p3');
  return { room, service, last };
}
describe('automatic harvest, required cleanup choices and one-time final scoring', () => {
  it('opens harvest but waits for all plans and the actual delayed-removal owner', async () => {
    const f = await finalHarvest();
    expect(f.last).toMatchObject({ automatic: { status: 'waiting-for-player' }, view: { public: { round: { stage: 'cleanup', actorId: 'p1' } } } });
    const before = (await store.read(f.room.roomId))!, preview = core.getBaseScoringPreview(core.getGamePosition(before.state, before.definition), before.definition);
    const denied = await f.service.submit(f.room.roomId, { authenticatedUserId: 'user-p2' }, request(before.state, 'role-cleanup', { type: 'resolve-role-cleanup', slotId: 'route:A-route-01:slot:1' }));
    expect(denied).toMatchObject({ status: 'rejected', reply: { error: { ruleCode: 'WRONG_ACTOR' } } });
    expect((await store.read(f.room.roomId))!.state).toEqual(before.state);
    const final = await send(f.service, f.room.roomId, 'role-cleanup', { type: 'resolve-role-cleanup', slotId: 'route:A-route-01:slot:1' });
    expect(final.automatic!.status).toBe('finished'); expect(final.view.public.snapshotVersion).toBe('1.17.0');
    expect(final.view.public.stateVersion).toBe(final.reply.stateVersion + 2);
    expect(final.view.public.finalResult!.players.p1!.regionPoints).toBe(preview.players.p1!.regionPoints - 3);
    const stored = (await store.read(f.room.roomId))!; expect(Object.keys(core.getMarkerLedger(stored.state, stored.definition))).toHaveLength(90);
    for (let i = 0; i < 3; i++) expect((await new RoomService(store).readView(f.room.roomId, principal))).toMatchObject({ automatic: { status: 'finished', stateVersion: stored.state.stateVersion } });
    expect((await store.read(f.room.roomId))!.state).toEqual(stored.state);
  });
  it('skips only an impossible delayed removal through the existing cleanup rule', async () => {
    const f = await finalHarvest(true); expect(f.last).toMatchObject({ automatic: { status: 'finished' }, view: { public: { snapshotVersion: '1.17.0' } } });
  });
});
