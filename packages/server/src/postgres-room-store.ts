import { readFile } from 'node:fs/promises';
import { gameEntityIdSchema, parseGameState } from '@nomad-city-online/game-core';
import type { GameState } from '@nomad-city-online/game-core';
import { parseRoomSnapshot } from './room-state.js';
import type { RoomSnapshot, RoomStore } from './room-state.js';

/** Compatible with node-postgres Pool; also injectable for database adapter contract tests. */
export interface RoomSqlExecutor {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}
function decode(row: Record<string, unknown>): RoomSnapshot {
  const snapshot = parseRoomSnapshot({ roomId: row.room_id, definition: row.definition, state: row.state, members: row.members });
  if (row.game_id !== snapshot.state.gameId || String(row.state_version) !== String(snapshot.state.stateVersion)) {
    throw new Error('Persisted room metadata does not match its game snapshot');
  }
  return snapshot;
}
export async function migrateRoomStore(sql: RoomSqlExecutor): Promise<void> {
  await sql.query(await readFile(new URL('../migrations/001-rooms.sql', import.meta.url), 'utf8'));
}
export class PostgresRoomStore implements RoomStore {
  constructor(private readonly sql: RoomSqlExecutor) {}
  async create(input: RoomSnapshot): Promise<boolean> {
    const snapshot = parseRoomSnapshot(input);
    const result = await this.sql.query(`INSERT INTO nco_rooms
      (room_id, game_id, state_version, definition, members, state) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
      ON CONFLICT DO NOTHING RETURNING room_id`, [snapshot.roomId, snapshot.state.gameId, snapshot.state.stateVersion,
      JSON.stringify(snapshot.definition), JSON.stringify(snapshot.members), JSON.stringify(snapshot.state)]);
    return result.rowCount === 1;
  }
  async read(roomId: string): Promise<RoomSnapshot | null> {
    gameEntityIdSchema.parse(roomId);
    const result = await this.sql.query('SELECT room_id, game_id, state_version, definition, members, state FROM nco_rooms WHERE room_id = $1', [roomId]);
    return result.rows[0] ? decode(result.rows[0]) : null;
  }
  async compareAndSwap(roomId: string, expectedVersion: number, input: GameState): Promise<boolean> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion === Number.MAX_SAFE_INTEGER) throw new Error('Invalid expected room version');
    const current = await this.read(roomId);
    if (!current || current.state.stateVersion !== expectedVersion) return false;
    const next = parseGameState(input, current.definition);
    if (next.stateVersion !== expectedVersion + 1) throw new Error('Room commits must advance exactly one game version');
    // One conditional statement is the commit. There is no detached membership/definition update.
    const result = await this.sql.query(`UPDATE nco_rooms SET state_version = $3, state = $4::jsonb
      WHERE room_id = $1 AND state_version = $2 RETURNING room_id`, [roomId, expectedVersion, next.stateVersion, JSON.stringify(next)]);
    return result.rowCount === 1;
  }
}
