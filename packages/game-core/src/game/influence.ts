import type { BoardDefinition } from '../board/types.js';
import type { GamePosition } from './types.js';

/** Empty placement targets, independent of supply: dispatch reuses an existing board marker. */
export function emptyInfluenceSlots(position: GamePosition, board: BoardDefinition, playerId: string): string[] {
  return Object.entries(board.influenceSlots).filter(([slotId, location]) => {
    if (position.board.influenceBySlot[slotId] !== null) return false;
    if (location.kind === 'route') return true;
    return position.board.resourceMarkerByNode[location.nodeId] !== null &&
      !Object.entries(position.board.cityNodeByPlayer).some(([other, nodeId]) => other !== playerId && nodeId === location.nodeId);
  }).map(([slotId]) => slotId);
}

/** Internal placement query on validated facts. Range restrictions belong to the calling effect. */
export function availableInfluenceSlots(position: GamePosition, board: BoardDefinition, playerId: string): string[] {
  if (!Object.hasOwn(position.markerSupplyByPlayer, playerId) || !position.markerSupplyByPlayer[playerId]?.length) return [];
  return emptyInfluenceSlots(position, board, playerId);
}

export function dispatchSourceSlots(position: GamePosition, board: BoardDefinition, playerId: string): string[] {
  if (!emptyInfluenceSlots(position, board, playerId).length) return [];
  return Object.entries(position.board.influenceBySlot).filter(([, marker]) => marker?.ownerPlayerId === playerId).map(([id]) => id);
}

export function availableTargetInfluenceSlots(position: GamePosition, board: BoardDefinition, playerId: string, nodeId: string): string[] {
  return availableInfluenceSlots(position, board, playerId).filter(id => {
    const slot = board.influenceSlots[id]!;
    return slot.kind === 'resource-node' && slot.nodeId === nodeId;
  });
}
