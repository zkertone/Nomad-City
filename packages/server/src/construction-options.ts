import { z } from 'zod';
import {
  deepFreeze, gameEntityIdSchema, constructionPlayerCommandSchema, nestedFacilityEntryCommandSchema, warehouseEntryPlayerCommandSchema,
  getConstructionQuote, getFacilityConstructionQuote, FacilityConstructionError,
  FOUNDERS_FACILITY_PANEL, getFacilityPhysicalCard, getFacilityExecutionFace, getFacilityEffectText,
  getEmptyFacilityPanelCells, getNestedFacilityEntryOptions, getRoundTurn,
} from '@nomad-city-online/game-core';
import type { ConstructionPlayerCommand } from '@nomad-city-online/game-core';
import type { RoomSnapshot } from './room-state.js';
import { automaticProgress } from './automatic-lifecycle.js';
import { actionPermission } from './action-permission.js';
import type { ActionPermission } from './action-permission.js';

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'gameId' | 'expectedVersion'> : never;
export type ConstructionDraft =
  | { readonly channel: 'construction'; readonly command: WithoutEnvelope<ConstructionPlayerCommand> }
  | { readonly channel: 'facility-entry'; readonly command: WithoutEnvelope<z.infer<typeof nestedFacilityEntryCommandSchema>> }
  | { readonly channel: 'warehouse-entry'; readonly command: WithoutEnvelope<z.infer<typeof warehouseEntryPlayerCommandSchema>> };
export function facilityCardView(cardId: string) {
  const card = getFacilityPhysicalCard(cardId), face = getFacilityExecutionFace(card.facilityId);
  return { cardId, facilityId: card.facilityId, color: card.color, name: face.name,
    points: face.printedScore, effect: getFacilityEffectText(card.facilityId), printedCost: face.constructionCost };
}
export interface ConstructionOptions {
  readonly status: 'ready' | 'entry-pending' | 'complete';
  readonly cells: readonly { readonly id: string; readonly row: number; readonly column: number;
    readonly card: ReturnType<typeof facilityCardView> | null }[];
  readonly emptyCellIds: readonly string[];
  readonly supply: readonly ReturnType<typeof facilityCardView>[];
  readonly buildChannel: 'construction' | 'facility-entry' | null;
  readonly buildChoices: readonly { readonly cardId: string; readonly paymentMode: 'resources' | 'vouchers' }[];
  readonly entry: null | {
    readonly kind: string; readonly channel: 'facility-entry' | 'warehouse-entry';
    readonly source: ReturnType<typeof facilityCardView> | null;
    readonly copyCards: readonly ReturnType<typeof facilityCardView>[];
    readonly extensionCards: readonly ReturnType<typeof facilityCardView>[];
    readonly routeSlotIds: readonly string[];
    readonly skipExploration: ActionPermission | null;
  };
}
export function getConstructionOptions(snapshot: RoomSnapshot, actorId: string): ConstructionOptions | null {
  const { state, definition } = snapshot, action = state.construction;
  if (state.phase !== 'construction' || action?.actorId !== actorId || state.cityPatternContinuation) return null;
  const panel = state.facilities!.panels.find(p => p.playerId === actorId)!;
  const nested = action.status === 'entry-pending' && action.entryStack?.length
    ? getNestedFacilityEntryOptions(state, definition, actorId) : null;
  const buildChannel = action.status === 'ready' ? 'construction' : nested?.kind === 'extra-construction' ? 'facility-entry' : null;
  const entry = nested ? { kind: nested.kind, channel: 'facility-entry' as const, source: facilityCardView(nested.sourceCardId),
    copyCards: ('copyCardIds' in nested ? nested.copyCardIds : []).map(facilityCardView), extensionCards: ('extensionCardIds' in nested ? nested.extensionCardIds : []).map(facilityCardView),
    routeSlotIds: 'routeSlotIds' in nested ? nested.routeSlotIds : [], skipExploration: null } : action.status === 'entry-pending' && action.warehouseEntry
      ? { kind: action.warehouseEntry.kind === 'warehouse-choice' ? 'warehouse' : 'exploration', channel: 'warehouse-entry' as const,
        source: action.builtCardId ? facilityCardView(action.builtCardId) : null, copyCards: [], extensionCards: [], routeSlotIds: [],
        skipExploration: action.warehouseEntry.kind === 'warehouse-choice' ? actionPermission(snapshot, actorId, 'warehouse-entry', { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' } }) : null } : null;
  return { status: action.status, emptyCellIds: getEmptyFacilityPanelCells(panel, state.facilities!.supply).map(c => c.id),
    cells: FOUNDERS_FACILITY_PANEL.cells.map(cell => ({ id: cell.id, row: cell.row, column: cell.column,
      card: panel.placements.find(p => p.cellId === cell.id) ? facilityCardView(panel.placements.find(p => p.cellId === cell.id)!.cardId) : null })),
    supply: state.facilities!.supply.supply.map(facilityCardView), buildChannel,
    buildChoices: buildChannel === 'construction' ? state.facilities!.supply.supply.flatMap(cardId =>
      (['resources', 'vouchers'] as const).map(paymentMode => ({ cardId, paymentMode })))
      : nested && 'constructionOptions' in nested ? nested.constructionOptions.choices : [], entry };
}
export const constructionPreviewRequestSchema = z.discriminatedUnion('channel', [
  z.strictObject({ roomId: gameEntityIdSchema, channel: z.literal('construction'), command: constructionPlayerCommandSchema }),
  z.strictObject({ roomId: gameEntityIdSchema, channel: z.literal('facility-entry'), command: nestedFacilityEntryCommandSchema }),
  z.strictObject({ roomId: gameEntityIdSchema, channel: z.literal('warehouse-entry'), command: warehouseEntryPlayerCommandSchema }),
]);
export type ConstructionPreviewRequest = z.infer<typeof constructionPreviewRequestSchema>;
type Quote = Pick<ReturnType<typeof getConstructionQuote>, 'costs' | 'orirockDiscount' | 'printedPoints' | 'canPay' | 'entryChoiceKind'>;
export type ConstructionPreviewResult =
  | { readonly status: 'ready'; readonly roomId: string; readonly gameId: string; readonly stateVersion: number;
      readonly options: null | { readonly draft: ConstructionDraft; readonly execution: ActionPermission; readonly quote: Quote | null } }
  | { readonly status: 'unavailable'; readonly error: { readonly code: 'INVALID_MESSAGE' | 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' } };
export function getRoomConstructionPreview(snapshot: RoomSnapshot, actorId: string, request: ConstructionPreviewRequest): ConstructionPreviewResult {
  const { state, definition } = snapshot;
  let options: Extract<ConstructionPreviewResult, { status: 'ready' }>['options'] = null;
  if (request.command.gameId === state.gameId && request.command.expectedVersion === state.stateVersion &&
      automaticProgress(snapshot)?.status !== 'pending' && state.roundFlow?.stage === 'player-actions' &&
      getRoundTurn(state, definition).actorId === actorId && state.phase === 'construction' && !state.cityPatternContinuation) {
    const { gameId: _game, expectedVersion: _version, ...body } = request.command;
    const execution = actionPermission(snapshot, actorId, request.channel, body);
    let quote: Quote | null = null;
    try {
      let original: Quote | null = null;
      if (request.channel === 'construction') original = getConstructionQuote(state, definition, { authenticatedPlayerId: actorId }, request.command);
      else if (request.command.type === 'construct-entry-facility') {
        const panel = state.facilities!.panels.find(p => p.playerId === actorId)!;
        const { type: _type, ...build } = body;
        original = getFacilityConstructionQuote({ position: { gameId: state.gameId, board: state.board, players: state.players,
          markerSupplyByPlayer: state.markerSupplyByPlayer, ...(state.patternMarkers ? { patternMarkers: state.patternMarkers } : {}) }, ...state.facilities! }, definition,
          { gameId: state.gameId, actorId, expectedSupplyRevision: state.facilities!.supply.revision, expectedPanelRevision: panel.revision }, build);
      }
      if (original) quote = { costs: original.costs.map(c => ({ ...c })), orirockDiscount: original.orirockDiscount,
        printedPoints: original.printedPoints, canPay: original.canPay, entryChoiceKind: original.entryChoiceKind };
    } catch (error) { if (!(error instanceof FacilityConstructionError)) throw error; }
    options = { draft: { channel: request.channel, command: body } as ConstructionDraft, execution, quote };
  }
  return deepFreeze({ status: 'ready', roomId: snapshot.roomId, gameId: state.gameId, stateVersion: state.stateVersion, options });
}
