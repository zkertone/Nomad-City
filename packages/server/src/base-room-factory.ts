import { z } from 'zod';
import { beginEntry, createPreEntryGame, gameEntityIdSchema, playerSetupsSchema } from '@nomad-city-online/game-core';
import { createAutomaticBasePlan } from './automatic-base-plan.js';
import { parseRoomSnapshot, roomMemberSchema } from './room-state.js';
import type { RoomSnapshot } from './room-state.js';

const orders = z.strictObject({ facilityDeckOrder: z.array(z.string()).optional(), yellowDeckOrder: z.array(z.string()).optional(),
  redDeckOrder: z.array(z.string()).optional(), patternOrder: z.array(z.string()).optional(), greenDeckOrder: z.array(z.string()).optional() });
export const automaticBaseRoomInputSchema = z.strictObject({ roomId: gameEntityIdSchema, gameId: gameEntityIdSchema,
  players: playerSetupsSchema, members: z.array(roomMemberSchema).min(2).max(4), startingPlayerId: gameEntityIdSchema,
  clockwisePlayerIds: z.array(gameEntityIdSchema).min(2).max(4), setupOrders: orders.optional() });
/** Trusted provisioning: persist this whole snapshot atomically with store.create. Never accept setupOrders from a socket. */
export function createAutomaticBaseRoomSnapshot(input: unknown): RoomSnapshot {
  const options = automaticBaseRoomInputSchema.parse(input), game = createPreEntryGame(options.gameId, options.players);
  const { greenDeckOrder, ...overrides } = options.setupOrders ?? {};
  const lifecycle = createAutomaticBasePlan(options.players.length, {
    ...(overrides.facilityDeckOrder ? { facilityDeckOrder: overrides.facilityDeckOrder } : {}),
    ...(overrides.yellowDeckOrder ? { yellowDeckOrder: overrides.yellowDeckOrder } : {}),
    ...(overrides.redDeckOrder ? { redDeckOrder: overrides.redDeckOrder } : {}),
    ...(overrides.patternOrder ? { patternOrder: overrides.patternOrder } : {}),
  });
  const state = beginEntry(game.state, game.definition, { expectedVersion: 0, startingPlayerId: options.startingPlayerId,
    clockwisePlayerIds: options.clockwisePlayerIds, ...(greenDeckOrder ? { greenDeckOrder } : {}) });
  return parseRoomSnapshot({ roomId: options.roomId, definition: game.definition, state, members: options.members, lifecycle });
}
