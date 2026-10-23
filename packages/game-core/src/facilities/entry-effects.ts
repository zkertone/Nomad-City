import { z } from 'zod';
import type { BoardDefinition } from '../board/types.js';
import { slotIdSchema } from '../board/schema.js';
import type { gamePositionSchema } from '../game/schema.js';
import { replaceBoardInfluence, returnBoardInfluence } from '../game/influence.js';
import { sellStandardResources } from '../game/resource-sales.js';
import type { ResourceSaleLine } from '../game/resource-sales.js';
import type { SupportedFacilityEntry } from './construction-spec.js';

const quantity = z.number().int().nonnegative().safe();
export const facilityEntryChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resource-allocation'), gains: z.strictObject({
    orirock: z.number().int().min(0).max(5), originium: z.number().int().min(0).max(5), iron: z.number().int().min(0).max(5),
  }) }).refine(value => value.gains.orirock + value.gains.originium + value.gains.iron === 5, 'Must allocate exactly five resources in total'),
  z.strictObject({ kind: z.literal('remove-influence'), slotIds: z.array(slotIdSchema).max(2) }),
  z.strictObject({ kind: z.literal('mercenary-influence'), effect: z.enum(['replace', 'remove']), slotId: slotIdSchema.optional() }),
  z.strictObject({ kind: z.literal('sell-resources'), amounts: z.strictObject({ orirock: quantity, originium: quantity, iron: quantity, 'pure-originium': quantity }) }),
]);
export function requiredFacilityEntryChoiceKind(entry: SupportedFacilityEntry) {
  switch (entry.kind) {
    case 'choose-five-resources': return 'resource-allocation';
    case 'remove-two-influence': return 'remove-influence';
    case 'replace-or-remove-influence': return 'mercenary-influence';
    case 'sell-resources': return 'sell-resources';
    default: return null;
  }
}
export interface FacilityEntryInfluenceChange {
  readonly kind: 'remove' | 'place'; readonly slotId: string; readonly markerId: string; readonly ownerPlayerId: string;
}
type MutablePosition = z.infer<typeof gamePositionSchema>;
type Choice = z.infer<typeof facilityEntryChoiceSchema>;
type Reject = (code: string, message: string) => never;
/** Internal synchronous effects only; the private construction transaction owns payment, cards and rollback. */
export function settleFacilityBoardOrSaleEntry(position: MutablePosition, board: BoardDefinition, actorId: string,
  choice: Exclude<Choice, { kind: 'resource-allocation' }>, reject: Reject) {
  const influenceChanges: FacilityEntryInfluenceChange[] = [], sales: ResourceSaleLine[] = [];
  let saleProceeds = 0;
  const recordRemoval = (slotId: string) => {
    const marker = position.board.influenceBySlot[slotId]!;
    influenceChanges.push({ kind: 'remove', slotId, markerId: marker.markerId, ownerPlayerId: marker.ownerPlayerId });
  };
  const remove = (slotId: string | undefined) => {
    const occupied = Object.entries(position.board.influenceBySlot).filter(([, marker]) => marker !== null).map(([id]) => id);
    if (!occupied.length) {
      if (slotId !== undefined) return reject('REMOVAL_TARGET', 'There is no board influence to remove');
      return;
    }
    if (slotId === undefined) return reject('REMOVAL_REQUIRED', 'Choose a target for every executable removal');
    if (!occupied.includes(slotId)) return reject('REMOVAL_TARGET', 'Remove an existing board influence, not supply or score markers');
    recordRemoval(slotId); returnBoardInfluence(position, slotId);
  };
  if (choice.kind === 'remove-influence') {
    for (let index = 0; index < 2; index++) remove(choice.slotIds[index]);
  } else if (choice.kind === 'mercenary-influence') {
    if (choice.effect === 'remove') remove(choice.slotId);
    else {
      const original = choice.slotId === undefined ? undefined : position.board.influenceBySlot[choice.slotId];
      replaceBoardInfluence(position, board, actorId, choice.slotId, reject);
      if (original) {
        influenceChanges.push({ kind: 'remove', slotId: choice.slotId!, markerId: original.markerId, ownerPlayerId: original.ownerPlayerId });
        const placed = position.board.influenceBySlot[choice.slotId!];
        if (placed) influenceChanges.push({ kind: 'place', slotId: choice.slotId!, markerId: placed.markerId, ownerPlayerId: placed.ownerPlayerId });
      }
    }
  } else {
    const sold = sellStandardResources(position, actorId, choice.amounts, reject);
    sales.push(...sold.sales); saleProceeds = sold.proceeds;
  }
  return { influenceChanges, sales, saleProceeds };
}
