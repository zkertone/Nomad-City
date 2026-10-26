import { z } from 'zod';
import { deepFreeze, gameEntityIdSchema, parseGameDefinition, parseGameState } from '@nomad-city-online/game-core';
import type { DeepReadonly, GameDefinition, GameState } from '@nomad-city-online/game-core';
import { parseAutomaticBasePlan, validateAutomaticBaseState } from './automatic-base-plan.js';
import type { AutomaticBasePlan } from './automatic-base-plan.js';

export const roomMemberSchema = z.strictObject({ userId: gameEntityIdSchema, playerId: gameEntityIdSchema });
export const roomPrincipalSchema = z.strictObject({ authenticatedUserId: gameEntityIdSchema });
export type RoomPrincipal = DeepReadonly<z.infer<typeof roomPrincipalSchema>>;
export type RoomMember = DeepReadonly<z.infer<typeof roomMemberSchema>>;
export interface RoomSnapshot {
  readonly roomId: string;
  readonly definition: GameDefinition;
  readonly state: GameState;
  readonly members: readonly RoomMember[];
  readonly lifecycle?: AutomaticBasePlan;
}
const snapshotSchema = z.strictObject({ roomId: gameEntityIdSchema, definition: z.unknown(), state: z.unknown(),
  members: z.array(roomMemberSchema).min(2).max(4), lifecycle: z.unknown().optional() });
/** Trusted provisioning only: a fixed, fully seated game. Lobby/invite/seat-change policy is separate. */
export function parseRoomSnapshot(input: unknown): RoomSnapshot {
  const raw = snapshotSchema.parse(input), definition = parseGameDefinition(raw.definition);
  const state = parseGameState(raw.state, definition);
  const users = raw.members.map(m => m.userId), players = raw.members.map(m => m.playerId).sort();
  if (new Set(users).size !== users.length || new Set(players).size !== players.length
    || JSON.stringify(players) !== JSON.stringify(definition.players.map(p => p.id).sort())) {
    throw new Error('Room membership must map distinct users to exactly the game players');
  }
  const lifecycle = raw.lifecycle === undefined ? undefined : parseAutomaticBasePlan(raw.lifecycle, definition.players.length);
  if (lifecycle) validateAutomaticBaseState(state);
  return deepFreeze({ roomId: raw.roomId, definition, state, members: raw.members, ...(lifecycle ? { lifecycle } : {}) });
}
export interface RoomStore {
  create(snapshot: RoomSnapshot): Promise<boolean>;
  read(roomId: string): Promise<RoomSnapshot | null>;
  compareAndSwap(roomId: string, expectedVersion: number, next: GameState): Promise<boolean>;
}
