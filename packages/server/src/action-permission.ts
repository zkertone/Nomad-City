import { applyHarvestCommand, applyRoundCommand, applyInfluenceCommand, applyExplorationCommand, applyCityMoveCommand, applyConstructionCommand, applyNestedFacilityEntryCommand, applyWarehouseEntryCommand, applyBaseRoleCommand, applyCityPatternCommand, applyCityPatternContinuationCommand, applyRoleCleanupCommand,
  HarvestError, RoundFlowError, InfluenceActionError, ExplorationCommandError, CityMoveCommandError, FacilityConstructionError, FacilityEntryError, WarehouseEntryError, BaseRoleEffectError, CityPatternActionError, CityPatternContinuationError, PatternMajorActionError, RoleCleanupError } from '@nomad-city-online/game-core';
import type { RoomSnapshot } from './room-state.js';
export interface ActionPermission { readonly legal: boolean; readonly blockedBy: string | null }
const reducers = { harvest: applyHarvestCommand, round: applyRoundCommand, influence: applyInfluenceCommand,
  exploration: applyExplorationCommand, 'city-move': applyCityMoveCommand, construction: applyConstructionCommand, 'facility-entry': applyNestedFacilityEntryCommand, 'warehouse-entry': applyWarehouseEntryCommand, role: applyBaseRoleCommand, 'city-pattern': applyCityPatternCommand, 'pattern-continuation': applyCityPatternContinuationCommand, 'role-cleanup': applyRoleCleanupCommand };
/** Probe the existing pure reducer; never save or disclose its candidate state. */
export function actionPermission(snapshot: RoomSnapshot, playerId: string, channel: keyof typeof reducers, command: Record<string, unknown>): ActionPermission {
  try {
    reducers[channel](
      snapshot.state, snapshot.definition, { authenticatedPlayerId: playerId },
      { gameId: snapshot.state.gameId, expectedVersion: snapshot.state.stateVersion, ...command },
    );
    return { legal: true, blockedBy: null };
  } catch (error) {
    if (error instanceof HarvestError || error instanceof RoundFlowError || error instanceof InfluenceActionError || error instanceof ExplorationCommandError || error instanceof CityMoveCommandError || error instanceof FacilityConstructionError || error instanceof FacilityEntryError || error instanceof WarehouseEntryError || error instanceof BaseRoleEffectError || error instanceof CityPatternActionError || error instanceof CityPatternContinuationError || error instanceof PatternMajorActionError || error instanceof RoleCleanupError)
      return { legal: false, blockedBy: error.code };
    throw error;
  }
}
