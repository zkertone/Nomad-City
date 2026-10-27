import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { LobbyService } from './lobby-service.js';
import { migrateRoomStore, PostgresRoomStore } from './postgres-room-store.js';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { createAutomaticBaseRoomSnapshot } from './base-room-factory.js';
import { parseLobbySnapshot } from './lobby-state.js';
import type { LobbyResult, LobbyView } from './lobby-state.js';

const db = new PGlite(), sql: RoomSqlExecutor = { query: async (text, values) => {
  const r = await db.query<Record<string, unknown>>(text, values); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
} };
const service = new LobbyService(sql), rooms = new PostgresRoomStore(sql);
let sequence = 0;
const principal = (userId: string) => ({ authenticatedUserId: userId });
function view(result: LobbyResult): LobbyView { if (!('view' in result)) throw Error(JSON.stringify(result)); return result.view; }
async function fixture(count = 2) {
  const suffix = ++sequence, users = Array.from({ length: count + 1 }, (_, i) => principal(`lobby-user-${suffix}-${i}`));
  const created = await service.create(users[0]!, { requestId: `create-${suffix}`, playerCount: count });
  if (!('inviteToken' in created) || !created.inviteToken) throw Error('Fixture creation failed');
  return { users, created, inviteToken: created.inviteToken, lobbyId: created.view.lobbyId };
}
async function full(count = 2) {
  const f = await fixture(count);
  for (const user of f.users.slice(1, count)) expect((await service.join(user, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })).status).toBe('joined');
  return f;
}
async function cmd(f: Awaited<ReturnType<typeof fixture>>, type: string, fields: Record<string, unknown> = {}, user = f.users[0]!) {
  const s = view(await service.read(f.lobbyId, user));
  return service.command(user, { lobbyId: f.lobbyId, expectedVersion: s.version, type, ...fields });
}
async function configured(count = 2) {
  const f = await full(count), s = view(await service.read(f.lobbyId, f.users[0]!));
  expect((await cmd(f, 'configure', { startingPlayerId: 'p2', clockwisePlayerIds: s.members.map(m => m.playerId).reverse() })).status).toBe('updated');
  return f;
}
async function ready(count = 2) {
  const f = await configured(count);
  for (const user of f.users.slice(0, count)) expect((await cmd(f, 'set-ready', { ready: true }, user)).status).toBe('updated');
  return f;
}
beforeAll(async () => { await migrateRoomStore(sql); await migrateRoomStore(sql); });
afterAll(() => db.close());

describe('persisted private lobby setup and atomic game start', () => {
  it('creates a private waiting lobby and stores only the invite digest', async () => {
    const f = await fixture(), s = view(f.created);
    expect(s).toMatchObject({ version: 0, status: 'waiting', playerCount: 2, selfPlayerId: 'p1', roomId: null, setup: null });
    const rows = await sql.query('SELECT snapshot, invite_hash FROM nco_lobbies WHERE lobby_id = $1', [f.lobbyId]);
    expect(rows.rows[0]!.invite_hash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(rows.rows)).not.toContain(f.inviteToken);
    expect(JSON.stringify(s)).not.toMatch(/lobby-user|ownerId|gameId|invite/); expect(Object.isFrozen(s.members)).toBe(true);
    expect(await rooms.read(f.lobbyId)).toBeNull();
  });
  it('recovers a repeated owner creation request without another lobby or replacing its invite', async () => {
    const f = await fixture(), input = { requestId: `create-${sequence}`, playerCount: 2 };
    const repeated = await service.create(f.users[0]!, input);
    expect(repeated).toEqual({ status: 'existing', view: view(f.created) });
    expect((await service.join(f.users[1]!, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })).status).toBe('joined');
    expect(await service.create(f.users[0]!, { ...input, playerCount: 3 })).toMatchObject({ error: { code: 'REQUEST_CONFLICT' } });
    expect((await service.create(f.users[1]!, input)).status).toBe('created');
  });
  it('requires authentication as well as the right invitation and hides inaccessible existence', async () => {
    const f = await fixture();
    const wrong = await service.join(f.users[1]!, { lobbyId: f.lobbyId, inviteToken: 'A'.repeat(43) });
    expect(wrong).toEqual(await service.join(f.users[1]!, { lobbyId: 'missing-lobby', inviteToken: 'A'.repeat(43) }));
    expect(await service.read(f.lobbyId, f.users[1]!)).toMatchObject({ error: { code: 'LOBBY_UNAVAILABLE' } });
    expect(await service.join(principal('bad identity'), { lobbyId: f.lobbyId, inviteToken: f.inviteToken })).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });
  it.each([2, 3, 4])('starts exactly one %i-player game with approved explicit order and existing automatic setup', async count => {
    const f = await ready(count), before = view(await service.read(f.lobbyId, f.users[0]!));
    const result = await cmd(f, 'start'), started = view(result);
    expect(started).toMatchObject({ status: 'started', version: before.version + 1, roomId: f.lobbyId });
    const game = (await rooms.read(f.lobbyId))!;
    expect(game.state.stateVersion).toBe(1); expect(game.state.schemaVersion).toBe('1.1.0');
    expect(game.lifecycle?.profile).toBe('project-base-automatic'); expect(game.members).toHaveLength(count);
    expect(game.state.entry!.playerOrder[0]).toBe('p2');
    expect(game.state.entry!.playerOrder).toEqual(['p2', 'p1', ...Array.from({ length: count - 2 }, (_, i) => `p${count - i}`)]);
    const row = await sql.query('SELECT invite_hash FROM nco_lobbies WHERE lobby_id = $1', [f.lobbyId]); expect(row.rows[0]!.invite_hash).toBeNull();
    expect(await cmd(f, 'start')).toMatchObject({ error: { code: 'LOBBY_CLOSED' } }); expect(await rooms.read(f.lobbyId)).toEqual(game);
  });
  it('repeated join preserves one seat/version and rejects a valid invitation after capacity fills', async () => {
    const f = await full(); const before = view(await service.read(f.lobbyId, f.users[1]!));
    expect(await service.join(f.users[1]!, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })).toEqual({ status: 'ready', view: before });
    expect(await service.join(f.users[2]!, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })).toMatchObject({ error: { code: 'LOBBY_FULL' } });
  });
  it('requires a complete explicit setup and readiness from each exact authenticated member', async () => {
    const f = await fixture(3);
    expect(await cmd(f, 'configure', { startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2', 'p3'] })).toMatchObject({ error: { code: 'INVALID_SETUP' } });
    expect(await cmd(f, 'set-ready', { ready: true })).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    expect(await cmd(f, 'start')).toMatchObject({ error: { code: 'NOT_READY' } });
    const complete = await configured(); expect(await cmd(complete, 'start')).toMatchObject({ error: { code: 'NOT_READY' } });
    await cmd(complete, 'set-ready', { ready: true });
    const s = view(await service.read(complete.lobbyId, complete.users[1]!)); expect(s.members.find(m => m.playerId === 'p2')!.ready).toBe(false);
    expect(await cmd(complete, 'start')).toMatchObject({ error: { code: 'NOT_READY' } });
  });
  it.each(['configure', 'start', 'rotate-invite', 'cancel'])('limits %s to the actual owner', async type => {
    const f = await configured();
    const fields = type === 'configure' ? { startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2'] } : {};
    expect(await cmd(f, type, fields, f.users[1]!)).toMatchObject({ error: { code: 'OWNER_REQUIRED' } });
  });
  it.each([['p1', ['p1', 'p1']], ['p3', ['p1', 'p2']], ['p1', ['p1', 'p3']]])('rejects incomplete/duplicate/foreign setup %#', async (startingPlayerId, clockwisePlayerIds) => {
    const f = await full(); expect(await cmd(f, 'configure', { startingPlayerId, clockwisePlayerIds })).toMatchObject({ error: { code: 'INVALID_SETUP' } });
  });
  it('invalidates all ready flags after a setup change or membership change and allows refill of a vacated seat', async () => {
    const f = await ready();
    await cmd(f, 'configure', { startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2'] });
    expect(view(await service.read(f.lobbyId, f.users[0]!)).members.every(m => !m.ready)).toBe(true);
    await cmd(f, 'set-ready', { ready: true });
    expect((await cmd(f, 'leave', {}, f.users[1]!)).status).toBe('left');
    const after = view(await service.read(f.lobbyId, f.users[0]!)); expect(after.setup).toBeNull(); expect(after.members.every(m => !m.ready)).toBe(true);
    expect(await service.read(f.lobbyId, f.users[1]!)).toMatchObject({ error: { code: 'LOBBY_UNAVAILABLE' } });
    const replacement = view(await service.join(f.users[2]!, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })); expect(replacement.selfPlayerId).toBe('p2');
  });
  it('can unready oneself; the owner must cancel rather than abandoning a waiting lobby', async () => {
    const f = await ready(); await cmd(f, 'set-ready', { ready: false }, f.users[1]!);
    expect(await cmd(f, 'start')).toMatchObject({ error: { code: 'NOT_READY' } });
    expect(await cmd(f, 'leave')).toMatchObject({ error: { code: 'OWNER_MUST_CANCEL' } });
  });
  it('rotates invitations without changing readiness or disclosing the old plaintext', async () => {
    const f = await fixture(), result = await cmd(f, 'rotate-invite');
    if (!('inviteToken' in result)) throw Error('Rotation failed'); expect(result.inviteToken).not.toBe(f.inviteToken);
    expect(await service.join(f.users[1]!, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })).toMatchObject({ error: { code: 'LOBBY_UNAVAILABLE' } });
    expect((await service.join(f.users[1]!, { lobbyId: f.lobbyId, inviteToken: result.inviteToken })).status).toBe('joined');
    expect(JSON.stringify(await service.read(f.lobbyId, f.users[0]!))).not.toContain(result.inviteToken);
  });
  it('cancels without creating a game, invalidates invites and closes subsequent edits', async () => {
    const f = await full(); expect(view(await cmd(f, 'cancel')).status).toBe('cancelled');
    expect(await cmd(f, 'rotate-invite')).toMatchObject({ error: { code: 'LOBBY_CLOSED' } });
    expect(await service.join(f.users[2]!, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })).toMatchObject({ error: { code: 'LOBBY_UNAVAILABLE' } });
    expect(await rooms.read(f.lobbyId)).toBeNull();
  });
  it('does not change readiness or invites after a stale request', async () => {
    const f = await configured(), s = view(await service.read(f.lobbyId, f.users[0]!));
    await cmd(f, 'set-ready', { ready: true });
    expect(await service.command(f.users[1]!, { lobbyId: f.lobbyId, expectedVersion: s.version, type: 'set-ready', ready: true })).toMatchObject({ error: { code: 'STALE_VERSION' } });
    expect(view(await service.read(f.lobbyId, f.users[1]!)).members.find(m => m.playerId === 'p2')!.ready).toBe(false);
  });
  it('rolls back sealing the lobby if inserting the game fails, then permits a safe retry', async () => {
    const f = await ready(), before = view(await service.read(f.lobbyId, f.users[0]!));
    const collision = createAutomaticBaseRoomSnapshot({ roomId: f.lobbyId, gameId: `collision-${sequence}`,
      players: [{ id: 'p1', color: 'red' }, { id: 'p2', color: 'blue' }], members: [{ userId: 'collision-a', playerId: 'p1' }, { userId: 'collision-b', playerId: 'p2' }], startingPlayerId: 'p1', clockwisePlayerIds: ['p1', 'p2'] });
    await rooms.create(collision);
    expect(await cmd(f, 'start')).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
    expect(view(await service.read(f.lobbyId, f.users[0]!))).toEqual(before); expect(await rooms.read(f.lobbyId)).toEqual(collision);
    await sql.query('DELETE FROM nco_rooms WHERE room_id = $1', [f.lobbyId]); expect(view(await cmd(f, 'start')).status).toBe('started');
  });
  it.each(['join', 'start'])('allows only one competing %s across independent services at the database CAS', async kind => {
    const f = kind === 'join' ? await fixture() : await ready();
    let release!: () => void, reads = 0; const barrier = new Promise<void>(r => { release = r; });
    const racing: RoomSqlExecutor = { query: async (text, values) => {
      const result = await sql.query(text, values);
      if (text.startsWith('SELECT lobby_id, version, snapshot, invite_hash FROM nco_lobbies WHERE lobby_id') && values?.[0] === f.lobbyId && ++reads <= 2) {
        if (reads === 2) release(); await barrier;
      } return result;
    } };
    const services = [new LobbyService(racing), new LobbyService(racing)];
    const s = view(await service.read(f.lobbyId, f.users[0]!));
    const results = await Promise.all(services.map((target, i) => kind === 'join'
      ? target.join(f.users[i + 1]!, { lobbyId: f.lobbyId, inviteToken: f.inviteToken })
      : target.command(f.users[0]!, { lobbyId: f.lobbyId, expectedVersion: s.version, type: 'start' })));
    expect(results.filter(r => r.status === (kind === 'join' ? 'joined' : 'updated'))).toHaveLength(1);
    expect(results.find(r => r.status === 'unavailable')).toMatchObject({ error: { code: 'COMMIT_CONFLICT' } });
    const after = view(await service.read(f.lobbyId, f.users[0]!)); expect(after.version).toBe(s.version + 1);
    if (kind === 'join') expect(after.members).toHaveLength(2); else expect((await rooms.read(f.lobbyId))!.state.stateVersion).toBe(1);
  });
  it('lists only member lobbies with bounded pages and restores from a new service instance', async () => {
    const f = await full(), target = new LobbyService(sql);
    const list = await target.list(f.users[1]!, { limit: 1 });
    expect(list).toEqual({ status: 'listed', lobbies: [view(await service.read(f.lobbyId, f.users[1]!))], nextAfterLobbyId: null });
    expect(await target.list(f.users[2]!, {})).toEqual({ status: 'listed', lobbies: [], nextAfterLobbyId: null });
    expect(await target.list(f.users[1]!, { afterLobbyId: f.lobbyId })).toEqual({ status: 'listed', lobbies: [], nextAfterLobbyId: null });
  });
  it.each([{ requestId: 'bad', playerCount: 5 }, { requestId: 'bad', playerCount: 2, userId: 'fake' }, { requestId: 'bad', playerCount: 2, setupOrders: {} }, null])('rejects malformed creation without SQL %#', async input => {
    const query = vi.fn(); expect(await new LobbyService({ query }).create(principal('u'), input)).toMatchObject({ error: { code: 'INVALID_MESSAGE' } }); expect(query).not.toHaveBeenCalled();
  });
  it('rejects identity, mode, outcome and hidden-deck injection in strict commands', async () => {
    const f = await configured(), s = view(await service.read(f.lobbyId, f.users[0]!));
    for (const extra of [{ userId: 'fake' }, { playerId: 'p2' }, { setupOrders: {} }, { mode: 'enterprise' }, { state: {} }]) {
      expect(await service.command(f.users[0]!, { lobbyId: f.lobbyId, expectedVersion: s.version, type: 'start', ...extra })).toMatchObject({ error: { code: 'INVALID_MESSAGE' } });
    }
  });
  it('never acknowledges a failed write or exposes raw SQL errors, and its queue permits retry', async () => {
    const f = await configured(), original = sql.query.bind(sql), query = vi.spyOn(sql, 'query');
    query.mockImplementationOnce(async () => { throw Error('DO_NOT_LEAK'); });
    expect(await service.read(f.lobbyId, f.users[0]!)).toEqual({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } });
    query.mockImplementation(async (text, values) => { if (text.startsWith('UPDATE nco_lobbies')) throw Error('DO_NOT_LEAK'); return original(text, values); });
    expect(await cmd(f, 'set-ready', { ready: true })).toMatchObject({ error: { code: 'STORAGE_UNAVAILABLE' } }); query.mockRestore();
    expect(view(await service.read(f.lobbyId, f.users[0]!)).members[0]!.ready).toBe(false);
    expect((await cmd(f, 'set-ready', { ready: true })).status).toBe('updated');
  });
  it('rejects corrupted stored rosters rather than publishing a partial lobby', async () => {
    const f = await full(), row = (await sql.query('SELECT snapshot FROM nco_lobbies WHERE lobby_id = $1', [f.lobbyId])).rows[0]!;
    const s = parseLobbySnapshot(row.snapshot);
    for (const members of [[s.members[0], s.members[0]], [{ ...s.members[0], color: 'blue' }, s.members[1]], s.members.map(m => ({ ...m, ready: true }))]) {
      expect(() => parseLobbySnapshot({ ...s, members })).toThrow();
    }
    await sql.query('UPDATE nco_lobbies SET snapshot = $2::jsonb WHERE lobby_id = $1', [f.lobbyId, JSON.stringify({ ...s, members: [s.members[0], s.members[0]] })]);
    expect(await service.read(f.lobbyId, f.users[0]!)).toMatchObject({ error: { code: 'STORAGE_UNAVAILABLE' } });
  });
});
