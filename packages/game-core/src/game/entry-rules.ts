import type { BoardDefinition } from '../board/types.js';
import { FOUNDERS_EVENT_CATALOG } from '../events/index.js';
import type { GameState } from './types.js';
import { availableInfluenceSlots } from './influence.js';

/** Confirmed setup rules: p02 green deck, p04-05 initial funds, p23 two-player variant. */
export function eligibleEntryGreenIds(playerCount: number): string[] {
  if (![2, 3, 4].includes(playerCount)) throw new RangeError('Unsupported player count');
  return FOUNDERS_EVENT_CATALOG.cards.filter(card =>
    card.color === 'green' && (playerCount === 4 || !card.hasFourPlayerMark)).map(card => card.id);
}

export function initialEntryFunds(playerCount: number): readonly number[] {
  switch (playerCount) {
    case 2: return [10, 18];
    case 3: return [10, 12, 18];
    case 4: return [10, 12, 14, 18];
    default: throw new RangeError('Unsupported player count');
  }
}

/** Normal placement conditions only; there is no adjacency limit for the p23 bonus. */
export function entryInfluenceSlots(state: GameState, board: BoardDefinition, playerId: string): string[] {
  return availableInfluenceSlots(state, board, playerId);
}
