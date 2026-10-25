import { z } from 'zod';
import { boardStateSchema, definitionRefSchema, resourceNodeIdSchema, routeIdSchema } from '../board/schema.js';
import { facilitySupplyStateSchema } from '../facilities/supply.js';
import { facilityPanelStateSchema } from '../facilities/panel-state.js';
import { roundFlowSchema } from './round-schema.js';
import { patternMarkerSchema, cityPatternStateSchema, patternMajorActionFrameSchema } from './city-pattern-schema.js';

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
  patternMarkers: z.array(patternMarkerSchema).max(116).optional(),
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
export const harvestPlanSchema = z.strictObject({
  nodeIds: z.array(resourceNodeIdSchema).max(22),
  routeIds: z.array(routeIdSchema).max(22),
  tollRecipients: z.array(z.strictObject({ routeId: routeIdSchema, payeePlayerId: gameEntityIdSchema })).max(22).optional(),
});
export const harvestProgressSchema = z.strictObject({
  roundNumber: z.number().int().min(1).max(8), status: z.enum(['planning', 'complete']),
  plansByPlayer: z.record(gameEntityIdSchema, harvestPlanSchema.nullable()),
});
export const facilityEntryFrameSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entry'), sourceCardId: z.string().min(1), status: z.enum(['choice', 'waiting']) }),
  z.strictObject({ kind: z.literal('exploration'), sourceCardId: z.string().min(1), progress: explorationProgressSchema }),
  z.strictObject({ kind: z.literal('city-move'), sourceCardId: z.string().min(1), progress: cityMoveProgressSchema }),
]);
export const gameStateSchema = z.strictObject({
  schemaVersion: z.enum(['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0']),
  stateVersion: balance,
  // Legacy snapshots use trusted grants; 1.7.0 additionally enforces the managed round schedule.
  phase: z.enum(['entry', 'exploration', 'city-move', 'influence-action', 'harvest', 'construction', 'round-control']),
  ...gamePositionSchema.shape,
  entry: entryProgressSchema.optional(),
  exploration: explorationProgressSchema.optional(),
  cityMove: cityMoveProgressSchema.optional(),
  influenceAction: influenceActionProgressSchema.optional(),
  harvest: harvestProgressSchema.optional(),
  roundFlow: roundFlowSchema.optional(),
  cityPatterns: cityPatternStateSchema.optional(),
  cityPatternMajorActions: z.array(patternMajorActionFrameSchema).max(2).optional(),
  temporarySettlementReturns: z.array(z.strictObject({ playerId: gameEntityIdSchema, cardId: z.string().min(1) })).max(3).optional(),
  cityPatternContinuation: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('city-move'), patternId: z.enum(['PAT-004', 'PAT-006']), remainingMoves: z.number().int().min(1).max(2) }),
    z.strictObject({ kind: z.literal('declaration-build'), patternId: z.literal('PAT-013'), declarationFacilityPlacements: z.array(z.strictObject({ cellId: z.string().min(1), cardId: z.string().min(1) })).min(2).max(6).optional() }),
    z.strictObject({ kind: z.literal('deck-build'), patternId: z.literal('PAT-012') }),
  ]).nullable().optional(),
  facilities: z.strictObject({ supply: facilitySupplyStateSchema, panels: z.array(facilityPanelStateSchema).min(2).max(4) }).optional(),
  construction: z.strictObject({
    actorId: gameEntityIdSchema, roundNumber: z.number().int().min(1).max(8),
    status: z.enum(['ready', 'entry-pending', 'complete']), constructionsCompleted: z.number().int().min(0).max(1),
    builtCardId: z.string().min(1).nullable(),
    entryStack: z.array(facilityEntryFrameSchema).max(24).optional(),
    warehouseEntry: z.strictObject({
      kind: z.enum(['warehouse-choice', 'warehouse-exploration']), status: z.enum(['branch-choice', 'event-choice', 'final-influence', 'complete', 'skipped']),
      targetNodeId: resourceNodeIdSchema.nullable(), cardId: z.string().regex(/^[GYR]\d{2}$/).nullable(),
      resolvedChoiceId: z.string().regex(/^[GYR]\d{2}:[1-3]$/).nullable(),
    }).optional(),
  }).optional(),
  eventDecks: eventDeckStateSchema.optional(),
  playerOrder: z.array(gameEntityIdSchema).min(2).max(4).optional(),
}).superRefine((state, ctx) => {
  if ((state.schemaVersion === '1.16.0') !== (state.temporarySettlementReturns !== undefined)
    || (state.schemaVersion === '1.16.0') !== (state.facilities?.supply.stockRef.definitionId === 'project-base-facility-stock')) {
    ctx.addIssue({ code: 'custom', path: ['temporarySettlementReturns'], message: 'Project-base inventory and return history require explicit snapshot 1.16.0' });
  }
  if (state.cityPatternContinuation?.kind === 'declaration-build' && (state.schemaVersion === '1.16.0') !== (state.cityPatternContinuation.declarationFacilityPlacements !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['cityPatternContinuation'], message: 'Declaration placement evidence requires explicit snapshot 1.16.0' });
  }
  if ((['1.15.0', '1.16.0'].includes(state.schemaVersion)) !== (state.cityPatternMajorActions !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['cityPatternMajorActions'], message: 'Pattern major-action frames require explicit snapshot 1.15.0' });
  }
  if ((['1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion)) !== (state.cityPatternContinuation !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['cityPatternContinuation'], message: 'Explicit continuation ownership requires snapshot 1.14.0' });
  }
  if ((['1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion)) !== (state.cityPatterns !== undefined) || (['1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion)) !== (state.patternMarkers !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['cityPatterns'], message: 'Pattern state and marker locations require explicit snapshot 1.13.0' });
  }
  if (!['1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) && state.roundFlow?.completedMajorAction === 'special') {
    ctx.addIssue({ code: 'custom', path: ['roundFlow'], message: 'Special-action completion requires snapshot 1.13.0' });
  }
  if (['1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) !== (state.facilities !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['facilities'], message: 'Facility ownership and panels require snapshot format 1.6.0 or later' });
  }
  if (['1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) !== (state.roundFlow !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['roundFlow'], message: 'Managed round progress requires format 1.7.0 or later' });
  }
  if (state.roundFlow?.rolesByPlayer.some(role => ['1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) !== (role.used !== undefined))) {
    ctx.addIssue({ code: 'custom', path: ['roundFlow', 'rolesByPlayer'], message: 'Format 1.8.0 or later requires explicit role-use records' });
  }
  if (state.roundFlow && (['1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) !== (state.roundFlow.completedMajorAction !== undefined))) {
    ctx.addIssue({ code: 'custom', path: ['roundFlow', 'completedMajorAction'], message: 'Format 1.10.0 requires explicit retired major-action progress' });
  }
  if (!['1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) && (state.construction?.warehouseEntry !== undefined || state.construction?.status === 'entry-pending')) {
    ctx.addIssue({ code: 'custom', path: ['construction'], message: 'Warehouse continuation requires explicit format 1.11.0' });
  }
  if (!['1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) && (state.construction?.entryStack !== undefined || state.roundFlow?.startingPlayerOverride !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['construction'], message: 'Nested facilities require explicit format 1.12.0' });
  }
  if (state.roundFlow && ['1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) && state.roundFlow.startingPlayerOverride === undefined) {
    ctx.addIssue({ code: 'custom', path: ['roundFlow'], message: 'Format 1.12.0 records the current round starting-player override explicitly' });
  }
  if ((state.schemaVersion === '1.1.0') !== (state.entry !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['entry'], message: 'Entry progress requires snapshot format 1.1.0; legacy 1.0.0 has no progress' });
  }
  if (state.phase === 'entry') {
    if (!['1.0.0', '1.1.0'].includes(state.schemaVersion) || state.exploration !== undefined || state.cityMove !== undefined || state.influenceAction !== undefined || state.harvest !== undefined || state.construction !== undefined || state.eventDecks !== undefined || state.playerOrder !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['phase'], message: 'Entry uses format 1.0.0/1.1.0 without action fields' });
    }
  } else {
    const compatible = ['1.6.0', '1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) || (state.phase === 'exploration' ? ['1.2.0', '1.3.0', '1.4.0', '1.5.0'].includes(state.schemaVersion)
      : state.phase === 'city-move' ? ['1.3.0', '1.4.0', '1.5.0'].includes(state.schemaVersion) : state.phase === 'influence-action' ? ['1.4.0', '1.5.0'].includes(state.schemaVersion) : state.phase === 'harvest' && state.schemaVersion === '1.5.0');
    if (!compatible || (state.phase === 'round-control' && !state.roundFlow) || !state.eventDecks || !state.playerOrder ||
        (state.phase === 'exploration') !== (state.exploration !== undefined) ||
        (state.phase === 'city-move') !== (state.cityMove !== undefined) ||
        (state.phase === 'influence-action') !== (state.influenceAction !== undefined) ||
        (state.phase === 'harvest') !== (state.harvest !== undefined) ||
        (state.phase === 'construction') !== (state.construction !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['phase'], message: 'Action format, phase, unique progress, decks and preserved order must agree' });
    }
  }
});
