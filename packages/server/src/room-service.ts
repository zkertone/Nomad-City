import { deepFreeze, executeGamePlayerRequest, gameEntityIdSchema, gamePlayerRequestSchema, getGamePlayerView, parseGameState } from '@nomad-city-online/game-core';
import type { DeepReadonly, GamePlayerReply, GamePlayerView, GameState } from '@nomad-city-online/game-core';
import { roomPrincipalSchema } from './room-state.js';
import type { RoomPrincipal, RoomSnapshot, RoomStore } from './room-state.js';
import { RoomQueue } from './room-queue.js';
import { advanceAutomaticRoom, automaticProgress } from './automatic-lifecycle.js';
import type { AutomaticProgress } from './automatic-lifecycle.js';
import { getRoomEntryOptions } from './entry-options.js';
import type { EntryOptionsResult } from './entry-options.js';
import { getRoomRoundSetupOptions } from './round-setup-options.js';
import type { RoundSetupOptionsResult } from './round-setup-options.js';
import { getRoomActionOptions } from './action-options.js';
import type { ActionOptionsResult } from './action-options.js';

type AutomaticAnnotation = { readonly automatic?: AutomaticProgress };
type Unavailable = { readonly status: 'unavailable'; readonly error: { readonly code: 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' | 'COMMIT_CONFLICT' | 'AUTOMATION_PENDING' } } & AutomaticAnnotation;
export type RoomReadResult = DeepReadonly<({ status: 'ready'; view: GamePlayerView } & AutomaticAnnotation) | Unavailable>;
export type RoomSubmitResult = DeepReadonly<
  | { status: 'committed'; reply: Extract<GamePlayerReply, { ok: true }>; view: GamePlayerView }
  | { status: 'rejected'; reply: Extract<GamePlayerReply, { ok: false }> }
  | Unavailable
> & AutomaticAnnotation;
export type TrustedRoomCommitResult = DeepReadonly<({ status: 'committed'; stateVersion: number } & AutomaticAnnotation) | Unavailable>;
const annotation = (automatic?: AutomaticProgress): AutomaticAnnotation => automatic ? { automatic } : {};
const entryUnavailable = (code: 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE'): Extract<EntryOptionsResult, { status: 'unavailable' }> => deepFreeze({ status: 'unavailable', error: { code } });
const unavailable = (code: Unavailable['error']['code'], automatic?: AutomaticProgress): Unavailable => deepFreeze({ status: 'unavailable', error: { code }, ...annotation(automatic) });
function playerFor(snapshot: RoomSnapshot | null, principal: RoomPrincipal): string | null {
  return snapshot?.members.find(member => member.userId === principal.authenticatedUserId)?.playerId ?? null;
}
/** Provider for a future authenticated gateway. Principal comes from its session, never the body. */
export class RoomService {
  constructor(private readonly store: RoomStore, private readonly queue = new RoomQueue()) {}
  async readActionOptions(roomId: string, principalInput: RoomPrincipal): Promise<ActionOptionsResult> {
    const principal = roomPrincipalSchema.safeParse(principalInput);
    if (!principal.success || !gameEntityIdSchema.safeParse(roomId).success) return entryUnavailable('ROOM_UNAVAILABLE');
    return this.queue.run(roomId, async () => {
      let snapshot: RoomSnapshot | null;
      try { snapshot = await this.store.read(roomId); }
      catch { return entryUnavailable('STORAGE_UNAVAILABLE'); }
      const playerId = playerFor(snapshot, principal.data);
      if (!snapshot || !playerId) return entryUnavailable('ROOM_UNAVAILABLE');
      return getRoomActionOptions(snapshot, playerId);
    });
  }
  async readRoundSetupOptions(roomId: string, principalInput: RoomPrincipal): Promise<RoundSetupOptionsResult> {
    const principal = roomPrincipalSchema.safeParse(principalInput);
    if (!principal.success || !gameEntityIdSchema.safeParse(roomId).success) return entryUnavailable('ROOM_UNAVAILABLE');
    return this.queue.run(roomId, async () => {
      let snapshot: RoomSnapshot | null;
      try { snapshot = await this.store.read(roomId); }
      catch { return entryUnavailable('STORAGE_UNAVAILABLE'); }
      const playerId = playerFor(snapshot, principal.data);
      if (!snapshot || !playerId) return entryUnavailable('ROOM_UNAVAILABLE');
      return getRoomRoundSetupOptions(snapshot, playerId);
    });
  }
  async readEntryOptions(roomId: string, principalInput: RoomPrincipal): Promise<EntryOptionsResult> {
    const principal = roomPrincipalSchema.safeParse(principalInput);
    if (!principal.success || !gameEntityIdSchema.safeParse(roomId).success) return entryUnavailable('ROOM_UNAVAILABLE');
    return this.queue.run(roomId, async () => {
      let snapshot: RoomSnapshot | null;
      try { snapshot = await this.store.read(roomId); } catch { return entryUnavailable('STORAGE_UNAVAILABLE'); }
      const playerId = playerFor(snapshot, principal.data);
      if (!snapshot || !playerId) return entryUnavailable('ROOM_UNAVAILABLE');
      return getRoomEntryOptions(snapshot, playerId);
    });
  }
  readView(roomId: string, principalInput: RoomPrincipal): Promise<RoomReadResult> { return this.read(roomId, principalInput, true); }
  /** Publication must observe committed facts without initiating another automatic transition. */
  readCommittedView(roomId: string, principalInput: RoomPrincipal): Promise<RoomReadResult> { return this.read(roomId, principalInput, false); }
  private async read(roomId: string, principalInput: RoomPrincipal, resume: boolean): Promise<RoomReadResult> {
    const checked = roomPrincipalSchema.safeParse(principalInput);
    if (!gameEntityIdSchema.safeParse(roomId).success || !checked.success) return unavailable('ROOM_UNAVAILABLE');
    const principal = checked.data;
    return this.queue.run(roomId, async () => {
      let snapshot: RoomSnapshot | null;
      try { snapshot = await this.store.read(roomId); } catch { return unavailable('STORAGE_UNAVAILABLE'); }
      const playerId = playerFor(snapshot, principal);
      if (!snapshot || !playerId) return unavailable('ROOM_UNAVAILABLE');
      const settled = resume ? await advanceAutomaticRoom(snapshot, this.store) : { snapshot, automatic: automaticProgress(snapshot) };
      return deepFreeze({ status: 'ready', view: getGamePlayerView(settled.snapshot.state, settled.snapshot.definition, { authenticatedPlayerId: playerId }), ...annotation(settled.automatic) });
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
      const before = await advanceAutomaticRoom(snapshot, this.store);
      if (before.automatic?.status === 'pending') return unavailable('AUTOMATION_PENDING', before.automatic);
      snapshot = before.snapshot;
      // Rule/programming faults propagate as server faults, without converting them into a false acknowledgement.
      const result = executeGamePlayerRequest(snapshot.state, snapshot.definition, { authenticatedPlayerId: playerId }, request.success ? request.data : null);
      if (result.status === 'rejected') return deepFreeze({ status: 'rejected', reply: result.reply, ...annotation(before.automatic) });
      let committed: boolean;
      try { committed = await this.store.compareAndSwap(roomId, snapshot.state.stateVersion, result.state); }
      catch { return unavailable('STORAGE_UNAVAILABLE', before.automatic); }
      if (!committed) return unavailable('COMMIT_CONFLICT', before.automatic);
      const after = await advanceAutomaticRoom({ ...snapshot, state: result.state }, this.store);
      // The player write is already confirmed even if a following automatic boundary is pending.
      // Safe response and requesting member's view are produced only after the durable store confirms the write.
      return deepFreeze({ status: 'committed', reply: result.reply,
        view: getGamePlayerView(after.snapshot.state, snapshot.definition, { authenticatedPlayerId: playerId }), ...annotation(after.automatic) });
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
      if (!committed) return unavailable('COMMIT_CONFLICT');
      const after = await advanceAutomaticRoom({ ...snapshot, state: next }, this.store);
      return deepFreeze({ status: 'committed', stateVersion: next.stateVersion, ...annotation(after.automatic) });
    });
  }
}
