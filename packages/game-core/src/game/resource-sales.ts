import type { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import type { gamePositionSchema } from './schema.js';

/** Internal shared arithmetic for the printed 3/3/4/15 voluntary-sale table, not an action grant. */
export const STANDARD_RESOURCE_SALE_RATES = deepFreeze([
  ['orirock', 3], ['originium', 3], ['iron', 4], ['pure-originium', 15],
] as const);
type SaleAsset = 'orirock' | 'originium' | 'iron' | 'pure-originium';
export interface ResourceSaleLine { readonly asset: SaleAsset; readonly amount: number; readonly unitPrice: number; readonly proceeds: number }
/** Callers supply validated choices and a private transaction copy; all arithmetic is checked before changing it. */
export function sellStandardResources(position: z.infer<typeof gamePositionSchema>, actorId: string, amounts: Readonly<Record<SaleAsset, number>>,
  reject: (code: string, message: string) => never) {
  const actor = position.players[actorId]!, sales: ResourceSaleLine[] = []; let proceeds = 0;
  for (const [asset, rate] of STANDARD_RESOURCE_SALE_RATES) {
    const amount = amounts[asset];
    if (actor.balances[asset] < amount) return reject('INSUFFICIENT_RESOURCE', 'Cannot sell resources not owned at this step');
    const income = amount * rate;
    if (!Number.isSafeInteger(income) || !Number.isSafeInteger(proceeds + income)) return reject('BALANCE_OVERFLOW', 'Sale proceeds exceed safe integer range');
    proceeds += income;
    if (amount) sales.push({ asset, amount, unitPrice: rate, proceeds: income });
  }
  if (!Number.isSafeInteger(actor.balances['columbia-voucher'] + proceeds)) return reject('BALANCE_OVERFLOW', 'Sale balance exceeds safe integer range');
  for (const [asset] of STANDARD_RESOURCE_SALE_RATES) actor.balances[asset] -= amounts[asset];
  actor.balances['columbia-voucher'] += proceeds;
  return { proceeds, sales };
}
