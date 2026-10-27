import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { deepFreeze, gameEntityIdSchema } from '@nomad-city-online/game-core';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { roomPrincipalSchema } from './room-state.js';
import type { RoomPrincipal } from './room-state.js';
import { RoomQueue } from './room-queue.js';
import { createAutomaticBaseRoomSnapshot } from './base-room-factory.js';
import { getLobbyView, lobbyCommandSchema, lobbyCreateSchema, lobbyJoinSchema, lobbyListSchema,
  lobbySeats, parseLobbySnapshot, validLobbySetup } from './lobby-state.js';
import type { LobbyErrorCode, LobbyListResult, LobbyResult, LobbySnapshot } from './lobby-state.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
class LobbyRuleError extends Error { constructor(readonly code: LobbyErrorCode) { super(code); } }
function reject(code: LobbyErrorCode): never { throw new LobbyRuleError(code); }
async function protect<T>(work: () => Promise<T>): Promise<T | { readonly status: 'unavailable'; readonly error: { readonly code: LobbyErrorCode } }> {
  try { return await work(); } catch (error) { return deepFreeze({ status: 'unavailable', error: { code: error instanceof LobbyRuleError ? error.code : 'STORAGE_UNAVAILABLE' } }); }
}
function user(principal: RoomPrincipal): string {
  const checked = roomPrincipalSchema.safeParse(principal); if (!checked.success) return reject('AUTH_REQUIRED');
  return checked.data.authenticatedUserId;
}
function decode(row: Record<string, unknown>): { snapshot: LobbySnapshot; inviteHash: string | null } {
  const snapshot = parseLobbySnapshot(row.snapshot), inviteHash = row.invite_hash;
  if (snapshot.lobbyId !== row.lobby_id || String(snapshot.version) !== String(row.version)
    || (snapshot.status === 'waiting' ? typeof inviteHash !== 'string' || !/^[a-f0-9]{64}$/.test(inviteHash) : inviteHash !== null)) throw Error('Invalid stored lobby metadata');
  return { snapshot, inviteHash: typeof inviteHash === 'string' ? inviteHash : null };
}
/** Account identities come only from a verified session; lobby versions are independent of game versions. */
export class LobbyService {
  constructor(private readonly sql: RoomSqlExecutor, private readonly queue = new RoomQueue()) {}
  private async load(lobbyId: string) {
    const result = await this.sql.query('SELECT lobby_id, version, snapshot, invite_hash FROM nco_lobbies WHERE lobby_id = $1', [lobbyId]);
    return result.rows[0] ? decode(result.rows[0]) : null;
  }
  async read(lobbyId: string, principal: RoomPrincipal): Promise<LobbyResult> {
    return protect(async () => {
      const userId = user(principal); if (!gameEntityIdSchema.safeParse(lobbyId).success) return reject('LOBBY_UNAVAILABLE');
      const row = await this.load(lobbyId); if (!row?.snapshot.members.some(m => m.userId === userId)) return reject('LOBBY_UNAVAILABLE');
      return deepFreeze({ status: 'ready' as const, view: getLobbyView(row.snapshot, userId) });
    });
  }
  async list(principal: RoomPrincipal, input: unknown): Promise<LobbyListResult> {
    return protect(async () => {
      const userId = user(principal), checked = lobbyListSchema.safeParse(input); if (!checked.success) return reject('INVALID_MESSAGE');
      const { limit, afterLobbyId } = checked.data;
      const result = await this.sql.query(`SELECT lobby_id, version, snapshot, invite_hash FROM nco_lobbies
        WHERE snapshot -> 'members' @> $1::jsonb AND ($2::text IS NULL OR lobby_id COLLATE "C" > $2::text COLLATE "C")
        ORDER BY lobby_id COLLATE "C" LIMIT $3`, [JSON.stringify([{ userId }]), afterLobbyId ?? null, limit + 1]);
      const lobbies = result.rows.slice(0, limit).map(row => getLobbyView(decode(row).snapshot, userId));
      return deepFreeze({ status: 'listed' as const, lobbies, nextAfterLobbyId: result.rows.length > limit ? lobbies.at(-1)!.lobbyId : null });
    });
  }
  async create(principal: RoomPrincipal, input: unknown): Promise<LobbyResult> {
    return protect(async () => {
      const userId = user(principal), checked = lobbyCreateSchema.safeParse(input); if (!checked.success) return reject('INVALID_MESSAGE');
      const { requestId, playerCount } = checked.data, inviteToken = randomBytes(32).toString('base64url');
      const snapshot = parseLobbySnapshot({ schemaVersion: '1.0.0', lobbyId: `lobby-${randomUUID()}`, gameId: `game-${randomUUID()}`,
        ownerId: userId, createRequestId: requestId, version: 0, status: 'waiting', playerCount,
        members: [{ ...lobbySeats[0], userId, ready: false }], setup: null });
      const result = await this.sql.query(`INSERT INTO nco_lobbies (lobby_id, owner_id, create_request_id, version, snapshot, invite_hash)
        VALUES ($1, $2, $3, 0, $4::jsonb, $5) ON CONFLICT DO NOTHING RETURNING lobby_id`,
      [snapshot.lobbyId, userId, requestId, JSON.stringify(snapshot), digest(inviteToken)]);
      if (result.rowCount === 1) return deepFreeze({ status: 'created' as const, view: getLobbyView(snapshot, userId), inviteToken });
      const previous = await this.sql.query('SELECT lobby_id, version, snapshot, invite_hash FROM nco_lobbies WHERE owner_id = $1 AND create_request_id = $2', [userId, requestId]);
      if (!previous.rows[0]) return reject('COMMIT_CONFLICT');
      const existing = decode(previous.rows[0]).snapshot;
      if (existing.playerCount !== playerCount) return reject('REQUEST_CONFLICT');
      // Replay recovers the same lobby, never regenerates or returns its unknown invite plaintext.
      return deepFreeze({ status: 'existing' as const, view: getLobbyView(existing, userId) });
    });
  }
  async join(principal: RoomPrincipal, input: unknown): Promise<LobbyResult> {
    return protect(async () => {
      const userId = user(principal), checked = lobbyJoinSchema.safeParse(input); if (!checked.success) return reject('INVALID_MESSAGE');
      return this.queue.run(checked.data.lobbyId, async () => {
        const row = await this.load(checked.data.lobbyId); if (!row) return reject('LOBBY_UNAVAILABLE');
        const s = row.snapshot;
        if (s.members.some(m => m.userId === userId)) return deepFreeze({ status: 'ready' as const, view: getLobbyView(s, userId) });
        if (!row.inviteHash || !timingSafeEqual(Buffer.from(digest(checked.data.inviteToken), 'hex'), Buffer.from(row.inviteHash, 'hex'))) return reject('LOBBY_UNAVAILABLE');
        if (s.members.length >= s.playerCount) return reject('LOBBY_FULL');
        const seat = lobbySeats.slice(0, s.playerCount).find(p => !s.members.some(m => m.playerId === p.playerId))!;
        const next = this.next(s, { members: [...s.members.map(m => ({ ...m, ready: false })), { ...seat, userId, ready: false }], setup: null });
        await this.save(s, next, row.inviteHash);
        return deepFreeze({ status: 'joined' as const, view: getLobbyView(next, userId) });
      });
    });
  }
  private next(s: LobbySnapshot, changes: Partial<LobbySnapshot>): LobbySnapshot {
    if (s.version === Number.MAX_SAFE_INTEGER) return reject('VERSION_EXHAUSTED');
    return parseLobbySnapshot({ ...s, ...changes, version: s.version + 1 });
  }
  private async save(s: LobbySnapshot, next: LobbySnapshot, inviteHash: string | null): Promise<void> {
    const result = await this.sql.query(`UPDATE nco_lobbies SET version = $3, snapshot = $4::jsonb, invite_hash = $5
      WHERE lobby_id = $1 AND version = $2 RETURNING lobby_id`, [s.lobbyId, s.version, next.version, JSON.stringify(next), inviteHash]);
    if (result.rowCount !== 1) return reject('COMMIT_CONFLICT');
  }
  async command(principal: RoomPrincipal, input: unknown): Promise<LobbyResult> {
    return protect(async () => {
      const userId = user(principal), checked = lobbyCommandSchema.safeParse(input); if (!checked.success) return reject('INVALID_MESSAGE');
      const c = checked.data;
      return this.queue.run(c.lobbyId, async () => {
        const row = await this.load(c.lobbyId); if (!row?.snapshot.members.some(m => m.userId === userId)) return reject('LOBBY_UNAVAILABLE');
        const s = row.snapshot;
        if (c.expectedVersion !== s.version) return reject('STALE_VERSION');
        if (s.status !== 'waiting') return reject('LOBBY_CLOSED');
        const owner = s.ownerId === userId;
        if (['configure', 'start', 'cancel', 'rotate-invite'].includes(c.type) && !owner) return reject('OWNER_REQUIRED');
        let next: LobbySnapshot, inviteHash = row.inviteHash, inviteToken: string | undefined;
        if (c.type === 'configure') {
          const setup = { startingPlayerId: c.startingPlayerId, clockwisePlayerIds: c.clockwisePlayerIds };
          if (!validLobbySetup(s, setup)) return reject('INVALID_SETUP');
          next = this.next(s, { setup, members: s.members.map(m => ({ ...m, ready: false })) });
        } else if (c.type === 'set-ready') {
          if (!s.setup) return reject('NOT_CONFIGURED');
          next = this.next(s, { members: s.members.map(m => m.userId === userId ? { ...m, ready: c.ready } : m) });
        } else if (c.type === 'leave') {
          if (owner) return reject('OWNER_MUST_CANCEL');
          next = this.next(s, { setup: null, members: s.members.filter(m => m.userId !== userId).map(m => ({ ...m, ready: false })) });
        } else if (c.type === 'cancel') {
          next = this.next(s, { status: 'cancelled' }); inviteHash = null;
        } else if (c.type === 'rotate-invite') {
          inviteToken = randomBytes(32).toString('base64url'); inviteHash = digest(inviteToken); next = this.next(s, {});
        } else {
          if (!s.setup || s.members.length !== s.playerCount || s.members.some(m => !m.ready)) return reject('NOT_READY');
          next = this.next(s, { status: 'started' });
          const room = createAutomaticBaseRoomSnapshot({ roomId: s.lobbyId, gameId: s.gameId,
            players: s.members.map(m => ({ id: m.playerId, color: m.color })),
            members: s.members.map(m => ({ userId: m.userId, playerId: m.playerId })), ...s.setup });
          // A single statement either seals the roster AND inserts the one game, or rolls both back.
          // No ON CONFLICT suppression: an insert failure must not leave a falsely started lobby.
          const started = await this.sql.query(`WITH sealed AS (
            UPDATE nco_lobbies SET version = $3, snapshot = $4::jsonb, invite_hash = NULL
            WHERE lobby_id = $1 AND version = $2 AND snapshot ->> 'status' = 'waiting' RETURNING lobby_id
          ) INSERT INTO nco_rooms (room_id, game_id, state_version, definition, members, state, lifecycle)
            SELECT lobby_id, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb FROM sealed RETURNING room_id`,
          [s.lobbyId, s.version, next.version, JSON.stringify(next), room.state.gameId, room.state.stateVersion,
            JSON.stringify(room.definition), JSON.stringify(room.members), JSON.stringify(room.state), JSON.stringify(room.lifecycle)]);
          if (started.rowCount !== 1) return reject('COMMIT_CONFLICT');
          return deepFreeze({ status: 'updated' as const, view: getLobbyView(next, userId) });
        }
        await this.save(s, next, inviteHash);
        if (c.type === 'leave') return deepFreeze({ status: 'left' as const, lobbyId: s.lobbyId, version: next.version });
        return deepFreeze({ status: 'updated' as const, view: getLobbyView(next, userId), ...(inviteToken ? { inviteToken } : {}) });
      });
    });
  }
}
