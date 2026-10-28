import { z } from 'zod';
import {
  deepFreeze, gameEntityIdSchema, baseRolePlayerCommandSchema, cityPatternPlayerCommandSchema, roleCleanupCommandSchema,
  cityPatternContinuationCommandSchema, FOUNDERS_BASE_ROLES, getRoundTurn, isBaseRoleModeAvailableInFormat,
  getElysiumSchemeOptions, getCityPatternDeclarationOptions, getCityPatternSpecialOptions, getCityPattern,
  getRoleCleanupOptions, getCityPatternContinuationOptions, isTemporarySettlementCard,
} from '@nomad-city-online/game-core';
import type { RoomSnapshot } from './room-state.js';
import { facilityCardView } from './construction-options.js';
import { automaticProgress } from './automatic-lifecycle.js';
import { actionPermission } from './action-permission.js';
import type { ActionPermission } from './action-permission.js';

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'gameId' | 'expectedVersion'> : never;
export type QuickDraft =
  | { readonly channel: 'role'; readonly command: WithoutEnvelope<z.infer<typeof baseRolePlayerCommandSchema>> }
  | { readonly channel: 'city-pattern'; readonly command: WithoutEnvelope<z.infer<typeof cityPatternPlayerCommandSchema>> }
  | { readonly channel: 'role-cleanup'; readonly command: WithoutEnvelope<z.infer<typeof roleCleanupCommandSchema>> }
  | { readonly channel: 'pattern-continuation'; readonly command: WithoutEnvelope<z.infer<typeof cityPatternContinuationCommandSchema>> };

/** Actor-only advice from original queries; completed effects are never inferred by the view. */
export function getQuickOptions(snapshot: RoomSnapshot, actorId: string) {
  const { state, definition } = snapshot, flow = state.roundFlow!, turn = getRoundTurn(state, definition);
  const window = flow.stage === 'player-actions' && turn.majorActionStatus !== 'pending';
  const own = flow.rolesByPlayer.find(row => row.playerId === actorId)!;
  const role = window && own.placed && !own.used ? {
    roleId: own.placed, name: FOUNDERS_BASE_ROLES.find(r => r.id === own.placed)!.name,
    modes: (['strategy', 'scheme', 'both'] as const).filter(mode => isBaseRoleModeAvailableInFormat(own.placed!, mode, state.schemaVersion)),
    discardedRoleIds: [...own.discarded], elysiumMoves: getElysiumSchemeOptions(state, definition, actorId),
  } : null;
  const declarations = window && state.cityPatterns ? getCityPatternDeclarationOptions(state, definition, actorId) : [];
  const specials = window && state.cityPatterns ? getCityPatternSpecialOptions(state, definition, actorId) : [];
  const patterns = state.cityPatterns?.publicPatternIds.map(id => {
    const card = getCityPattern(id), declaration = declarations.find(d => d.patternId === id), special = specials.find(s => s.patternId === id);
    return { id, name: card.name, level: card.level, score: card.printedScore, effectText: card.effectText,
      cells: card.cells.map(c => ({ row: c.row, column: c.column, colors: [...c.colors] })),
      declarationEffect: card.declarationEffect, specialAction: card.specialAction,
      matches: declaration?.matches ?? [], supported: declaration?.supported ?? false,
      hasAvailableMarker: declaration?.hasAvailableMarker ?? false,
      special: special ? { markerIds: [...special.markerIds], markerCount: special.markerCount, remainingUses: special.remainingUses } : null };
  }) ?? [];
  const continuation = state.cityPatternContinuation?.kind === 'city-move' ? getCityPatternContinuationOptions(state, definition, actorId) : null;
  return {
    window, role, patterns,
    extraActions: state.cityPatternMajorActions?.map(frame => ({ patternId: frame.patternId, name: getCityPattern(frame.patternId).name, remainingActions: frame.remainingActions })) ?? [],
    supplyCards: state.facilities!.supply.supply.map(facilityCardView),
    facilities: state.facilities!.panels.find(p => p.playerId === actorId)!.placements.map(p => ({ ...facilityCardView(p.cardId), cellId: p.cellId })),
    temporaryFacilityIds: state.facilities!.panels.find(p => p.playerId === actorId)!.placements.filter(p => isTemporarySettlementCard(p.cardId)).map(p => p.cardId),
    exchangeMarkerIds: [...state.patternMarkers?.filter(m => m.ownerPlayerId === actorId && getCityPattern(m.patternId).level === 1).map(m => m.markerId) ?? [],
      ...(state.markerSupplyByPlayer[actorId]![0] ? [state.markerSupplyByPlayer[actorId]![0]!] : [])],
    cleanupSlotIds: flow.stage === 'cleanup' ? getRoleCleanupOptions(state, definition, actorId) : [],
    patternRouteSlotIds: continuation && 'routeSlotIds' in continuation ? continuation.routeSlotIds : [],
  };
}
export type QuickOptions = ReturnType<typeof getQuickOptions>;
export const quickPreviewRequestSchema = z.discriminatedUnion('channel', [
  z.strictObject({ roomId: gameEntityIdSchema, channel: z.literal('role'), command: baseRolePlayerCommandSchema }),
  z.strictObject({ roomId: gameEntityIdSchema, channel: z.literal('city-pattern'), command: cityPatternPlayerCommandSchema }),
  z.strictObject({ roomId: gameEntityIdSchema, channel: z.literal('role-cleanup'), command: roleCleanupCommandSchema }),
  z.strictObject({ roomId: gameEntityIdSchema, channel: z.literal('pattern-continuation'), command: cityPatternContinuationCommandSchema }),
]);
export type QuickPreviewRequest = z.infer<typeof quickPreviewRequestSchema>;
export type QuickPreviewResult =
  | { readonly status: 'ready'; readonly roomId: string; readonly gameId: string; readonly stateVersion: number;
      readonly options: null | { readonly draft: QuickDraft; readonly execution: ActionPermission } }
  | { readonly status: 'unavailable'; readonly error: { readonly code: 'INVALID_MESSAGE' | 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' } };
export function getRoomQuickPreview(snapshot: RoomSnapshot, actorId: string, request: QuickPreviewRequest): QuickPreviewResult {
  const { state, definition } = snapshot;
  let options: Extract<QuickPreviewResult, { status: 'ready' }>['options'] = null;
  if (request.command.gameId === state.gameId && request.command.expectedVersion === state.stateVersion &&
      automaticProgress(snapshot)?.status !== 'pending' && state.roundFlow &&
      ['player-actions', 'cleanup'].includes(state.roundFlow.stage) && getRoundTurn(state, definition).actorId === actorId) {
    const { gameId: _game, expectedVersion: _version, ...body } = request.command;
    options = { draft: { channel: request.channel, command: body } as QuickDraft,
      execution: actionPermission(snapshot, actorId, request.channel, body) };
  }
  return deepFreeze({ status: 'ready', roomId: snapshot.roomId, gameId: state.gameId, stateVersion: state.stateVersion, options });
}
