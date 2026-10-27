import { z } from 'zod';
import { deepFreeze, gameEntityIdSchema, gameStateSchema } from '@nomad-city-online/game-core';
import type { DeepReadonly } from '@nomad-city-online/game-core';
import type { RoomSqlExecutor } from './postgres-room-store.js';
import { roomPrincipalSchema } from './room-state.js';
import type { RoomPrincipal } from './room-state.js';

export const roomListRequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).default(20),
  afterRoomId: gameEntityIdSchema.optional(),
});
export const roomSummarySchema = z.strictObject({
  roomId: gameEntityIdSchema, gameId: gameEntityIdSchema, playerId: gameEntityIdSchema,
  playerCount: z.number().int().min(2).max(4), stateVersion: z.number().int().safe().nonnegative(),
  phase: gameStateSchema.shape.phase, roundNumber: z.number().int().min(1).max(8).nullable(),
  scored: z.boolean(),
});
export type RoomSummary = DeepReadonly<z.infer<typeof roomSummarySchema>>;
export type RoomListResult = DeepReadonly<
  | { status: 'listed'; rooms: RoomSummary[]; nextAfterRoomId: string | null }
  | { status: 'unavailable'; error: { code: 'INVALID_MESSAGE' | 'AUTH_REQUIRED' | 'STORAGE_UNAVAILABLE' } }
>;
/** Authenticated, read-only directory. Never loads full snapshots or resumes an automatic boundary. */
export class RoomDirectory {
  constructor(private readonly sql: RoomSqlExecutor) {}
  async list(principalInput: RoomPrincipal, input: unknown): Promise<RoomListResult> {
    const principal = roomPrincipalSchema.safeParse(principalInput), request = roomListRequestSchema.safeParse(input);
    if (!principal.success) return deepFreeze({ status: 'unavailable', error: { code: 'AUTH_REQUIRED' } });
    if (!request.success) return deepFreeze({ status: 'unavailable', error: { code: 'INVALID_MESSAGE' } });
    const { limit, afterRoomId } = request.data, userId = principal.data.authenticatedUserId;
    try {
      // Filter membership BEFORE pagination. C collation gives a stable bytewise cursor order on all hosts.
      // Project only allowlisted metadata in SQL; no roster, hidden state or setup plan leaves the database.
      const result = await this.sql.query(`SELECT room_id, game_id, state_version,
        jsonb_array_length(members) AS player_count,
        (SELECT member ->> 'playerId' FROM jsonb_array_elements(members) AS member
          WHERE member ->> 'userId' = $4 LIMIT 1) AS player_id,
        state ->> 'phase' AS phase, state -> 'roundFlow' -> 'roundNumber' AS round_number,
        (state ->> 'schemaVersion' = '1.17.0') AS scored
        FROM nco_rooms WHERE members @> $1::jsonb
          AND ($2::text IS NULL OR room_id COLLATE "C" > $2::text COLLATE "C")
        ORDER BY room_id COLLATE "C" ASC LIMIT $3`,
      [JSON.stringify([{ userId }]), afterRoomId ?? null, limit + 1, userId]);
      const rooms = result.rows.slice(0, limit).map(row => roomSummarySchema.parse({
        roomId: row.room_id, gameId: row.game_id, playerId: row.player_id,
        playerCount: row.player_count, stateVersion: Number(row.state_version), phase: row.phase,
        roundNumber: row.round_number ?? null, scored: row.scored,
      }));
      return deepFreeze({ status: 'listed', rooms,
        nextAfterRoomId: result.rows.length > limit ? rooms.at(-1)!.roomId : null });
    } catch { return deepFreeze({ status: 'unavailable', error: { code: 'STORAGE_UNAVAILABLE' } }); }
  }
}
