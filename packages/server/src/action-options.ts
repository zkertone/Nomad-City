import {
  applyInfluenceCommand, applyRoundCommand, deepFreeze,
  getDeploymentSlotIds, getDispatchSourceSlotIds, getDispatchTargetSlotIds,
  getRoundTurn, InfluenceActionError, RoundFlowError,
} from '@nomad-city-online/game-core';
import type { RoomSnapshot } from './room-state.js';
import { automaticProgress } from './automatic-lifecycle.js';

export interface ActionPermission {
  readonly legal: boolean;
  readonly blockedBy: string | null;
}
export interface ActionOptions {
  readonly actorId: string;
  readonly actions: readonly (ActionPermission & { readonly action: 'deploy' | 'dispatch' })[];
  readonly influence: {
    readonly kind: 'deploy' | 'dispatch';
    readonly status: 'ready' | 'complete';
    readonly operationsCompleted: number;
    readonly deploymentSlotIds: readonly string[];
    readonly dispatches: readonly { readonly sourceSlotId: string; readonly targetSlotIds: readonly string[] }[];
  } | null;
  readonly cancelPreparation: ActionPermission;
  readonly finishDispatch: ActionPermission;
  readonly finishTurn: ActionPermission;
}
export type ActionOptionsResult =
  | { readonly status: 'ready'; readonly roomId: string; readonly gameId: string;
      readonly stateVersion: number; readonly blockedReason: 'AUTOMATION_PENDING' | null;
      readonly options: ActionOptions | null }
  | { readonly status: 'unavailable'; readonly error: { readonly code: 'ROOM_UNAVAILABLE' | 'STORAGE_UNAVAILABLE' } };

/** Probe the existing pure reducer; never save or disclose its candidate state. */
function permission(snapshot: RoomSnapshot, playerId: string, channel: 'round' | 'influence', command: Record<string, unknown>): ActionPermission {
  try {
    (channel === 'round' ? applyRoundCommand : applyInfluenceCommand)(
      snapshot.state, snapshot.definition, { authenticatedPlayerId: playerId },
      { gameId: snapshot.state.gameId, expectedVersion: snapshot.state.stateVersion, ...command },
    );
    return { legal: true, blockedBy: null };
  } catch (error) {
    if (error instanceof RoundFlowError || error instanceof InfluenceActionError)
      return { legal: false, blockedBy: error.code };
    throw error;
  }
}
/** Actor-only options for the first supported ordinary actions; reads never advance automation. */
export function getRoomActionOptions(snapshot: RoomSnapshot, playerId: string): ActionOptionsResult {
  const { state, definition } = snapshot;
  const pending = automaticProgress(snapshot)?.status === 'pending';
  let options: ActionOptions | null = null;
  if (!pending && state.roundFlow?.stage === 'player-actions' && getRoundTurn(state, definition).actorId === playerId) {
    const action = state.phase === 'influence-action' ? state.influenceAction : null;
    let deploymentSlotIds: readonly string[] = [], dispatches: NonNullable<ActionOptions['influence']>['dispatches'] = [];
    if (action?.kind === 'deploy') {
      const ids = getDeploymentSlotIds(state, definition, playerId);
      if (ids[0] && permission(snapshot, playerId, 'influence', { type: 'deploy-influence', slotId: ids[0] }).legal)
        deploymentSlotIds = ids;
    } else if (action?.kind === 'dispatch') {
      dispatches = getDispatchSourceSlotIds(state, definition, playerId).flatMap(sourceSlotId => {
        const targetSlotIds = getDispatchTargetSlotIds(state, definition, playerId, sourceSlotId);
        return targetSlotIds[0] && permission(snapshot, playerId, 'influence', {
          type: 'dispatch-influence', sourceSlotId, targetSlotId: targetSlotIds[0],
        }).legal ? [{ sourceSlotId, targetSlotIds }] : [];
      });
    }
    options = {
      actorId: playerId,
      actions: (['deploy', 'dispatch'] as const).map(action => ({ action,
        ...permission(snapshot, playerId, 'round', { type: 'choose-major-action', action }) })),
      influence: action ? { kind: action.kind, status: action.status, operationsCompleted: action.operationsCompleted,
        deploymentSlotIds, dispatches } : null,
      cancelPreparation: permission(snapshot, playerId, 'round', { type: 'cancel-major-preparation' }),
      finishDispatch: permission(snapshot, playerId, 'influence', { type: 'finish-dispatch' }),
      finishTurn: permission(snapshot, playerId, 'round', { type: 'finish-player-turn' }),
    };
  }
  return deepFreeze({ status: 'ready', roomId: snapshot.roomId, gameId: state.gameId,
    stateVersion: state.stateVersion, blockedReason: pending ? 'AUTOMATION_PENDING' : null, options });
}
