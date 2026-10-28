import type { GameDefinition, GameState } from './types.js';
/** Founders p23: two removals for 2p; Infected 20241111 p04: starting player removes one for 3p. */
export function requiredRoundSupplyRemovals(playerCount: number): number {
  return playerCount === 2 ? 2 : playerCount === 3 ? 1 : 0;
}
/** Old 3p saves with no placement yet still need the current round's decision; never undo placed roles/history. */
export function roundPreparationStage(state: GameState, definition: GameDefinition) {
  const flow = state.roundFlow!;
  return definition.players.length === 3 && flow.stage === 'role-placement' && flow.supplyRemovalCount === 0 && flow.rolePlacementCount === 0
    ? 'role-removal' as const : flow.stage;
}
