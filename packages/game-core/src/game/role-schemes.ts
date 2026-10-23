import { z } from 'zod';
import type { BoardDefinition } from '../board/types.js';
import { resourceNodeIdSchema, routeIdSchema, slotIdSchema } from '../board/schema.js';
import { gamePositionSchema } from './schema.js';
import type { DeepReadonly, GamePosition } from './types.js';
import { availableTargetInfluenceSlots, clearOpposingCityMoveInfluence, dispatchSourceSlots, emptyInfluenceSlots } from './influence.js';
import { redExplorationOpeningRound } from './exploration-rules.js';
import { replaceLiskarmInfluence, returnBoardInfluence } from './liskarm-rules.js';

type MutablePosition = z.infer<typeof gamePositionSchema>;
type Reject = (code: string, message: string) => never;
export const elysiumSchemeChoiceSchema = z.strictObject({ kind: z.literal('elysium-city-move'), costDecision: z.enum(['pay', 'decline']),
  nodeId: resourceNodeIdSchema.optional(), routeId: routeIdSchema.optional(), finalSlotId: slotIdSchema.optional(),
});
export const texasSchemeChoiceSchema = z.strictObject({ kind: z.literal('texas-influence'), costDecision: z.enum(['pay', 'decline']),
  replaceSlotId: slotIdSchema.optional(), move: z.strictObject({ sourceSlotId: slotIdSchema, targetSlotId: slotIdSchema }).optional(), removeSlotId: slotIdSchema.optional(),
});
export const cannotSchemeChoiceSchema = z.strictObject({ kind: z.literal('forced-sale'), asset: z.enum(['orirock', 'originium', 'iron']) });

/** p14: adjacent node, at least one own influence, no opposing influence; ordinary movement restrictions still apply. */
export function elysiumDestinations(position: GamePosition, board: BoardDefinition, actorId: string, roundNumber: number, playerCount: number) {
  const source = position.board.cityNodeByPlayer[actorId]!;
  const options: { nodeId: string; routeId: string }[] = [];
  for (const route of Object.values(board.routes)) if (route.incidentNodeIds.includes(source)) for (const nodeId of route.incidentNodeIds) {
    const node = board.resourceNodes[nodeId]!;
    if (nodeId === source || !position.board.resourceMarkerByNode[nodeId] || Object.entries(position.board.cityNodeByPlayer).some(([other, city]) => other !== actorId && city === nodeId)) continue;
    if (node.redRestricted && roundNumber < redExplorationOpeningRound(playerCount)) continue;
    const owners = node.influenceSlotIds.map(slot => position.board.influenceBySlot[slot]?.ownerPlayerId).filter(owner => owner !== undefined);
    if (owners.includes(actorId) && owners.every(owner => owner === actorId)) options.push({ nodeId, routeId: route.id });
  }
  return options;
}
export function resolveElysiumScheme(position: MutablePosition, board: BoardDefinition, actorId: string, roundNumber: number, playerCount: number,
  choice: DeepReadonly<z.infer<typeof elysiumSchemeChoiceSchema>>, reject: Reject): void {
  const hasTarget = choice.nodeId !== undefined || choice.routeId !== undefined || choice.finalSlotId !== undefined;
  if (choice.costDecision === 'decline') {
    if (hasTarget) return reject('UNEXPECTED_MOVE', 'Declined cost cannot select movement or placement');
    return;
  }
  if (position.players[actorId]!.balances.iron < 3) return reject('CANNOT_PAY', 'Elysium requires three iron before free movement');
  position.players[actorId]!.balances.iron -= 3;
  const options = elysiumDestinations(position, board, actorId, roundNumber, playerCount);
  if (!options.length) {
    if (hasTarget) return reject('MOVE_TARGET', 'No Elysium destination can execute');
    return;
  }
  if (!options.some(option => option.nodeId === choice.nodeId && option.routeId === choice.routeId)) return reject('MOVE_TARGET', 'Select an adjacent explored node with own influence only and its single connecting route');
  // A legal target already has influence and is explored. No new event can be drawn here.
  const nodeId = choice.nodeId!, routeId = choice.routeId!;
  position.board.cityNodeByPlayer[actorId] = nodeId;
  clearOpposingCityMoveInfluence(position, board, actorId, routeId, nodeId);
  const slots = availableTargetInfluenceSlots(position, board, actorId, nodeId);
  if (slots.length) {
    if (!choice.finalSlotId || !slots.includes(choice.finalSlotId)) return reject('FINAL_SLOT', 'Complete free city movement by placing at the destination when possible');
    position.board.influenceBySlot[choice.finalSlotId] = { markerId: position.markerSupplyByPlayer[actorId]!.shift()!, ownerPlayerId: actorId };
  } else if (choice.finalSlotId !== undefined) return reject('FINAL_SLOT', 'Impossible final placement must skip without an extra target');
}

/** p13/p14: pay once, then replacement -> one own-marker movement -> any-marker removal, recalculating each step. */
export function resolveTexasScheme(position: MutablePosition, board: BoardDefinition, actorId: string,
  choice: DeepReadonly<z.infer<typeof texasSchemeChoiceSchema>>, reject: Reject): void {
  if (choice.costDecision === 'decline') {
    if (choice.replaceSlotId !== undefined || choice.move !== undefined || choice.removeSlotId !== undefined) return reject('UNEXPECTED_INFLUENCE', 'Declined cost has no influence choices');
    return;
  }
  // Same conditional 3-voucher cost and replacement primitive as Liskarm; charged exactly once.
  replaceLiskarmInfluence(position, board, actorId, 'pay', choice.replaceSlotId, reject);
  const sources = dispatchSourceSlots(position, board, actorId);
  if (sources.length) {
    if (!choice.move) return reject('MOVE_REQUIRED', 'An executable influence movement needs a source and target');
    if (!sources.includes(choice.move.sourceSlotId)) return reject('MOVE_SOURCE', 'Move an existing own board influence');
    if (!emptyInfluenceSlots(position, board, actorId).includes(choice.move.targetSlotId)) return reject('MOVE_TARGET', 'Move to a legal empty influence slot');
    position.board.influenceBySlot[choice.move.targetSlotId] = position.board.influenceBySlot[choice.move.sourceSlotId]!;
    position.board.influenceBySlot[choice.move.sourceSlotId] = null;
  } else if (choice.move !== undefined) return reject('UNEXPECTED_MOVE', 'No influence movement can execute at this step');
  const occupied = Object.entries(position.board.influenceBySlot).filter(([, marker]) => marker !== null).map(([slotId]) => slotId);
  if (occupied.length) {
    if (choice.removeSlotId === undefined) return reject('REMOVAL_REQUIRED', 'An executable removal needs a target');
    if (!occupied.includes(choice.removeSlotId)) return reject('REMOVAL_TARGET', 'Remove a currently existing influence');
    returnBoardInfluence(position, choice.removeSlotId);
  } else if (choice.removeSlotId !== undefined) return reject('REMOVAL_TARGET', 'No influence remains to remove');
}

/** Every player, including the user, sells ALL of the selected basic resource at 2; user then gains one victory point. */
export function resolveCannotScheme(position: MutablePosition, actorId: string,
  choice: DeepReadonly<z.infer<typeof cannotSchemeChoiceSchema>>, reject: Reject): void {
  for (const player of Object.values(position.players)) {
    const proceeds = player.balances[choice.asset] * 2, total = player.balances['columbia-voucher'] + proceeds;
    if (!Number.isSafeInteger(proceeds) || !Number.isSafeInteger(total)) return reject('BALANCE_OVERFLOW', 'Forced-sale income exceeds safe integer range');
    player.balances[choice.asset] = 0; player.balances['columbia-voucher'] = total;
  }
  const actor = position.players[actorId]!;
  if (!Number.isSafeInteger(actor.score + 1)) return reject('SCORE_OVERFLOW', 'Role point exceeds safe integer range');
  actor.score++;
}
