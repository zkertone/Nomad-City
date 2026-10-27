import { z } from 'zod';
import { deepFreeze, gameEntityIdSchema } from '@nomad-city-online/game-core';
import type { DeepReadonly } from '@nomad-city-online/game-core';

const version = z.number().int().safe().nonnegative();
export const lobbySeats = [
  { playerId: 'p1', color: 'red' }, { playerId: 'p2', color: 'blue' },
  { playerId: 'p3', color: 'green' }, { playerId: 'p4', color: 'yellow' },
] as const;
export const lobbySetupSchema = z.strictObject({ startingPlayerId: gameEntityIdSchema, clockwisePlayerIds: z.array(gameEntityIdSchema).min(2).max(4) });
const memberSchema = z.strictObject({ userId: gameEntityIdSchema, playerId: gameEntityIdSchema,
  color: z.enum(['red', 'blue', 'green', 'yellow']), ready: z.boolean() });
const snapshotSchema = z.strictObject({ schemaVersion: z.literal('1.0.0'), lobbyId: gameEntityIdSchema,
  gameId: gameEntityIdSchema, ownerId: gameEntityIdSchema, createRequestId: gameEntityIdSchema,
  version, status: z.enum(['waiting', 'started', 'cancelled']), playerCount: z.number().int().min(2).max(4),
  members: z.array(memberSchema).min(1).max(4), setup: lobbySetupSchema.nullable(),
});
export type LobbySnapshot = DeepReadonly<z.infer<typeof snapshotSchema>>;
export function validLobbySetup(snapshot: Pick<LobbySnapshot, 'members' | 'playerCount'>, setup: z.infer<typeof lobbySetupSchema>): boolean {
  const ids = snapshot.members.map(m => m.playerId).sort();
  return ids.length === snapshot.playerCount && ids.includes(setup.startingPlayerId)
    && JSON.stringify([...setup.clockwisePlayerIds].sort()) === JSON.stringify(ids);
}
export function parseLobbySnapshot(input: unknown): LobbySnapshot {
  const s = snapshotSchema.parse(input);
  if (s.members.length > s.playerCount || !s.members.some(m => m.userId === s.ownerId && m.playerId === 'p1')
    || new Set(s.members.map(m => m.userId)).size !== s.members.length
    || new Set(s.members.map(m => m.playerId)).size !== s.members.length
    || s.members.some(m => !lobbySeats.slice(0, s.playerCount).some(seat => seat.playerId === m.playerId && seat.color === m.color))
    || (s.setup !== null && !validLobbySetup(s, s.setup)) || (s.setup === null && s.members.some(m => m.ready))
    || (s.status === 'started' && (s.setup === null || s.members.some(m => !m.ready)))) throw Error('Invalid stored lobby');
  return deepFreeze(s);
}
export interface LobbyView {
  readonly lobbyId: string; readonly version: number; readonly status: LobbySnapshot['status']; readonly playerCount: number;
  readonly selfPlayerId: string; readonly ownerPlayerId: 'p1'; readonly roomId: string | null;
  readonly members: readonly { readonly playerId: string; readonly color: string; readonly ready: boolean }[];
  readonly setup: LobbySnapshot['setup'];
}
export function getLobbyView(snapshot: LobbySnapshot, userId: string): LobbyView {
  const self = snapshot.members.find(m => m.userId === userId); if (!self) throw Error('Lobby member required');
  return deepFreeze({ lobbyId: snapshot.lobbyId, version: snapshot.version, status: snapshot.status, playerCount: snapshot.playerCount,
    selfPlayerId: self.playerId, ownerPlayerId: 'p1' as const, roomId: snapshot.status === 'started' ? snapshot.lobbyId : null,
    members: snapshot.members.map(m => ({ playerId: m.playerId, color: m.color, ready: m.ready })),
    setup: snapshot.setup === null ? null : { startingPlayerId: snapshot.setup.startingPlayerId, clockwisePlayerIds: [...snapshot.setup.clockwisePlayerIds] } });
}
export const lobbyIdSchema = z.strictObject({ lobbyId: gameEntityIdSchema });
export const lobbyCreateSchema = z.strictObject({ requestId: gameEntityIdSchema, playerCount: z.number().int().min(2).max(4) });
export const lobbyInviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const lobbyJoinSchema = lobbyIdSchema.extend({ inviteToken: lobbyInviteTokenSchema });
export const lobbyListSchema = z.strictObject({ limit: z.number().int().min(1).max(50).default(20), afterLobbyId: gameEntityIdSchema.optional() });
const envelope = { lobbyId: gameEntityIdSchema, expectedVersion: version };
export const lobbyCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('configure'), ...lobbySetupSchema.shape }),
  z.strictObject({ ...envelope, type: z.literal('set-ready'), ready: z.boolean() }),
  ...(['start', 'leave', 'cancel', 'rotate-invite'] as const).map(type => z.strictObject({ ...envelope, type: z.literal(type) })),
]);
export type LobbyErrorCode = 'INVALID_MESSAGE' | 'AUTH_REQUIRED' | 'LOBBY_UNAVAILABLE' | 'LOBBY_FULL' | 'LOBBY_CLOSED'
  | 'OWNER_REQUIRED' | 'OWNER_MUST_CANCEL' | 'STALE_VERSION' | 'COMMIT_CONFLICT' | 'NOT_CONFIGURED' | 'NOT_READY'
  | 'INVALID_SETUP' | 'REQUEST_CONFLICT' | 'VERSION_EXHAUSTED' | 'STORAGE_UNAVAILABLE';
export type LobbyFailure = { readonly status: 'unavailable'; readonly error: { readonly code: LobbyErrorCode } };
export type LobbyResult = DeepReadonly<
  | { status: 'ready' | 'created' | 'existing' | 'joined' | 'updated'; view: LobbyView; inviteToken?: string }
  | { status: 'left'; lobbyId: string; version: number }
  | LobbyFailure
>;
export type LobbyListResult = DeepReadonly<{ status: 'listed'; lobbies: LobbyView[]; nextAfterLobbyId: string | null } | LobbyFailure>;
