import { deepFreeze } from '../board/hash.js';
import type { BoardDefinition } from '../board/types.js';
import { harvestPlanSchema } from './schema.js';
import { quoteRouteTolls } from './route-tolls.js';
import type { GamePosition, HarvestPlan } from './types.js';

export class HarvestError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'HarvestError'; }
}
export const rejectHarvest = (code: string, message: string): never => { throw new HarvestError(code, message); };
export function harvestEligibleNodes(position: GamePosition, board: BoardDefinition, playerId: string): string[] {
  if (!Object.hasOwn(position.players, playerId)) return [];
  return Object.values(board.resourceNodes).filter(node => position.board.resourceMarkerByNode[node.id] &&
    (position.board.cityNodeByPlayer[playerId] === node.id || node.influenceSlotIds.some(id => position.board.influenceBySlot[id]?.ownerPlayerId === playerId)))
    .map(node => node.id);
}
/** Uses one unchanged planning position; never reads proceeds from another harvest plan. */
export function quoteHarvest(position: GamePosition, board: BoardDefinition, playerId: string, rawPlan: HarvestPlan, checkFunds = true) {
  if (!Object.hasOwn(position.players, playerId)) return rejectHarvest('WRONG_ACTOR', 'Unknown player');
  const parsed = harvestPlanSchema.safeParse(rawPlan);
  if (!parsed.success) return rejectHarvest('PLAN_SCHEMA', parsed.error.message);
  const plan = parsed.data;
  if (new Set(plan.nodeIds).size !== plan.nodeIds.length) return rejectHarvest('DUPLICATE_TARGET', 'Each resource node can be harvested only once');
  const eligible = harvestEligibleNodes(position, board, playerId);
  if (plan.nodeIds.some(id => !eligible.includes(id))) return rejectHarvest('HARVEST_TARGET', 'Choose revealed nodes with your city or influence');
  const routeIds = [...new Set(plan.routeIds)];
  if (routeIds.some(id => !Object.hasOwn(board.routes, id))) return rejectHarvest('ROUTE_REFERENCE', 'Unknown route');
  if (!plan.nodeIds.length && routeIds.length) return rejectHarvest('EMPTY_PLAN', 'An empty harvest has no connecting routes');
  const reached = new Set<string>([position.board.cityNodeByPlayer[playerId]!]);
  const remaining = new Set(routeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of remaining) {
      const nodes = board.routes[id]!.incidentNodeIds;
      if (nodes.some(node => reached.has(node))) {
        nodes.forEach(node => reached.add(node)); remaining.delete(id); changed = true;
      }
    }
  }
  if (remaining.size || plan.nodeIds.some(id => !reached.has(id))) return rejectHarvest('HARVEST_CONNECTION', 'Selected network must connect all targets and routes to the actual city');
  const tolls = quoteRouteTolls(position, board, playerId, routeIds);
  const recipients = new Map<string, string>();
  for (const recipient of plan.tollRecipients ?? []) {
    if (recipients.has(recipient.routeId)) return rejectHarvest('TOLL_RECIPIENT', 'Choose a recipient at most once per route');
    const leg = tolls.legs.find(leg => leg.routeId === recipient.routeId);
    if (!leg || !leg.recipientPlayerIds.includes(recipient.payeePlayerId)) return rejectHarvest('TOLL_RECIPIENT', 'Recipient must own influence on a payable selected route');
    recipients.set(recipient.routeId, recipient.payeePlayerId);
  }
  const payments = tolls.legs.map(leg => {
    const payeePlayerId = recipients.get(leg.routeId) ?? (leg.recipientPlayerIds.length === 1 ? leg.recipientPlayerIds[0]! : null);
    if (leg.recipientPlayerIds.length > 1 && !payeePlayerId) return rejectHarvest('TOLL_RECIPIENT', 'Choose one opposing owner for a shared route');
    return { routeId: leg.routeId, amount: leg.amount, payeePlayerId };
  });
  if (checkFunds && position.players[playerId]!.balances['columbia-voucher'] < tolls.total) return rejectHarvest('INSUFFICIENT_VOUCHERS', 'Pay the whole plan from vouchers held before harvest settlement');
  const gains = { orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 };
  for (const nodeId of plan.nodeIds) {
    const marker = position.board.resourceMarkerByNode[nodeId]!;
    gains[marker.resourceKind] += marker.harvestAmount;
  }
  return deepFreeze({ total: tolls.total, legs: tolls.legs, payments, gains });
}
