import { z } from 'zod';
import {
  deepFreeze, gameEntityIdSchema, harvestPlayerCommandSchema, getHarvestEligibleNodeIds, getHarvestQuote,
  loadFoundersBoard, getFoundersMapSide, getGamePosition, quoteRouteTolls, HarvestError,
} from '@nomad-city-online/game-core';
import type { HarvestPlayerCommand } from '@nomad-city-online/game-core';
import type { RoomSnapshot } from './room-state.js';
import { automaticProgress } from './automatic-lifecycle.js';
import { actionPermission } from './action-permission.js';
import type { ActionPermission } from './action-permission.js';
export type HarvestDraft = Omit<HarvestPlayerCommand, 'gameId' | 'expectedVersion'>;
function planning(snapshot: RoomSnapshot) {
  return snapshot.state.phase === 'harvest' && snapshot.state.harvest?.status === 'planning' && automaticProgress(snapshot)?.status !== 'pending';
}
/** Simultaneous planning: every authenticated member may query their own options, including submitted members. */
export function getRoomHarvestOptions(snapshot: RoomSnapshot, playerId: string) {
  const { state, definition } = snapshot;
  let options = null;
  if (planning(snapshot) && definition.players.some(p => p.id === playerId)) {
    const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
    const tolls = quoteRouteTolls(getGamePosition(state, definition), board, playerId, Object.keys(board.routes));
    options = {
      nodeChoices: getHarvestEligibleNodeIds(state, definition, playerId).map(nodeId => {
        const marker = state.board.resourceMarkerByNode[nodeId]!;
        return { nodeId, resourceKind: marker.resourceKind, harvestAmount: marker.harvestAmount };
      }),
      routes: tolls.legs.map(leg => ({ ...leg, incidentNodeIds: [...board.routes[leg.routeId]!.incidentNodeIds] })),
      plan: state.harvest!.plansByPlayer[playerId]!,
    };
  }
  return deepFreeze({ status: 'ready' as const, roomId: snapshot.roomId, gameId: state.gameId, stateVersion: state.stateVersion,
    blockedReason: automaticProgress(snapshot)?.status === 'pending' ? 'AUTOMATION_PENDING' as const : null, options });
}
export type HarvestOptionsResult = ReturnType<typeof getRoomHarvestOptions> | {
  readonly status: 'unavailable'; readonly error: { readonly code: 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' };
};
export const harvestPreviewRequestSchema = z.strictObject({ roomId: gameEntityIdSchema, command: harvestPlayerCommandSchema });
export type HarvestPreviewRequest = z.infer<typeof harvestPreviewRequestSchema>;
export type HarvestPreviewResult =
  | { readonly status: 'ready'; readonly roomId: string; readonly gameId: string; readonly stateVersion: number;
      readonly options: null | { readonly draft: HarvestDraft; readonly execution: ActionPermission; readonly quote: ReturnType<typeof getHarvestQuote> | null } }
  | { readonly status: 'unavailable'; readonly error: { readonly code: 'INVALID_MESSAGE' | 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' } };
export function getRoomHarvestPreview(snapshot: RoomSnapshot, playerId: string, request: HarvestPreviewRequest): HarvestPreviewResult {
  const { state, definition } = snapshot;
  let options: Extract<HarvestPreviewResult, { status: 'ready' }>['options'] = null;
  if (planning(snapshot) && definition.players.some(p => p.id === playerId) && request.command.gameId === state.gameId && request.command.expectedVersion === state.stateVersion) {
    const { gameId: _game, expectedVersion: _version, ...draft } = request.command;
    let quote: ReturnType<typeof getHarvestQuote> | null = null;
    try { quote = getHarvestQuote(state, definition, playerId, draft.plan); }
    catch (error) { if (!(error instanceof HarvestError)) throw error; }
    options = { draft, execution: actionPermission(snapshot, playerId, 'harvest', draft), quote };
  }
  return deepFreeze({ status: 'ready', roomId: snapshot.roomId, gameId: state.gameId, stateVersion: state.stateVersion, options });
}
