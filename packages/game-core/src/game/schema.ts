import { z } from 'zod';
import { boardStateSchema, definitionRefSchema, resourceNodeIdSchema } from '../board/schema.js';

export const gameEntityIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,99}$/);
export const playerSetupSchema = z.strictObject({
  id: gameEntityIdSchema, color: z.enum(['red', 'blue', 'green', 'yellow']),
});
export const playerSetupsSchema = z.array(playerSetupSchema).min(2).max(4);
const balance = z.number().int().nonnegative().safe();
export const resourceAssetSchema = z.enum(['orirock', 'originium', 'iron', 'columbia-voucher', 'pure-originium']);
export const resourceBalancesSchema = z.strictObject({
  orirock: balance, originium: balance, iron: balance,
  'columbia-voucher': balance, 'pure-originium': balance,
});
export const resourceCostSchema = z.strictObject({
  asset: resourceAssetSchema, amount: z.number().int().positive().safe(),
});
export const gameDefinitionSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  gameId: gameEntityIdSchema,
  rulesetId: z.enum(['founders-base-2p', 'founders-base-3p', 'founders-base-4p']),
  players: playerSetupsSchema,
  boardDefinitionRef: definitionRefSchema,
  eventCatalogRef: z.strictObject({
    catalogId: z.literal('founders-base-events'), definitionVersion: z.literal('1.0.0'),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
  markerDefinitions: z.array(z.strictObject({ id: gameEntityIdSchema, ownerPlayerId: gameEntityIdSchema }))
    .min(60).max(120),
});
export const entryProgressSchema = z.strictObject({
  status: z.enum(['selecting-node', 'resolving-event', 'bonus-influence', 'complete']),
  playerOrder: z.array(gameEntityIdSchema).min(2).max(4),
  completedPlayerCount: z.number().int().min(0).max(4),
  remainingGreenEventIds: z.array(z.string().regex(/^G\d{2}$/)).max(6),
  pendingEvent: z.strictObject({
    playerId: gameEntityIdSchema, nodeId: resourceNodeIdSchema,
    cardId: z.string().regex(/^G\d{2}$/),
  }).nullable(),
});
/** Shared authoritative facts; not a second persisted state or a turn phase. */
export const gamePositionSchema = z.strictObject({
  gameId: gameEntityIdSchema,
  board: boardStateSchema,
  players: z.record(gameEntityIdSchema, z.strictObject({
    balances: resourceBalancesSchema,
    score: z.number().int().safe(),
    scoreMarkerId: gameEntityIdSchema,
  })),
  markerSupplyByPlayer: z.record(gameEntityIdSchema, z.array(gameEntityIdSchema).max(30)),
});
export const gameStateSchema = z.strictObject({
  schemaVersion: z.enum(['1.0.0', '1.1.0']),
  stateVersion: balance,
  // Only the entry-phase foundation is implemented, not the round/action machine.
  phase: z.literal('entry'),
  ...gamePositionSchema.shape,
  entry: entryProgressSchema.optional(),
}).superRefine((state, ctx) => {
  if ((state.schemaVersion === '1.1.0') !== (state.entry !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['entry'], message: 'Entry progress requires snapshot format 1.1.0; legacy 1.0.0 has no progress' });
  }
});
