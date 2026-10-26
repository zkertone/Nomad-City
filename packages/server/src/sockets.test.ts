import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { io } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { INestApplication } from '@nestjs/common';
import * as core from '@nomad-city-online/game-core';
import { PostgresRoomStore, migrateRoomStore } from './postgres-room-store.js';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { parseRoomSnapshot } from './room-state.js';
import type { RoomStore } from './room-state.js';
import { SessionService, migrateSessionStore, SESSION_MAX_TTL_MS, SESSION_DEFAULT_TTL_MS } from './sessions.js';
import { createRoomSocketApplication } from './socket-application.js';
import { RoomGateway } from './room.gateway.js';
import { ROOM_STORE } from './room.module.js';
import { socketOptionsSchema } from './socket-protocol.js';
import { createAutomaticBaseRoomSnapshot } from './base-room-factory.js';
import { baseSetupIds } from './automatic-base-plan.js';

const db = new PGlite(), sql: RoomSqlExecutor = { query: async (text, values) => {
  const r = await db.query<Record<string, unknown>>(text, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
} };
const store = new PostgresRoomStore(sql), origin = 'https://nomad.test', clients = new Set<ClientSocket>();
let app: INestApplication, sessions: SessionService, gateway: RoomGateway, gatewayStore: RoomStore, url = '', clockOffset = 0, sequence = 0;
let now = 1000;
const unitSessions = new SessionService(sql, () => now);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function until(condition: () => boolean) {
  const end = Date.now() + 3000;
  while (!condition()) { if (Date.now() > end) throw Error('Timed out waiting for socket condition'); await new Promise(r => setTimeout(r, 5)); }
}
function event<T = unknown>(socket: ClientSocket, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(Error(`Timed out waiting for ${name}`)); }, 3000);
    const handler = (value: T) => { clearTimeout(timer); resolve(value); };
    socket.once(name, handler);
  });
}
function connect(auth: unknown, requestedOrigin = origin): Promise<ClientSocket> {
  const socket = io(`${url}/game`, { auth: auth as object, autoConnect: false, forceNew: true, transports: ['websocket'],
    reconnection: false, timeout: 3000, extraHeaders: { Origin: requestedOrigin } });
  clients.add(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', error => { socket.disconnect(); reject(Error(error.message)); });
    socket.connect();
  });
}
async function asUser(userId: string) {
  const issued = await sessions.issue(userId);
  return { socket: await connect({ protocolVersion: '1.0.0', sessionToken: issued.token }), ...issued };
}
const call = (socket: ClientSocket, name: string, payload: unknown) => socket.timeout(3000).emitWithAck(name, payload);
async function fixture(managed = false) {
  const id = `socket-room-${++sequence}`, players = [{ id: 'p1', color: 'red' as const }, { id: 'p2', color: 'blue' as const }];
  const g = core.createPreEntryGame(`game-${id}`, players);
  let state = core.beginEntry(g.state, g.definition, { expectedVersion: 0, startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2'], greenDeckOrder: ['G03', 'G02', 'G04', 'G05', 'G06'] });
  if (managed) {
    for (let i = 0; i < 2; i++) {
      const context = { authenticatedPlayerId: players[i]!.id };
      state = core.applyEntryCommand(state, g.definition, context, { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'select-initial-node', nodeId: ['A-01', 'A-02'][i] });
      state = core.applyEntryCommand(state, g.definition, context, { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
    }
    state = core.applyEntryCommand(state, g.definition, { authenticatedPlayerId: 'p2' }, { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-entry-influence', slotId: null });
    state = core.beginRoundFlow(state, g.definition, { expectedVersion: state.stateVersion, facilityDeckOrder: core.FOUNDERS_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id) });
    while (state.roundFlow!.stage === 'role-removal') state = core.applyRoundCommand(state, g.definition, { authenticatedPlayerId: core.getRoundTurn(state, g.definition).actorId! }, { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'remove-round-supply-card', cardId: state.facilities!.supply.supply[0] });
    while (state.roundFlow!.stage === 'role-placement') {
      const actor = core.getRoundTurn(state, g.definition).actorId!;
      state = core.applyRoundCommand(state, g.definition, { authenticatedPlayerId: actor }, { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'place-round-role', roleId: actor === 'p1' ? 'ROLE-03' : 'ROLE-02' });
    }
  }
  const snapshot = parseRoomSnapshot({ roomId: id, definition: g.definition, state, members: [{ userId: 'bob', playerId: 'p1' }, { userId: 'alice', playerId: 'p2' }] });
  expect(await store.create(snapshot)).toBe(true); return snapshot;
}
function request(s: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  return { roomId: s.roomId, request: { apiVersion: '1.0.0', requestId: 'wire-request', channel: 'entry', command: { gameId: s.state.gameId, expectedVersion: s.state.stateVersion, type: 'select-initial-node', nodeId: 'A-01', ...extra } } };
}
beforeAll(async () => {
  await migrateRoomStore(sql); await migrateSessionStore(sql);
  app = await createRoomSocketApplication({ sql, allowedOrigins: [origin], sessionClock: () => Date.now() + clockOffset });
  await app.listen(0, '127.0.0.1'); url = await app.getUrl();
  sessions = app.get(SessionService); gateway = app.get(RoomGateway); gatewayStore = app.get(ROOM_STORE);
});
afterEach(async () => {
  for (const socket of clients) socket.disconnect(); clients.clear(); vi.restoreAllMocks(); clockOffset = 0;
  if (gateway) await until(() => gateway.connectionCount === 0);
});
afterAll(async () => { if (app) await app.close(); await db.close(); });

describe('durable opaque sessions', () => {
  it('issues distinct random credentials and stores only their SHA-256 digests', async () => {
    now = 1000; const a = await unitSessions.issue('session-user'), b = await unitSessions.issue('session-user');
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a.token).not.toBe(b.token); expect(a.expiresAt).toBe(now + SESSION_DEFAULT_TTL_MS);
    const rows = await sql.query('SELECT token_hash, expires_at FROM nco_sessions WHERE user_id = $1', ['session-user']);
    expect(rows.rows).toHaveLength(2); for (const row of rows.rows) { expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/); expect(row.token_hash).not.toBe(a.token); }
    expect(Object.isFrozen(a)).toBe(true);
  });
  it('resolves a credential from a fresh verifier over the same database', async () => {
    const issued = await unitSessions.issue('persisted-user');
    expect(await new SessionService(sql, () => now).resolve(issued.token)).toEqual({ userId: 'persisted-user', expiresAt: issued.expiresAt });
  });
  it('rejects a modified token and SQL-shaped credentials', async () => {
    const issued = await unitSessions.issue('tamper-user');
    const modified = (issued.token[0] === 'A' ? 'B' : 'A') + issued.token.slice(1);
    expect(await unitSessions.resolve(modified)).toBeNull(); expect(await unitSessions.resolve("' OR true --")).toBeNull();
  });
  it('expires at the exact boundary and can revoke one token without revoking another', async () => {
    now = 1000; const a = await unitSessions.issue('expiry-user', 100), b = await unitSessions.issue('expiry-user', 200);
    now = a.expiresAt - 1; expect(await unitSessions.resolve(a.token)).not.toBeNull();
    now++; expect(await unitSessions.resolve(a.token)).toBeNull(); expect(await unitSessions.resolve(b.token)).not.toBeNull();
    expect(await unitSessions.revoke(b.token)).toBe(true); expect(await unitSessions.revoke(b.token)).toBe(false); expect(await unitSessions.resolve(b.token)).toBeNull();
  });
  it.each([0, -1, 1.5, SESSION_MAX_TTL_MS + 1, Infinity])('rejects invalid lifetime %s', async ttl => { await expect(unitSessions.issue('user', ttl)).rejects.toThrow(); });
  it.each([undefined, null, '', 'short', {}, ['token']])('does not query a malformed credential %#', async token => {
    const spy = vi.spyOn(sql, 'query'); expect(await unitSessions.resolve(token)).toBeNull(); expect(await unitSessions.revoke(token)).toBe(false); expect(spy).not.toHaveBeenCalled();
  });
  it('rejects invalid identities, expiry overflow and invalid clocks', async () => {
    await expect(unitSessions.issue('bad user')).rejects.toThrow();
    await expect(new SessionService(sql, () => Number.MAX_SAFE_INTEGER).issue('user')).rejects.toThrow();
    await expect(new SessionService(sql, () => NaN).issue('user')).rejects.toThrow();
  });
  it('does not report issuance or verification success after a database failure', async () => {
    const broken = new SessionService({ query: async () => { throw Error('private database detail'); } });
    await expect(broken.issue('user')).rejects.toThrow(); await expect(broken.resolve('A'.repeat(43))).rejects.toThrow();
  });
  it('does not return a session that expired while its database lookup was pending', async () => {
    let clock = 1000;
    const delayed = new SessionService({ query: async () => { clock = 2000; return { rows: [{ user_id: 'user', expires_at: '1500' }], rowCount: 1 }; } }, () => clock);
    expect(await delayed.resolve('A'.repeat(43))).toBeNull();
  });
});

describe('real loopback Socket.IO session, membership and recovery boundary', () => {
  it.each([{}, { userId: 'bob' }, { protocolVersion: '0.0.0', sessionToken: 'A'.repeat(43) }, { protocolVersion: '1.0.0', sessionToken: 'A'.repeat(43) }])('rejects unauthenticated or unsupported handshakes %#', async auth => { await expect(connect(auth)).rejects.toThrow('AUTH_REQUIRED'); });
  it('rejects handshake identity injection even with an otherwise valid credential', async () => {
    const session = await sessions.issue('bob'); await expect(connect({ protocolVersion: '1.0.0', sessionToken: session.token, userId: 'alice' })).rejects.toThrow('AUTH_REQUIRED');
  });
  it('enforces an explicit origin allowlist and rejects wildcard configuration', async () => {
    const session = await sessions.issue('bob'); await expect(connect({ protocolVersion: '1.0.0', sessionToken: session.token }, 'https://evil.test')).rejects.toThrow();
    expect(socketOptionsSchema.safeParse({ allowedOrigins: ['*'] }).success).toBe(false);
    expect(socketOptionsSchema.safeParse({ allowedOrigins: ['https://nomad.test/path'] }).success).toBe(false);
  });
  it('normalizes authentication storage failures without leaking raw errors', async () => {
    vi.spyOn(sessions, 'resolve').mockRejectedValueOnce(Error('DO_NOT_LEAK'));
    await expect(connect({ protocolVersion: '1.0.0', sessionToken: 'A'.repeat(43) })).rejects.toThrow('AUTH_UNAVAILABLE');
  });
  it('returns a different private role view to each subscribed player', async () => {
    const s = await fixture(true), a = await asUser('bob'), b = await asUser('alice');
    const one = await call(a.socket, 'room:subscribe', { roomId: s.roomId }), two = await call(b.socket, 'room:subscribe', { roomId: s.roomId });
    expect(one.status).toBe('ready'); expect(two.status).toBe('ready'); expect(one.view.public).toEqual(two.view.public);
    expect(one.view.private).toMatchObject({ playerId: 'p1', placedRoleId: 'ROLE-03' });
    expect(two.view.private).toMatchObject({ playerId: 'p2', placedRoleId: 'ROLE-02' });
    expect(Object.hasOwn(two.view.public.players[0].roles, 'placedRoleId')).toBe(false);
    expect(JSON.stringify(two)).not.toContain('drawPile"'); expect(JSON.stringify(two)).not.toContain(a.token);
  });
  it('hides room existence from authenticated nonmembers and rejects a member acting for another seat', async () => {
    const s = await fixture(), outsider = await asUser('carol'), p2 = await asUser('alice');
    const denied = await call(outsider.socket, 'room:subscribe', { roomId: s.roomId });
    expect(denied).toEqual(await call(outsider.socket, 'room:subscribe', { roomId: 'missing-room' }));
    expect(denied).toMatchObject({ status: 'unavailable', error: { code: 'ROOM_UNAVAILABLE' } });
    expect(await call(p2.socket, 'room:command', request(s))).toMatchObject({ status: 'rejected', reply: { error: { ruleCode: 'WRONG_ACTOR' } } });
  });
  it.each(['actorId', 'authenticatedPlayerId', 'score', 'deckOrder'])('rejects wire command identity or outcome injection %s', async key => {
    const s = await fixture(), a = await asUser('bob');
    expect(await call(a.socket, 'room:command', request(s, { [key]: 'injected' }))).toMatchObject({ status: 'unavailable', error: { code: 'INVALID_MESSAGE' } });
    expect((await store.read(s.roomId))!.state).toEqual(s.state);
  });
  it('persists then publishes individualized updates and refuses stale replay', async () => {
    const s = await fixture(), a = await asUser('bob'), b = await asUser('alice'), pushes: unknown[] = [];
    b.socket.on('room:state', data => pushes.push(data));
    await call(a.socket, 'room:subscribe', { roomId: s.roomId }); await call(b.socket, 'room:subscribe', { roomId: s.roomId });
    const result = await call(a.socket, 'room:command', request(s));
    expect(result.status).toBe('committed');
    const refreshed = await call(b.socket, 'room:subscribe', { roomId: s.roomId });
    expect(refreshed.view.private.playerId).toBe('p2'); expect(refreshed.view.public.stateVersion).toBe(s.state.stateVersion + 1);
    expect(pushes).toHaveLength(2); expect((await store.read(s.roomId))!.state.stateVersion).toBe(result.reply.stateVersion);
    expect(await call(a.socket, 'room:command', request(s))).toMatchObject({ status: 'rejected', reply: { error: { code: 'STALE_VERSION' } } });
  });
  it('does not acknowledge or push the candidate before its write finishes', async () => {
    const s = await fixture(), a = await asUser('bob'), pushes: unknown[] = [];
    a.socket.on('room:state', data => pushes.push(data)); await call(a.socket, 'room:subscribe', { roomId: s.roomId });
    const entered = deferred(), release = deferred(), original = gatewayStore.compareAndSwap.bind(gatewayStore);
    vi.spyOn(gatewayStore, 'compareAndSwap').mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return original(...args); });
    let settled = false; const pending = call(a.socket, 'room:command', request(s)).then(r => { settled = true; return r; });
    await entered.promise; expect(settled).toBe(false); expect(pushes).toHaveLength(1); expect((await store.read(s.roomId))!.state).toEqual(s.state);
    release.resolve(); expect((await pending).status).toBe('committed'); expect(pushes).toHaveLength(2);
  });
  it.each(['failure', 'conflict'])('does not publish an uncommitted %s candidate', async mode => {
    const s = await fixture(), a = await asUser('bob'), pushes: unknown[] = [];
    a.socket.on('room:state', data => pushes.push(data)); await call(a.socket, 'room:subscribe', { roomId: s.roomId });
    const spy = vi.spyOn(gatewayStore, 'compareAndSwap');
    if (mode === 'failure') spy.mockRejectedValueOnce(Error('DO_NOT_LEAK')); else spy.mockResolvedValueOnce(false);
    const result = await call(a.socket, 'room:command', request(s));
    expect(result).toMatchObject({ status: 'unavailable', error: { code: mode === 'failure' ? 'STORAGE_UNAVAILABLE' : 'COMMIT_CONFLICT' } });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK'); expect(pushes).toHaveLength(1); expect((await store.read(s.roomId))!.state).toEqual(s.state);
  });
  it('keeps other rooms isolated and removes explicit subscriptions', async () => {
    const s = await fixture(), other = await fixture(), a = await asUser('bob'), b = await asUser('alice'), pushes: unknown[] = [];
    b.socket.on('room:state', data => pushes.push(data));
    await call(a.socket, 'room:subscribe', { roomId: s.roomId }); await call(b.socket, 'room:subscribe', { roomId: other.roomId });
    await call(a.socket, 'room:command', request(s)); await call(b.socket, 'room:subscribe', { roomId: other.roomId }); expect(pushes).toHaveLength(1);
    expect(await call(b.socket, 'room:unsubscribe', { roomId: other.roomId })).toEqual({ status: 'unsubscribed', roomId: other.roomId });
  });
  it('resubscribes after disconnect to the latest persisted version with the same session', async () => {
    const s = await fixture(), a = await asUser('bob'); await call(a.socket, 'room:subscribe', { roomId: s.roomId });
    a.socket.disconnect(); await until(() => gateway.connectionCount === 0);
    expect((await gateway.commitTrustedTransition(s.roomId, s.state.stateVersion, row => core.applyEntryCommand(row.state, row.definition, { authenticatedPlayerId: 'p1' }, request(s).request.command))).status).toBe('committed');
    const resumed = await connect({ protocolVersion: '1.0.0', sessionToken: a.token });
    const view = await call(resumed, 'room:subscribe', { roomId: s.roomId }); expect(view.view.public.stateVersion).toBe(s.state.stateVersion + 1);
  });
  it('stops a revoked subscriber receiving another player\'s committed update', async () => {
    const s = await fixture(), a = await asUser('bob'), b = await asUser('alice'), pushes: unknown[] = [];
    b.socket.on('room:state', data => pushes.push(data)); await call(b.socket, 'room:subscribe', { roomId: s.roomId });
    const invalidated = event<{ code: string }>(b.socket, 'session:invalidated'); await sessions.revoke(b.token);
    expect((await call(a.socket, 'room:command', request(s))).status).toBe('committed');
    expect((await invalidated).code).toBe('AUTH_REQUIRED'); expect(pushes).toHaveLength(1);
    await expect(connect({ protocolVersion: '1.0.0', sessionToken: b.token })).rejects.toThrow('AUTH_REQUIRED');
  });
  it('checks expiry again on an existing connection rather than trusting its old handshake', async () => {
    const s = await fixture(), a = await asUser('bob'), invalidated = event<{ code: string }>(a.socket, 'session:invalidated');
    clockOffset = SESSION_DEFAULT_TTL_MS + 1000; a.socket.emit('room:subscribe', { roomId: s.roomId });
    expect((await invalidated).code).toBe('AUTH_REQUIRED'); expect((await store.read(s.roomId))!.state).toEqual(s.state);
  });
  it('actively disconnects an expired idle connection', async () => {
    const session = await sessions.issue('bob', 1000), socket = await connect({ protocolVersion: '1.0.0', sessionToken: session.token });
    expect((await event<{ code: string }>(socket, 'session:invalidated')).code).toBe('AUTH_REQUIRED');
    await until(() => !socket.connected);
  });
  it('limits subscriptions and releases a slot after explicit unsubscribe', async () => {
    const a = await asUser('bob'), rooms = [];
    for (let i = 0; i < 9; i++) rooms.push(await fixture());
    for (const room of rooms.slice(0, 8)) expect((await call(a.socket, 'room:subscribe', { roomId: room.roomId })).status).toBe('ready');
    expect(await call(a.socket, 'room:subscribe', { roomId: rooms[8]!.roomId })).toMatchObject({ status: 'unavailable', error: { code: 'SUBSCRIPTION_LIMIT' } });
    await call(a.socket, 'room:unsubscribe', { roomId: rooms[0]!.roomId });
    expect((await call(a.socket, 'room:subscribe', { roomId: rooms[8]!.roomId })).status).toBe('ready');
  });
  it('accepts only one of two competing same-version requests from separate tabs', async () => {
    const s = await fixture(), issued = await sessions.issue('bob');
    const a = await connect({ protocolVersion: '1.0.0', sessionToken: issued.token });
    const b = await connect({ protocolVersion: '1.0.0', sessionToken: issued.token });
    const results = await Promise.all([call(a, 'room:command', request(s)), call(b, 'room:command', request(s, { nodeId: 'A-02' }))]);
    expect(results.filter(r => r.status === 'committed')).toHaveLength(1);
    expect(results.find(r => r.status !== 'committed')).toMatchObject({ status: 'rejected', reply: { error: { code: 'STALE_VERSION' } } });
    expect((await store.read(s.roomId))!.state.stateVersion).toBe(s.state.stateVersion + 1);
  });
  it('closes a connection which exceeds the engine packet size limit', async () => {
    const a = await asUser('bob'), disconnected = event(a.socket, 'disconnect');
    a.socket.emit('room:subscribe', { roomId: 'a'.repeat(80 * 1024) });
    await disconnected; await until(() => !a.socket.connected);
  });
  it('acknowledges a saved entry choice despite automatic failure, then resumes and notifies other members on subscribe', async () => {
    const id = `auto-wire-${++sequence}`;
    const initial = createAutomaticBaseRoomSnapshot({ roomId: id, gameId: `game-${id}`,
      players: [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }],
      members: [{ userId: 'bob', playerId: 'p1' }, { userId: 'alice', playerId: 'p2' }], startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2'],
      setupOrders: { ...baseSetupIds(2), greenDeckOrder: ['G03', 'G02', 'G04', 'G05', 'G06'] } });
    let state = initial.state;
    for (const [i, playerId] of ['p1', 'p2'].entries()) {
      state = core.applyEntryCommand(state, initial.definition, { authenticatedPlayerId: playerId }, { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'select-initial-node', nodeId: ['A-01', 'A-02'][i] });
      state = core.applyEntryCommand(state, initial.definition, { authenticatedPlayerId: playerId }, { gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-green-event', choiceId: `${state.entry!.pendingEvent!.cardId}:1` });
    }
    expect(state.entry!.status).toBe('bonus-influence'); await store.create({ ...initial, state });
    const a = await asUser('bob'), b = await asUser('alice'), received: { view: { public: { stateVersion: number }; private: { playerId: string } } }[] = [];
    b.socket.on('room:state', value => received.push(value));
    await call(a.socket, 'room:subscribe', { roomId: id }); await call(b.socket, 'room:subscribe', { roomId: id });
    const original = gatewayStore.compareAndSwap.bind(gatewayStore); let calls = 0, blocked = true;
    vi.spyOn(gatewayStore, 'compareAndSwap').mockImplementation(async (...args) => {
      if (++calls > 1 && blocked) throw Error('automatic write blocked');
      return original(...args);
    });
    const body = { roomId: id, request: { apiVersion: '1.0.0', requestId: 'finish-entry', channel: 'entry', command: {
      gameId: state.gameId, expectedVersion: state.stateVersion, type: 'choose-entry-influence', slotId: null } } };
    const committed = await call(b.socket, 'room:command', body);
    expect(committed).toMatchObject({ status: 'committed', reply: { ok: true, stateVersion: state.stateVersion + 1 }, automatic: { status: 'pending', issue: 'STORAGE_UNAVAILABLE' } });
    expect(calls).toBe(2); expect(received).toHaveLength(2);
    const afterPlayer = (await store.read(id))!; expect(afterPlayer.state.entry!.status).toBe('complete');
    blocked = false;
    const repaired = await call(a.socket, 'room:subscribe', { roomId: id });
    expect(repaired).toMatchObject({ status: 'ready', automatic: { status: 'waiting-for-player' }, view: { public: { snapshotVersion: '1.16.0', stateVersion: afterPlayer.state.stateVersion + 10 } } });
    await call(b.socket, 'room:subscribe', { roomId: id });
    expect(received).toHaveLength(3); expect(received.at(-1)!.view.private.playerId).toBe('p2');
    expect(received.at(-1)!.view.public.stateVersion).toBe(repaired.view.public.stateVersion);
    expect((await store.read(id))!.state.players).toEqual(afterPlayer.state.players);
    expect(JSON.stringify(repaired)).not.toContain('facilityDeckOrder');
    expect(await call(b.socket, 'room:command', body)).toMatchObject({ status: 'rejected', reply: { error: { code: 'STALE_VERSION' } } });
  });
});
