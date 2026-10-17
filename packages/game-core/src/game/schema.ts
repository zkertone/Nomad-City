import { z } from 'zod';
import { boardStateSchema, definitionRefSchema } from '../board/schema.js';

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
export const gameStateSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'), gameId: gameEntityIdSchema,
  stateVersion: balance,
  // Only the entry-phase foundation is implemented, not the round/action machine.
  phase: z.literal('entry'),
  board: boardStateSchema,
  players: z.record(gameEntityIdSchema, z.strictObject({
    balances: resourceBalancesSchema,
    score: z.number().int().safe(),
    scoreMarkerId: gameEntityIdSchema,
  })),
  markerSupplyByPlayer: z.record(gameEntityIdSchema, z.array(gameEntityIdSchema).max(30)),
});
