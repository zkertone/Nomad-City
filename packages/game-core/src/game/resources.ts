import { resourceBalancesSchema, resourceCostSchema } from './schema.js';
import type { ResourceBalances, ResourceCost } from './types.js';

/** A resource arithmetic query, not permission to perform a game action. */
export function canAffordResources(balances: ResourceBalances, costs: readonly ResourceCost[]): boolean {
  const remaining = resourceBalancesSchema.parse(balances);
  for (const cost of resourceCostSchema.array().parse(costs)) {
    if (remaining[cost.asset] < cost.amount) return false;
    remaining[cost.asset] -= cost.amount;
  }
  return true;
}
