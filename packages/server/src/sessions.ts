import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { deepFreeze, gameEntityIdSchema } from '@nomad-city-online/game-core';
import type { RoomSqlExecutor } from './postgres-room-store.js';

export const SESSION_DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
export const SESSION_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export interface AuthenticatedSession { readonly userId: string; readonly expiresAt: number }
export async function migrateSessionStore(sql: RoomSqlExecutor): Promise<void> {
  // The migration contains two statements; execute as one explicit startup operation, never a player message.
  const text = await readFile(new URL('../migrations/002-sessions.sql', import.meta.url), 'utf8');
  for (const statement of text.split(';').map(s => s.trim()).filter(Boolean)) await sql.query(statement);
}
/** Trusted issuer/verifier. Account login decides the user first; there is no client "login as userId" endpoint. */
export class SessionService {
  constructor(private readonly sql: RoomSqlExecutor, private readonly clock: () => number = Date.now) {}
  now(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid session clock');
    return value;
  }
  async issue(userId: string, ttlMs = SESSION_DEFAULT_TTL_MS): Promise<{ readonly token: string; readonly expiresAt: number }> {
    gameEntityIdSchema.parse(userId);
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > SESSION_MAX_TTL_MS) throw new Error('Invalid session lifetime');
    const expiresAt = this.now() + ttlMs;
    if (!Number.isSafeInteger(expiresAt)) throw new Error('Session expiry exceeds the safe integer range');
    const token = randomBytes(32).toString('base64url');
    await this.sql.query('INSERT INTO nco_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hash(token), userId, expiresAt]);
    return deepFreeze({ token, expiresAt });
  }
  async resolve(input: unknown): Promise<AuthenticatedSession | null> {
    const token = sessionTokenSchema.safeParse(input);
    if (!token.success) return null;
    const now = this.now();
    const result = await this.sql.query('SELECT user_id, expires_at FROM nco_sessions WHERE token_hash = $1 AND expires_at > $2', [hash(token.data), now]);
    const row = result.rows[0]; if (!row) return null;
    const userId = gameEntityIdSchema.parse(row.user_id), expiresAt = Number(row.expires_at);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new Error('Invalid stored session expiry');
    if (expiresAt <= this.now()) return null;
    return deepFreeze({ userId, expiresAt });
  }
  async revoke(input: unknown): Promise<boolean> {
    const token = sessionTokenSchema.safeParse(input); if (!token.success) return false;
    const result = await this.sql.query('DELETE FROM nco_sessions WHERE token_hash = $1', [hash(token.data)]);
    return result.rowCount === 1;
  }
}
