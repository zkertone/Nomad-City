import { deepFreeze } from '../board/hash.js';
import type { BoardDefinition } from '../board/types.js';
import type { GamePosition } from './types.js';

export interface RouteTollLeg {
  readonly routeId: string;
  readonly amount: 0 | 2;
  readonly recipientPlayerIds: readonly string[];
  readonly toSupply: boolean;
}
/** Internal pricing only: callers validate connected travel/collection selections. */
export function quoteRouteTolls(position: GamePosition, board: BoardDefinition, actorId: string, routeIds: readonly string[]) {
  const legs: RouteTollLeg[] = [...new Set(routeIds)].map(routeId => {
    const route = board.routes[routeId]!;
    const owners = [...new Set(route.influenceSlotIds.flatMap(id => {
      const marker = position.board.influenceBySlot[id]; return marker ? [marker.ownerPlayerId] : [];
    }))];
    const own = owners.includes(actorId);
    return { routeId, amount: own ? 0 : 2, recipientPlayerIds: own ? [] : owners, toSupply: !owners.length };
  });
  return deepFreeze({ total: legs.reduce((sum, leg) => sum + leg.amount, 0), legs });
}
