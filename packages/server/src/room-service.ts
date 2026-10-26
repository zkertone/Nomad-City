import { deepFreeze, executeGamePlayerRequest, gameEntityIdSchema, gamePlayerRequestSchema, getGamePlayerView, parseGameState } from '@nomad-city-online/game-core';
import type { DeepReadonly, GamePlayerReply, GamePlayerView, GameState } from '@nomad-city-online/game-core';
import { roomPrincipalSchema } from './room-state.js';
import type { RoomPrincipal, RoomSnapshot, RoomStore } from './room-state.js';
import { RoomQueue } from './room-queue.js';

type Unavailable = { readonly status: 'unavailable'; readonly error: { readonly code: 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' | 'COMMIT_CONFLICT' } };
export type RoomReadResult = DeepReadonly<{ status: 'ready'; view: GamePlayerView } | Unavailable>;
export type RoomSubmitResult = DeepReadonly<
  | { status: 'committed'; reply: Extract<GamePlayerReply, { ok: true }>; view: GamePlayerView }
  | { status: 'rejected'; reply: Extract<GamePlayerReply, { ok: false }> }
  | Unavailable
>;
export type TrustedRoomCommitResult = DeepReadonly<{ status: 'committed'; stateVersion: number } | Unavailable>;
const unavailable = (code: Unavailable['error']['code']): Unavailable => deepFreeze({ status: 'unavailable', error: { code } });
function playerFor(snapshot: RoomSnapshot | null, principal: RoomPrincipal): string | null {
  return snapshot?.members.find(member => member.userId === principal.authenticatedUserId)?.playerId ?? null;
}
/** Provider for a future authenticated gateway. Principal comes from its session, never the body. */
export class RoomService {
  constructor(private readonly store: RoomStore, private readonly queue = new RoomQueue()) {}
  async readView(roomId: string, principalInput: RoomPrincipal): Promise<RoomReadResult> {
    const checked = roomPrincipalSchema.safeParse(principalInput);
    if (!gameEntityIdSchema.safeParse(roomId).success || !checked.success) return unavailable('ROOM_UNAVAILABLE');
    const principal = checked.data;
    return this.queue.run(roomId, async () => {
      let snapshot: RoomSnapshot | null;
      try { snapshot = await this.store.read(roomId); } catch { return unavailable('STORAGE_UNAVAILABLE'); }
      const playerId = playerFor(snapshot, principal);
      if (!snapshot || !playerId) return unavailable('ROOM_UNAVAILABLE');
      return deepFreeze({ status: 'ready', view: getGamePlayerView(snapshot.state, snapshot.definition, { authenticatedPlayerId: playerId }) });
    });
  }
  async submit(roomId: string, principalInput: RoomPrincipal, payload: unknown): Promise<RoomSubmitResult> {
    const checked = roomPrincipalSchema.safeParse(principalInput);
    if (!gameEntityIdSchema.safeParse(roomId).success || !checked.success) return unavailable('ROOM_UNAVAILABLE');
    const principal = checked.data, request = gamePlayerRequestSchema.safeParse(payload);
    return this.queue.run(roomId, async () => {
      let snapshot: RoomSnapshot | null;
      try { snapshot = await this.store.read(roomId); } catch { return unavailable('STORAGE_UNAVAILABLE'); }
      const playerId = playerFor(snapshot, principal);
      if (!snapshot || !playerId) return unavailable('ROOM_UNAVAILABLE');
      // Rule/programming faults propagate as server faults, without converting them into a false acknowledgement.
      const result = executeGamePlayerRequest(snapshot.state, snapshot.definition, { authenticatedPlayerId: playerId }, request.success ? request.data : null);
      if (result.status === 'rejected') return deepFreeze({ status: 'rejected', reply: result.reply });
      let committed: boolean;
      try { committed = await this.store.compareAndSwap(roomId, snapshot.state.stateVersion, result.state); }
      catch { return unavailable('STORAGE_UNAVAILABLE'); }
      if (!committed) return unavailable('COMMIT_CONFLICT');
      // Safe response and requesting member's view are produced only after the durable store confirms the write.
      return deepFreeze({ status: 'committed', reply: result.reply,
        view: getGamePlayerView(result.state, snapshot.definition, { authenticatedPlayerId: playerId }) });
    });
  }
  /** Internal stage/setup runner, not a player endpoint. Same queue/CAS discipline as player writes. */
  async commitTrustedTransition(roomId: string, expectedVersion: number, transition: (snapshot: RoomSnapshot) => GameState): Promise<TrustedRoomCommitResult> {
    gameEntityIdSchema.parse(roomId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('Invalid expected room version');
    return this.queue.run(roomId, async () => {
      let snapshot: RoomSnapshot | null;
      try { snapshot = await this.store.read(roomId); } catch { return unavailable('STORAGE_UNAVAILABLE'); }
      if (!snapshot) return unavailable('ROOM_UNAVAILABLE');
      if (snapshot.state.stateVersion !== expectedVersion) return unavailable('COMMIT_CONFLICT');
      const next = parseGameState(transition(snapshot), snapshot.definition);
      if (next.stateVersion !== expectedVersion + 1) throw new Error('Trusted transition must advance exactly one version');
      let committed: boolean;
      try { committed = await this.store.compareAndSwap(roomId, expectedVersion, next); }
      catch { return unavailable('STORAGE_UNAVAILABLE'); }
      return committed ? deepFreeze({ status: 'committed', stateVersion: next.stateVersion }) : unavailable('COMMIT_CONFLICT');
    });
  }
}
