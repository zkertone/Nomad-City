import { z } from 'zod';
import { loadFoundersBoard } from '../board/index.js';
import { deepFreeze } from '../board/hash.js';
import { gameEntityIdSchema, gamePositionSchema } from '../game/schema.js';
import { validateGameDefinition, validateGamePosition, parseGamePosition, getFoundersMapSide } from '../game/state.js';
import { canAffordResources } from '../game/resources.js';
import type { DeepReadonly, GameDefinition, ResourceCost } from '../game/types.js';
import { facilitySupplyStateSchema, validateFacilitySupplyState, replenishFacilitySupply } from './supply.js';
import { facilityPanelStateSchema, validateFacilityPanelSet, previewFacilityPanelPlacement, getOrthogonallyAdjacentPanelFacilities } from './panel-state.js';
import { FOUNDERS_FACILITY_PANEL } from './panel-definition.js';
import { getFacilityPhysicalCard } from './stock.js';
import type { FacilityModuleValidation } from './stock.js';
import { getFacilityExecutionFace } from './faces.js';
import { facilityEntryChoiceSchema, requiredFacilityEntryChoiceKind, settleFacilityBoardOrSaleEntry } from './entry-effects.js';
import type { FacilityEntryInfluenceChange } from './entry-effects.js';
import type { ResourceSaleLine } from '../game/resource-sales.js';
import { getFacilityConstructionSpec, rejectFacilityConstruction as reject } from './construction-spec.js';

/** Internal transaction bundle, not a new GameState format or a second balance ledger. */
export const facilityConstructionPositionSchema = z.strictObject({
  position: gamePositionSchema, supply: facilitySupplyStateSchema, panels: z.array(facilityPanelStateSchema).min(2).max(4),
});
export type FacilityConstructionPosition = DeepReadonly<z.infer<typeof facilityConstructionPositionSchema>>;
export function validateFacilityConstructionPosition(input: unknown, inputDefinition: GameDefinition): FacilityModuleValidation<FacilityConstructionPosition> {
  const checkedDefinition = validateGameDefinition(inputDefinition);
  if (!checkedDefinition.success) return { success: false, issues: checkedDefinition.issues.map(issue => `definition: ${issue.message}`) };
  const definition = checkedDefinition.data;
  const parsed = facilityConstructionPositionSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const state = parsed.data, issues: string[] = [];
  const position = validateGamePosition(state.position, definition), supply = validateFacilitySupplyState(state.supply), panels = validateFacilityPanelSet(state.panels, state.supply);
  if (!position.success) issues.push(...position.issues.map(issue => `position: ${issue.message}`));
  if (!supply.success) issues.push(...supply.issues);
  if (!panels.success) issues.push(...panels.issues);
  if (state.supply.gameId !== state.position.gameId) issues.push('Facility/game position mismatch');
  if (JSON.stringify(state.supply.playerHoldings.map(row => row.playerId).sort()) !== JSON.stringify(definition.players.map(row => row.id).sort())) issues.push('Facility players must exactly match the game');
  if (supply.success) for (const holding of state.supply.playerHoldings) {
    const definitions = holding.cardIds.map(getFacilityPhysicalCard);
    for (const card of definitions) {
      const face = getFacilityExecutionFace(card.facilityId);
      if (face.effect.uniqueMarker && definitions.filter(other => other.facilityId === card.facilityId).length > 1) issues.push(`Duplicate unique facility: ${card.facilityId}`);
    }
  }
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(state) };
}
export function parseFacilityConstructionPosition(input: unknown, definition: GameDefinition): FacilityConstructionPosition {
  const result = validateFacilityConstructionPosition(input, definition);
  if (!result.success) return reject('POSITION_INVALID', result.issues.join('; '));
  return result.data;
}
/** Trusted caller grants ONE ordinary, base-price construction; never derive this context from player payloads. */
export const facilityConstructionContextSchema = z.strictObject({
  gameId: gameEntityIdSchema, actorId: gameEntityIdSchema,
  expectedSupplyRevision: z.number().int().nonnegative().safe(), expectedPanelRevision: z.number().int().nonnegative().safe(),
  source: z.enum(['supply', 'draw-pile']).optional(),
});
export type FacilityConstructionContext = DeepReadonly<z.infer<typeof facilityConstructionContextSchema>>;
export const facilityConstructionCommandSchema = z.strictObject({
  cardId: z.string().min(1), cellId: z.string().min(1), paymentMode: z.enum(['resources', 'vouchers']), entryChoice: facilityEntryChoiceSchema.optional(),
});
export type FacilityConstructionCommand = DeepReadonly<z.infer<typeof facilityConstructionCommandSchema>>;

function prepare(input: unknown, definition: GameDefinition, rawContext: FacilityConstructionContext, payload: unknown) {
  const state = parseFacilityConstructionPosition(input, definition);
  const contextResult = facilityConstructionContextSchema.safeParse(rawContext), commandResult = facilityConstructionCommandSchema.safeParse(payload);
  if (!contextResult.success) return reject('CONTEXT_SCHEMA', contextResult.error.message);
  if (!commandResult.success) return reject('COMMAND_SCHEMA', commandResult.error.message);
  const context = contextResult.data, command = commandResult.data;
  if (context.gameId !== state.position.gameId) return reject('GAME_REFERENCE', 'Wrong construction game');
  const panel = state.panels.find(row => row.playerId === context.actorId);
  if (!panel) return reject('ACTOR_REFERENCE', 'Unknown granted actor');
  const checkedPreview = previewFacilityPanelPlacement(panel, state.supply, {
    actorId: context.actorId, expectedSupplyRevision: context.expectedSupplyRevision, expectedPanelRevision: context.expectedPanelRevision,
    cardId: command.cardId, cellId: command.cellId,
    ...(context.source ? { source: context.source } : {}),
  });
  if (checkedPreview.status !== 'position-available') return reject('PLACEMENT_INVALID', checkedPreview.issues.join('; '));
  if (checkedPreview.source !== (context.source ?? 'supply')) return reject('CARD_SOURCE', 'Construction needs its granted physical source');
  if (state.supply.supply.length !== 6) return reject('SUPPLY_NOT_READY', 'Finish the prior immediate refill first');
  if (context.source !== 'draw-pile' && !state.supply.drawPile.length) return reject('REFILL_RULE_UNRESOLVED', 'Cannot resolve immediate refill with an exhausted draw pile');
  if (panel.revision === Number.MAX_SAFE_INTEGER || state.supply.revision === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'Facility version exhausted');
  const spec = getFacilityConstructionSpec(command.cardId);
  if (spec.face.effect.uniqueMarker && panel.placements.some(row => getFacilityPhysicalCard(row.cardId).facilityId === spec.card.facilityId)) return reject('UNIQUE_FACILITY', 'Player already owns this unique facility');
  const colors = new Set(panel.placements.map(row => getFacilityPhysicalCard(row.cardId).color).filter(color => color !== 'rainbow'));
  // The industrial card discounts its own orirock component before it is placed, not all future construction or the voucher alternative.
  const orirockDiscount = spec.card.facilityId === 'FAC-009' && command.paymentMode === 'resources' ? colors.size : 0;
  const costs: ResourceCost[] = [];
  const addCost = (asset: ResourceCost['asset'], amount: number) => { if (amount > 0) costs.push({ asset, amount }); };
  if (command.paymentMode === 'vouchers') addCost('columbia-voucher', spec.printedCost.voucherPayment);
  else {
    const price = spec.printedCost.resourcePayment;
    addCost('orirock', Math.max(0, price.orirock - orirockDiscount)); addCost('originium', price.originium); addCost('iron', price.iron);
    addCost('pure-originium', price.pureOriginium); addCost('columbia-voucher', price.vouchers);
  }
  return { state, context, command, panel, spec, costs, orirockDiscount };
}
export function getFacilityConstructionQuote(input: unknown, definition: GameDefinition, context: FacilityConstructionContext, payload: unknown) {
  const prepared = prepare(input, definition, context, payload);
  return deepFreeze({ actorId: prepared.context.actorId, cardId: prepared.command.cardId, cellId: prepared.command.cellId,
    facilityId: prepared.spec.card.facilityId, costs: prepared.costs, orirockDiscount: prepared.orirockDiscount,
    entryChoiceKind: requiredFacilityEntryChoiceKind(prepared.spec.entry),
    printedPoints: prepared.spec.face.printedScore, requiresResourceAllocation: prepared.spec.entry.kind === 'choose-five-resources',
    canPay: canAffordResources(prepared.state.position.players[prepared.context.actorId]!.balances, prepared.costs) });
}
export interface FacilityConstructionReceipt {
  readonly actorId: string; readonly cardId: string; readonly facilityId: string; readonly cellId: string;
  readonly paymentMode: 'resources' | 'vouchers'; readonly paid: readonly ResourceCost[]; readonly orirockDiscount: number;
  readonly entryStatus: 'pending' | 'complete';
  readonly points: number; readonly refilledCardIds: readonly string[];
  readonly entryInfluenceChanges: readonly FacilityEntryInfluenceChange[]; readonly entrySales: readonly ResourceSaleLine[];
  readonly entryGains: readonly { readonly asset: ResourceCost['asset']; readonly amount: number }[];
  readonly order: readonly ['pay', 'take-and-refill' | 'take-from-deck', 'place', 'score', 'entry'];
}
export interface FacilityConstructionResult { readonly state: FacilityConstructionPosition; readonly receipt: FacilityConstructionReceipt }
/**
 * Atomic INTERNAL settlement. The future action owner must grant/consume the action once and CAS its outer GameState version.
 * Unsupported effects fail before publishing any costs, placement, score or refill changes.
 */
export interface FacilityConstructionStartResult extends FacilityConstructionResult { readonly pendingEntry: 'warehouse-exploration' | 'warehouse-choice' | 'facility-entry' | null }
export function beginFacilityConstruction(input: unknown, definition: GameDefinition, context: FacilityConstructionContext, payload: unknown): FacilityConstructionStartResult {
  const p = prepare(input, definition, context, payload);
  const choiceKind = requiredFacilityEntryChoiceKind(p.spec.entry);
  if (p.command.entryChoice?.kind !== 'deferred-entry' && (choiceKind === 'warehouse' ? !['warehouse-entry', 'warehouse-influence', 'warehouse-explore'].includes(p.command.entryChoice?.kind ?? '') : choiceKind === null ? p.command.entryChoice !== undefined : p.command.entryChoice?.kind !== choiceKind)) return reject('ENTRY_CHOICE', 'Provide exactly the choice kind required by this facility entry');
  if (!canAffordResources(p.state.position.players[p.context.actorId]!.balances, p.costs)) return reject('CANNOT_PAY', 'All construction costs must be payable before entry rewards');
  const next = facilityConstructionPositionSchema.parse(p.state), actor = next.position.players[p.context.actorId]!;
  for (const cost of p.costs) actor.balances[cost.asset] -= cost.amount;
  const source = p.context.source === 'draw-pile' ? next.supply.drawPile : next.supply.supply;
  source.splice(source.indexOf(p.command.cardId), 1);
  next.supply.playerHoldings.find(row => row.playerId === p.context.actorId)!.cardIds.push(p.command.cardId);
  let refilledCardIds: readonly string[] = [];
  if (p.context.source === 'draw-pile') next.supply.revision++;
  else {
    const refill = replenishFacilitySupply(next.supply, p.context.expectedSupplyRevision);
    if (refill.status !== 'replenished') return reject('REFILL_RULE_UNRESOLVED', 'Immediate refill did not finish');
    next.supply = facilitySupplyStateSchema.parse(refill.state); refilledCardIds = refill.drawnCardIds;
  }
  const panel = next.panels.find(row => row.playerId === p.context.actorId)!;
  panel.placements.push({ cardId: p.command.cardId, cellId: p.command.cellId }); panel.revision++;
  if (!Number.isSafeInteger(actor.score + p.spec.face.printedScore)) return reject('SCORE_OVERFLOW', 'Construction score exceeds safe integer range');
  actor.score += p.spec.face.printedScore;
  const entryInfluenceChanges: FacilityEntryInfluenceChange[] = [], entrySales: ResourceSaleLine[] = [];
  const entryGains: { asset: ResourceCost['asset']; amount: number }[] = [];
  const gain = (asset: ResourceCost['asset'], amount: number) => {
    if (!Number.isSafeInteger(actor.balances[asset] + amount)) return reject('BALANCE_OVERFLOW', 'Entry gain exceeds safe integer range');
    actor.balances[asset] += amount; if (amount) entryGains.push({ asset, amount });
  };
  let pendingEntry: 'warehouse-exploration' | 'warehouse-choice' | 'facility-entry' | null = null;
  if (p.command.entryChoice?.kind === 'deferred-entry') pendingEntry = 'facility-entry';
  else switch (p.spec.entry.kind) {
    case 'logistics': case 'free-city-move': case 'copy-entry': case 'starting-player': case 'extra-construction': pendingEntry = 'facility-entry'; break;
    case 'none': break;
    case 'gain': gain(p.spec.entry.asset, p.spec.entry.amount); break;
    case 'core-neighbor-vouchers': gain('columbia-voucher', getOrthogonallyAdjacentPanelFacilities(panel, next.supply, FOUNDERS_FACILITY_PANEL.initialCoreCellId).length * 4); break;
    case 'choose-five-resources': {
      const choice = p.command.entryChoice!;
      if (choice.kind !== 'resource-allocation') return reject('ENTRY_CHOICE', 'Expected mining allocation');
      for (const asset of ['orirock', 'originium', 'iron'] as const) gain(asset, choice.gains[asset]);
      break;
    }
    case 'warehouse': case 'remove-two-influence': case 'replace-or-remove-influence': case 'sell-resources': {
      const choice = p.command.entryChoice!;
      if (choice.kind === 'warehouse-entry') { pendingEntry = 'warehouse-choice'; break; }
      if (choice.kind === 'warehouse-explore') { pendingEntry = 'warehouse-exploration'; break; }
      if (choice.kind === 'resource-allocation') return reject('ENTRY_CHOICE', 'Wrong immediate entry choice');
      const entry = settleFacilityBoardOrSaleEntry(next.position, loadFoundersBoard(getFoundersMapSide(definition.players.length)), p.context.actorId, choice, reject);
      entryInfluenceChanges.push(...entry.influenceChanges); entrySales.push(...entry.sales);
      if (entry.saleProceeds) entryGains.push({ asset: 'columbia-voucher', amount: entry.saleProceeds });
      break;
    }
  }
  next.position = gamePositionSchema.parse(parseGamePosition(next.position, definition));
  return deepFreeze({ pendingEntry, state: parseFacilityConstructionPosition(next, definition), receipt: {
    actorId: p.context.actorId, cardId: p.command.cardId, facilityId: p.spec.card.facilityId, cellId: p.command.cellId,
    entryStatus: pendingEntry ? 'pending' : 'complete', paymentMode: p.command.paymentMode, paid: p.costs, orirockDiscount: p.orirockDiscount, points: p.spec.face.printedScore,
    refilledCardIds, entryGains, entryInfluenceChanges, entrySales, order: ['pay', p.context.source === 'draw-pile' ? 'take-from-deck' : 'take-and-refill', 'place', 'score', 'entry'],
  } });
}

/** Complete synchronous settlement only: callers cannot mistake a nested exploration for an executed entry. */
export function settleFacilityConstruction(input: unknown, definition: GameDefinition, context: FacilityConstructionContext, payload: unknown): FacilityConstructionResult {
  const result = beginFacilityConstruction(input, definition, context, payload);
  if (result.pendingEntry) return reject('ENTRY_REQUIRES_CONTINUATION', 'Nested entry needs the authoritative resumable construction owner');
  return deepFreeze({ state: result.state, receipt: result.receipt });
}
