import { z } from 'zod';
import { boardStateSchema, definitionRefSchema, resourceNodeIdSchema, routeIdSchema } from '../board/schema.js';

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
export const eventDeckStateSchema = z.strictObject({
  green: z.array(z.string().regex(/^G\d{2}$/)).max(6),
  yellow: z.array(z.string().regex(/^Y\d{2}$/)).max(10),
  red: z.array(z.string().regex(/^R\d{2}$/)).max(6),
});
export const explorationProgressSchema = z.strictObject({
  actorId: gameEntityIdSchema,
  roundNumber: z.number().int().min(1).max(8),
  status: z.enum(['ready', 'event-choice', 'final-influence', 'complete']),
  targetNodeId: resourceNodeIdSchema.nullable(),
  cardId: z.string().regex(/^[GYR]\d{2}$/).nullable(),
  resolvedChoiceId: z.string().regex(/^[GYR]\d{2}:[1-3]$/).nullable(),
});
export const cityMoveProgressSchema = z.strictObject({
  actorId: gameEntityIdSchema,
  roundNumber: z.number().int().min(1).max(8),
  status: z.enum(['ready', 'event-choice', 'final-influence', 'complete']),
  sourceNodeId: resourceNodeIdSchema.nullable(),
  targetNodeId: resourceNodeIdSchema.nullable(),
  routeId: routeIdSchema.nullable(),
  // Null when moving to an already explored target: that event must not trigger again.
  cardId: z.string().regex(/^[GYR]\d{2}$/).nullable(),
  resolvedChoiceId: z.string().regex(/^[GYR]\d{2}:[1-3]$/).nullable(),
});
export const influenceActionProgressSchema = z.strictObject({
  kind: z.enum(['deploy', 'dispatch']),
  actorId: gameEntityIdSchema,
  roundNumber: z.number().int().min(1).max(8),
  status: z.enum(['ready', 'complete']),
  operationsCompleted: z.number().int().min(0).max(2),
});
export const gameStateSchema = z.strictObject({
  schemaVersion: z.enum(['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0']),
  stateVersion: balance,
  // A trusted caller grants one implemented action; round scheduling is not implemented.
  phase: z.enum(['entry', 'exploration', 'city-move', 'influence-action']),
  ...gamePositionSchema.shape,
  entry: entryProgressSchema.optional(),
  exploration: explorationProgressSchema.optional(),
  cityMove: cityMoveProgressSchema.optional(),
  influenceAction: influenceActionProgressSchema.optional(),
  eventDecks: eventDeckStateSchema.optional(),
  playerOrder: z.array(gameEntityIdSchema).min(2).max(4).optional(),
}).superRefine((state, ctx) => {
  if ((state.schemaVersion === '1.1.0') !== (state.entry !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['entry'], message: 'Entry progress requires snapshot format 1.1.0; legacy 1.0.0 has no progress' });
  }
  if (state.phase === 'entry') {
    if (!['1.0.0', '1.1.0'].includes(state.schemaVersion) || state.exploration !== undefined || state.cityMove !== undefined || state.influenceAction !== undefined || state.eventDecks !== undefined || state.playerOrder !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['phase'], message: 'Entry uses format 1.0.0/1.1.0 without action fields' });
    }
  } else {
    const compatible = state.phase === 'exploration' ? ['1.2.0', '1.3.0', '1.4.0'].includes(state.schemaVersion)
      : state.phase === 'city-move' ? ['1.3.0', '1.4.0'].includes(state.schemaVersion) : state.schemaVersion === '1.4.0';
    if (!compatible || !state.eventDecks || !state.playerOrder ||
        (state.phase === 'exploration') !== (state.exploration !== undefined) ||
        (state.phase === 'city-move') !== (state.cityMove !== undefined) ||
        (state.phase === 'influence-action') !== (state.influenceAction !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['phase'], message: 'Action format, phase, unique progress, decks and preserved order must agree' });
    }
  }
});
