import type { z } from 'zod';
import type { gamePositionSchema } from './schema.js';
import type { BoardDefinition } from '../board/types.js';
import type { GameState } from './types.js';
import { availableInfluenceSlots } from './influence.js';

type MutablePosition = z.infer<typeof gamePositionSchema>;
type Reject = (code: string, message: string) => never;
export function ownBoardInfluenceSlotIds(state: GameState, playerId: string): string[] {
  return Object.entries(state.board.influenceBySlot).filter(([, marker]) => marker?.ownerPlayerId === playerId).map(([slotId]) => slotId);
}
export function hasLiskarmCleanup(used: NonNullable<NonNullable<GameState['roundFlow']>['rolesByPlayer'][number]['used']>): boolean {
  return used.roleId === 'ROLE-01' && used.mode !== 'scheme';
}
export function pendingLiskarmPlayers(state: GameState): string[] {
  return (state.playerOrder ?? []).filter(playerId => state.roundFlow?.rolesByPlayer.find(role => role.playerId === playerId)?.used?.cleanupResolved === false);
}
/** Internal marker transfer. Caller validates the selected occupied slot and permission first. */
export function returnBoardInfluence(position: MutablePosition, slotId: string): void {
  const marker = position.board.influenceBySlot[slotId]!;
  position.markerSupplyByPlayer[marker.ownerPlayerId]!.push(marker.markerId);
  position.board.influenceBySlot[slotId] = null;
}
/** Exactly two sequential attempts: impossible placements skip, executable placements require choices. */
export function placeLiskarmInfluence(position: MutablePosition, board: BoardDefinition, actorId: string, slotIds: readonly string[], reject: Reject): void {
  for (let index = 0; index < 2; index++) {
    const available = availableInfluenceSlots(position, board, actorId);
    if (!available.length) {
      if (slotIds.length > index) return reject('UNEXPECTED_PLACEMENT', 'No remaining placement can execute');
      break;
    }
    const slotId = slotIds[index];
    if (slotId === undefined) return reject('PLACEMENT_REQUIRED', 'Every executable Liskarm placement needs a target');
    if (!available.includes(slotId)) return reject('PLACEMENT_TARGET', 'Choose a legal empty influence slot');
    const markerId = position.markerSupplyByPlayer[actorId]!.shift()!;
    position.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: actorId };
  }
}
/** Conditional replacement: remove first, then try OWN placement in the SAME slot, p14. */
export function replaceLiskarmInfluence(position: MutablePosition, board: BoardDefinition, actorId: string,
  costDecision: 'pay' | 'decline', slotId: string | undefined, reject: Reject): void {
  if (costDecision === 'decline') {
    if (slotId !== undefined) return reject('UNEXPECTED_REPLACEMENT', 'Declined cost has no replacement target');
    return;
  }
  const actor = position.players[actorId]!;
  if (actor.balances['columbia-voucher'] < 3) return reject('CANNOT_PAY', 'Replacement requires three vouchers');
  const occupied = Object.entries(position.board.influenceBySlot).filter(([, marker]) => marker !== null).map(([id]) => id);
  if (!occupied.length) {
    if (slotId !== undefined) return reject('REPLACEMENT_TARGET', 'There is no board influence to replace');
    actor.balances['columbia-voucher'] -= 3;
    return;
  }
  if (slotId === undefined) return reject('REPLACEMENT_REQUIRED', 'An executable replacement needs a target');
  if (!occupied.includes(slotId)) return reject('REPLACEMENT_TARGET', 'Replacement must select existing board influence');
  actor.balances['columbia-voucher'] -= 3;
  returnBoardInfluence(position, slotId);
  if (availableInfluenceSlots(position, board, actorId).includes(slotId)) {
    const markerId = position.markerSupplyByPlayer[actorId]!.shift()!;
    position.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: actorId };
  }
}
