import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { getFacilitySupplyPublicView } from '../facilities/supply.js';
import { gameEntityIdSchema } from './schema.js';
import { parseGameState } from './state.js';
import { getRoundTurn } from './round.js';
import { getFinalScoringResult } from './final-scoring.js';
import { getCityPatternContinuationOptions } from './city-pattern-continuations.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

export const GAME_VIEW_VERSION = '1.0.0' as const;
export const gameViewerContextSchema = z.strictObject({ authenticatedPlayerId: gameEntityIdSchema });
export type GameViewerContext = DeepReadonly<z.infer<typeof gameViewerContextSchema>>;
export class GameViewError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'GameViewError'; }
}
function movement(progress: NonNullable<GameState['cityMove']>) {
  return { actorId: progress.actorId, status: progress.status, roundNumber: progress.roundNumber,
    sourceNodeId: progress.sourceNodeId, targetNodeId: progress.targetNodeId, routeId: progress.routeId,
    cardId: progress.cardId, resolvedChoiceId: progress.resolvedChoiceId };
}
function exploration(progress: NonNullable<GameState['exploration']>) {
  return { actorId: progress.actorId, status: progress.status, roundNumber: progress.roundNumber,
    targetNodeId: progress.targetNodeId, cardId: progress.cardId, resolvedChoiceId: progress.resolvedChoiceId };
}
/** Allowlisted transport projection, never a persistable GameState. No viewer-specific fields. */
function publicView(state: GameState, definition: GameDefinition) {
  const flow = state.roundFlow, entry = state.entry, construction = state.construction;
  const patterns = state.cityPatterns, continuation = state.cityPatternContinuation;
  return deepFreeze({
    viewVersion: GAME_VIEW_VERSION, gameId: state.gameId, stateVersion: state.stateVersion,
    snapshotVersion: state.schemaVersion, rulesetId: definition.rulesetId,
    boardDefinitionRef: { definitionId: definition.boardDefinitionRef.definitionId,
      definitionVersion: definition.boardDefinitionRef.definitionVersion, contentHash: definition.boardDefinitionRef.contentHash },
    eventCatalogRef: { catalogId: definition.eventCatalogRef.catalogId,
      definitionVersion: definition.eventCatalogRef.definitionVersion, contentHash: definition.eventCatalogRef.contentHash },
    phase: state.phase, playerOrder: state.playerOrder ?? entry?.playerOrder ?? null,
    players: definition.players.map(player => {
      const role = flow?.rolesByPlayer.find(row => row.playerId === player.id);
      const assets = state.players[player.id]!.balances;
      return { playerId: player.id, color: player.color, score: state.players[player.id]!.score,
        balances: { orirock: assets.orirock, originium: assets.originium, iron: assets.iron,
          'columbia-voucher': assets['columbia-voucher'], 'pure-originium': assets['pure-originium'] },
        markerSupplyCount: state.markerSupplyByPlayer[player.id]!.length,
        roles: role ? { handCount: role.hand.length, discardedRoleIds: role.discarded,
          hasPlacedRole: role.placed !== null,
          usedRole: role.used ? { roleId: role.used.roleId, mode: role.used.mode, turnIndex: role.used.turnIndex,
            ...(role.used.cleanupResolved !== undefined ? { cleanupResolved: role.used.cleanupResolved } : {}) } : null } : null };
    }),
    board: { definitionRef: state.board.definitionRef,
      resourceMarkerByNode: Object.fromEntries(Object.entries(state.board.resourceMarkerByNode).map(([nodeId, marker]) =>
        [nodeId, marker ? { markerDefinitionId: marker.markerDefinitionId, resourceKind: marker.resourceKind, harvestAmount: marker.harvestAmount } : null])),
      influenceBySlot: Object.fromEntries(Object.entries(state.board.influenceBySlot).map(([slotId, marker]) =>
        [slotId, marker ? { ownerPlayerId: marker.ownerPlayerId } : null])),
      cityNodeByPlayer: state.board.cityNodeByPlayer },
    entry: entry ? { status: entry.status, completedPlayerCount: entry.completedPlayerCount,
      actorId: entry.status === 'complete' ? null : entry.playerOrder[entry.completedPlayerCount] ?? null,
      pendingEvent: entry.pendingEvent ? { playerId: entry.pendingEvent.playerId, nodeId: entry.pendingEvent.nodeId, cardId: entry.pendingEvent.cardId } : null } : null,
    eventDeckCounts: state.eventDecks ? { green: state.eventDecks.green.length, yellow: state.eventDecks.yellow.length, red: state.eventDecks.red.length }
      : entry ? { green: entry.remainingGreenEventIds.length, yellow: null, red: null } : null,
    round: flow ? { ...getRoundTurn(state, definition), supplyRemovalCount: flow.supplyRemovalCount,
      rolePlacementCount: flow.rolePlacementCount, turnIndex: flow.turnIndex,
      startingPlayerOverride: flow.startingPlayerOverride ? { playerId: flow.startingPlayerOverride.playerId, cardId: flow.startingPlayerOverride.cardId } : null } : null,
    exploration: state.exploration ? exploration(state.exploration) : null,
    cityMove: state.cityMove ? movement(state.cityMove) : null,
    influenceAction: state.influenceAction ? { kind: state.influenceAction.kind, actorId: state.influenceAction.actorId,
      roundNumber: state.influenceAction.roundNumber, status: state.influenceAction.status, operationsCompleted: state.influenceAction.operationsCompleted } : null,
    construction: construction ? { actorId: construction.actorId, roundNumber: construction.roundNumber,
      status: construction.status, constructionsCompleted: construction.constructionsCompleted, builtCardId: construction.builtCardId,
      warehouseEntry: construction.warehouseEntry ? { kind: construction.warehouseEntry.kind, status: construction.warehouseEntry.status,
        targetNodeId: construction.warehouseEntry.targetNodeId, cardId: construction.warehouseEntry.cardId, resolvedChoiceId: construction.warehouseEntry.resolvedChoiceId } : null,
      entryStack: construction.entryStack?.map(frame => frame.kind === 'entry'
        ? { kind: frame.kind, sourceCardId: frame.sourceCardId, status: frame.status }
        : { kind: frame.kind, sourceCardId: frame.sourceCardId, progress: frame.kind === 'exploration' ? exploration(frame.progress) : movement(frame.progress) }) ?? [] } : null,
    harvest: state.harvest ? { roundNumber: state.harvest.roundNumber, status: state.harvest.status,
      submittedPlayerIds: definition.players.filter(p => state.harvest!.plansByPlayer[p.id] !== null).map(p => p.id) } : null,
    facilities: state.facilities ? { supply: getFacilitySupplyPublicView(state.facilities.supply),
      panels: state.facilities.panels.map(panel => ({ playerId: panel.playerId, revision: panel.revision, panelRef: panel.panelRef,
        placements: panel.placements.map(row => ({ cellId: row.cellId, cardId: row.cardId })) })) } : null,
    cityPatterns: patterns ? { gameplayVersion: patterns.gameplayVersion, catalogHash: patterns.catalogHash,
      publicPatternIds: patterns.publicPatternIds,
      exhaustedFacilityIdsByPlayer: patterns.exhaustedFacilityIdsByPlayer,
      useTracks: patterns.useTracks.map(track => ({ playerId: track.playerId, patternId: track.patternId, remainingUses: track.remainingUses })),
      usedSpecialActions: patterns.usedSpecialActions.map(use => ({ playerId: use.playerId, patternId: use.patternId, turnIndex: use.turnIndex })),
      markers: state.patternMarkers!.map(marker => ({ ownerPlayerId: marker.ownerPlayerId, patternId: marker.patternId })) } : null,
    patternContinuation: continuation ? { kind: continuation.kind, patternId: continuation.patternId,
      ...(continuation.kind === 'city-move' ? { remainingMoves: continuation.remainingMoves } : {}) } : null,
    finalResult: state.finalScoring ? getFinalScoringResult(state, definition) : null,
  });
}
export function getGamePublicView(input: GameState, definition: GameDefinition): DeepReadonly<ReturnType<typeof publicView>> {
  return publicView(parseGameState(input, definition), definition);
}
/** Context is supplied by the trusted membership/auth adapter, never by a viewer ID in the body. */
export function getGamePlayerView(input: GameState, definition: GameDefinition, context: GameViewerContext) {
  const checked = gameViewerContextSchema.safeParse(context);
  if (!checked.success || !definition.players.some(p => p.id === checked.data.authenticatedPlayerId)) {
    throw new GameViewError('VIEWER_REFERENCE', 'Viewer must be an authenticated game member');
  }
  const playerId = checked.data.authenticatedPlayerId, state = parseGameState(input, definition);
  const role = state.roundFlow?.rolesByPlayer.find(row => row.playerId === playerId);
  const canContinue = state.cityPatternContinuation && getRoundTurn(state, definition).actorId === playerId;
  const options = canContinue ? getCityPatternContinuationOptions(state, definition, playerId) : null;
  // A permitted search reveals candidates, never their positions in the hidden shuffled deck.
  const continuationOptions = options && 'constructionOptions' in options && options.constructionOptions
    ? { ...options, constructionOptions: { ...options.constructionOptions,
      choices: [...options.constructionOptions.choices].sort((a, b) => a.cardId.localeCompare(b.cardId) || a.paymentMode.localeCompare(b.paymentMode)) } } : options;
  const result = deepFreeze({ public: publicView(state, definition), private: {
    playerId, roleHand: role ? [...role.hand].sort() : null, placedRoleId: role?.placed ?? null,
    markerSupplyIds: state.markerSupplyByPlayer[playerId]!,
    patternMarkers: state.patternMarkers?.filter(marker => marker.ownerPlayerId === playerId).map(marker => ({ markerId: marker.markerId, patternId: marker.patternId })) ?? [],
    harvestPlan: state.harvest?.plansByPlayer[playerId] ?? null,
    continuationOptions,
  } });
  return result as DeepReadonly<typeof result>;
}
export type GamePublicView = DeepReadonly<ReturnType<typeof getGamePublicView>>;
export type GamePlayerView = DeepReadonly<ReturnType<typeof getGamePlayerView>>;
