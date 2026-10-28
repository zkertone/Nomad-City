import { applyRoundCommand, applyInfluenceCommand, applyExplorationCommand, applyCityMoveCommand,
  RoundFlowError, InfluenceActionError, ExplorationCommandError, CityMoveCommandError } from '@nomad-city-online/game-core';
import type { RoomSnapshot } from './room-state.js';
export interface ActionPermission { readonly legal: boolean; readonly blockedBy: string | null }
const reducers = { round: applyRoundCommand, influence: applyInfluenceCommand,
  exploration: applyExplorationCommand, 'city-move': applyCityMoveCommand };
/** Probe the existing pure reducer; never save or disclose its candidate state. */
export function actionPermission(snapshot: RoomSnapshot, playerId: string, channel: 'round' | 'influence' | 'exploration' | 'city-move', command: Record<string, unknown>): ActionPermission {
  try {
    reducers[channel](
      snapshot.state, snapshot.definition, { authenticatedPlayerId: playerId },
      { gameId: snapshot.state.gameId, expectedVersion: snapshot.state.stateVersion, ...command },
    );
    return { legal: true, blockedBy: null };
  } catch (error) {
    if (error instanceof RoundFlowError || error instanceof InfluenceActionError || error instanceof ExplorationCommandError || error instanceof CityMoveCommandError)
      return { legal: false, blockedBy: error.code };
    throw error;
  }
}
