import { boardStateSchema } from './schema.js';
import { deepFreeze } from './hash.js';
import { parseBoardDefinition, validateDefinitionRef } from './validate.js';
import type { BoardDefinition, BoardState, ValidationIssue, ValidationResult } from './types.js';

/** An empty pre-entry snapshot; player count/turn rules belong to a future RuleSet. */
export function createEmptyBoardState(board: BoardDefinition, playerIds: readonly string[]): BoardState {
  const definition = parseBoardDefinition(board);
  if (new Set(playerIds).size !== playerIds.length) throw new Error('Player IDs must be unique');
  return deepFreeze(boardStateSchema.parse({
    definitionRef: {
      definitionId: definition.definitionId,
      definitionVersion: definition.definitionVersion,
      contentHash: definition.contentHash,
    },
    resourceMarkerByNode: Object.fromEntries(Object.keys(definition.resourceNodes).map((id) => [id, null])),
    influenceBySlot: Object.fromEntries(Object.keys(definition.influenceSlots).map((id) => [id, null])),
    cityNodeByPlayer: Object.fromEntries(playerIds.map((id) => [id, null])),
  }));
}

/** Snapshot structure/references only. No marker catalog, economy or action rules. */
export function validateBoardState(input: unknown, board: BoardDefinition): ValidationResult<BoardState> {
  const parsed = boardStateSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map((issue) => ({
    code: 'SCHEMA', path: issue.path.map(String).join('.'), message: issue.message,
  })) };
  const state = parsed.data;
  const ref = validateDefinitionRef(state.definitionRef, board);
  const issues: ValidationIssue[] = ref.success ? [] : [...ref.issues];
  const report = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
  for (const [actual, expected, path] of [
    [state.resourceMarkerByNode, board.resourceNodes, 'resourceMarkerByNode'],
    [state.influenceBySlot, board.influenceSlots, 'influenceBySlot'],
  ] as const) {
    if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
      report('STATE_KEYS', path, 'Snapshot must cover exactly the loaded definition IDs');
    }
  }
  const occupiedCities = new Set<string>();
  for (const [player, nodeId] of Object.entries(state.cityNodeByPlayer)) {
    if (nodeId === null) continue;
    if (!Object.hasOwn(board.resourceNodes, nodeId)) report('CITY_REFERENCE', player, 'City references unknown resource node');
    if (occupiedCities.has(nodeId)) report('CITY_DUPLICATE', player, 'Multiple cities occupy the same resource node');
    occupiedCities.add(nodeId);
  }
  const markers = new Set<string>();
  for (const [slotId, marker] of Object.entries(state.influenceBySlot)) {
    if (marker === null) continue;
    if (!Object.hasOwn(state.cityNodeByPlayer, marker.ownerPlayerId)) report('PLAYER_REFERENCE', slotId, 'Unknown marker owner');
    if (markers.has(marker.markerId)) report('MARKER_DUPLICATE', slotId, 'The same marker is in multiple slots');
    markers.add(marker.markerId);
  }
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(state) };
}
