import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import type { EventColor } from '../events/types.js';
import type { BoardDefinition } from '../board/types.js';
import type { GamePosition } from './types.js';
import { availableInfluenceSlots } from './influence.js';

export function redExplorationOpeningRound(playerCount: number): number {
  if (playerCount === 4) return 4;
  if (playerCount === 3) return 5;
  if (playerCount === 2) return 6;
  throw new RangeError('Unsupported player count');
}
export function eligibleBaseEventIds(count: number, color: EventColor): string[] {
  return FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color && (count === 4 || !card.hasFourPlayerMark)).map(card => card.id);
}
export function finalExplorationSlots(position: GamePosition, board: BoardDefinition, actorId: string, nodeId: string): string[] {
  return availableInfluenceSlots(position, board, actorId).filter(id => {
    const slot = board.influenceSlots[id]!;
    return slot.kind === 'resource-node' && slot.nodeId === nodeId;
  });
}
