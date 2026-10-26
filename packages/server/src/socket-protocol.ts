import { z } from 'zod';
import { gameEntityIdSchema, gamePlayerRequestSchema } from '@nomad-city-online/game-core';
import type { GamePlayerView } from '@nomad-city-online/game-core';
import { sessionTokenSchema } from './sessions.js';

export const SOCKET_PROTOCOL_VERSION = '1.0.0' as const;
export const socketAuthSchema = z.strictObject({ protocolVersion: z.literal(SOCKET_PROTOCOL_VERSION), sessionToken: sessionTokenSchema });
export const socketRoomSchema = z.strictObject({ roomId: gameEntityIdSchema });
export const socketCommandSchema = socketRoomSchema.extend({ request: gamePlayerRequestSchema });
export const ROOM_SOCKET_OPTIONS = Symbol('NCO_ROOM_SOCKET_OPTIONS');
export const socketOptionsSchema = z.strictObject({ allowedOrigins: z.array(z.string().refine(value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value; }
  catch { return false; }
})).min(1).max(20) });
export interface RoomSocketOptions { readonly allowedOrigins: readonly string[] }
export type SocketFailure = { readonly status: 'unavailable'; readonly error: { readonly code: 'INVALID_MESSAGE' | 'AUTH_REQUIRED' | 'AUTH_UNAVAILABLE' | 'SERVER_UNAVAILABLE' | 'SUBSCRIPTION_LIMIT' } };
export interface RoomStateEvent { readonly protocolVersion: typeof SOCKET_PROTOCOL_VERSION; readonly roomId: string; readonly view: GamePlayerView }
