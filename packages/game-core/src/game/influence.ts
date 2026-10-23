import type { z } from 'zod';
import type { gamePositionSchema } from './schema.js';
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

/** Shared ordinary/free city-move clearing: chosen route and destination only, original owners regain markers. */
export function clearOpposingCityMoveInfluence(position: z.infer<typeof gamePositionSchema>, board: BoardDefinition, actorId: string, routeId: string, nodeId: string): void {
  for (const slotId of [...board.routes[routeId]!.influenceSlotIds, ...board.resourceNodes[nodeId]!.influenceSlotIds]) {
    const marker = position.board.influenceBySlot[slotId];
    if (marker && marker.ownerPlayerId !== actorId) {
      position.markerSupplyByPlayer[marker.ownerPlayerId]!.push(marker.markerId);
      position.board.influenceBySlot[slotId] = null;
    }
  }
}

/** Internal physical-marker return; caller validates the occupied slot and permission first. */
export function returnBoardInfluence(position: z.infer<typeof gamePositionSchema>, slotId: string): void {
  const marker = position.board.influenceBySlot[slotId]!;
  position.markerSupplyByPlayer[marker.ownerPlayerId]!.push(marker.markerId);
  position.board.influenceBySlot[slotId] = null;
}
/** Cost-free replacement primitive: remove first, then try own placement in the SAME slot (p14). */
export function replaceBoardInfluence(position: z.infer<typeof gamePositionSchema>, board: BoardDefinition, actorId: string,
  slotId: string | undefined, reject: (code: string, message: string) => never): void {
  const occupied = Object.entries(position.board.influenceBySlot).filter(([, marker]) => marker !== null).map(([id]) => id);
  if (!occupied.length) {
    if (slotId !== undefined) return reject('REPLACEMENT_TARGET', 'There is no board influence to replace');
    return;
  }
  if (slotId === undefined) return reject('REPLACEMENT_REQUIRED', 'An executable replacement needs a target');
  if (!occupied.includes(slotId)) return reject('REPLACEMENT_TARGET', 'Replacement must select existing board influence');
  returnBoardInfluence(position, slotId);
  if (availableInfluenceSlots(position, board, actorId).includes(slotId)) {
    const markerId = position.markerSupplyByPlayer[actorId]!.shift()!;
    position.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: actorId };
  }
}
