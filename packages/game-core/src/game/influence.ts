import type { BoardDefinition } from '../board/types.js';
import type { GamePosition } from './types.js';

/** Internal query on validated facts. Range restrictions belong to the calling effect. */
export function availableInfluenceSlots(position: GamePosition, board: BoardDefinition, playerId: string): string[] {
  if (!Object.hasOwn(position.markerSupplyByPlayer, playerId) || !position.markerSupplyByPlayer[playerId]?.length) return [];
  return Object.entries(board.influenceSlots).filter(([slotId, location]) => {
    if (position.board.influenceBySlot[slotId] !== null) return false;
    if (location.kind === 'route') return true;
    return position.board.resourceMarkerByNode[location.nodeId] !== null &&
      !Object.entries(position.board.cityNodeByPlayer).some(([other, nodeId]) => other !== playerId && nodeId === location.nodeId);
  }).map(([slotId]) => slotId);
}
