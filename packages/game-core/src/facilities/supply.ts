import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import type { DeepReadonly } from '../game/types.js';
import { FOUNDERS_FACILITY_STOCK, FOUNDERS_FACILITY_STOCK_HASH } from './stock.js';
import type { FacilityModuleValidation, FacilityPhysicalCard } from './stock.js';

const identifier = z.string().min(1).refine(value => value.trim().length > 0, 'Blank identifier');
const cardIds = z.array(identifier).max(48);
export const facilitySupplyStateSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'), gameId: identifier,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  stockRef: z.strictObject({ definitionId: z.literal('founders-base-facility-stock'), definitionVersion: z.literal('1.0.0'), contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  drawPile: cardIds.max(41), supply: cardIds.max(6), extensionReserve: cardIds.max(3), unusedCoreTowers: cardIds.max(2), returnedToBox: cardIds.max(41),
  playerHoldings: z.array(z.strictObject({ playerId: identifier, cardIds })).min(2).max(4),
});
export type FacilitySupplyState = DeepReadonly<z.infer<typeof facilitySupplyStateSchema>>;

/** Physical zones only. This is not a construction/ownership/geometry legality validator. */
export function validateFacilitySupplyState(input: unknown): FacilityModuleValidation<FacilitySupplyState> {
  const parsed = facilitySupplyStateSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const state = parsed.data, issues: string[] = [];
  if (state.stockRef.contentHash !== FOUNDERS_FACILITY_STOCK_HASH) issues.push('Wrong facility stock reference');
  const cards = new Map(FOUNDERS_FACILITY_STOCK.cards.map(card => [card.id, card]));
  const used = new Set<string>();
  const checkZone = (path: string, ids: readonly string[], allowed?: FacilityPhysicalCard['group']): void => {
    for (const id of ids) {
      if (used.has(id)) issues.push(`Physical card in multiple locations: ${id}`);
      used.add(id);
      const card = cards.get(id);
      if (!card) issues.push(`Unknown physical card: ${id}`);
      else if (allowed && card.group !== allowed) issues.push(`Wrong card group in ${path}: ${id}`);
    }
  };
  checkZone('drawPile', state.drawPile, 'ordinary'); checkZone('supply', state.supply, 'ordinary');
  checkZone('extensionReserve', state.extensionReserve, 'extension-hub'); checkZone('unusedCoreTowers', state.unusedCoreTowers, 'core-command-tower');
  checkZone('returnedToBox', state.returnedToBox, 'ordinary');
  const players = new Set<string>();
  for (const holding of state.playerHoldings) {
    if (players.has(holding.playerId)) issues.push(`Duplicate player: ${holding.playerId}`);
    players.add(holding.playerId);
    checkZone(`playerHoldings:${holding.playerId}`, holding.cardIds);
    if (holding.cardIds.filter(id => cards.get(id)?.group === 'core-command-tower').length !== 1) issues.push(`Player needs exactly one core tower: ${holding.playerId}`);
  }
  for (const card of FOUNDERS_FACILITY_STOCK.cards) if (!used.has(card.id)) issues.push(`Missing physical card: ${card.id}`);
  return issues.length ? { success: false, issues } : { success: true, data: deepFreeze(state) };
}
export function parseFacilitySupplyState(input: unknown): FacilitySupplyState {
  const result = validateFacilitySupplyState(input);
  if (!result.success) throw new Error(`Invalid facility supply: ${result.issues.join('; ')}`);
  return result.data;
}
const supplySetupSchema = z.strictObject({ gameId: identifier, playerIds: z.array(identifier).min(2).max(4), deckOrder: z.array(identifier).length(41) });
/** Server injects an unbiased random-below source (e.g. node:crypto.randomInt); deterministic sources are for replay/tests. */
export function shuffleFoundersFacilityDeck(randomBelow: (upperExclusive: number) => number): readonly string[] {
  const ids = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary').map(card => card.id);
  for (let index = ids.length - 1; index > 0; index--) {
    const target = randomBelow(index + 1);
    if (!Number.isSafeInteger(target) || target < 0 || target > index) throw new RangeError('Invalid facility shuffle random index');
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  }
  return deepFreeze(ids);
}
/** Trusted server setup: deckOrder is a complete server-shuffled permutation; never accept a player's chosen order. */
export function createFoundersFacilitySupply(input: {
  readonly gameId: string; readonly playerIds: readonly string[]; readonly deckOrder: readonly string[];
}): FacilitySupplyState {
  const setup = supplySetupSchema.parse(input);
  if (new Set(setup.playerIds).size !== setup.playerIds.length) throw new Error('Duplicate setup player');
  const ordinary = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'ordinary');
  const expected = new Set(ordinary.map(card => card.id));
  if (new Set(setup.deckOrder).size !== 41 || setup.deckOrder.some(id => !expected.has(id))) throw new Error('Facility deckOrder must be a permutation of all 41 ordinary cards');
  const cores = FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'core-command-tower');
  return parseFacilitySupplyState({
    schemaVersion: '1.0.0', gameId: setup.gameId, revision: 0,
    stockRef: { definitionId: FOUNDERS_FACILITY_STOCK.definitionId, definitionVersion: FOUNDERS_FACILITY_STOCK.definitionVersion, contentHash: FOUNDERS_FACILITY_STOCK_HASH },
    supply: setup.deckOrder.slice(0, 6), drawPile: setup.deckOrder.slice(6),
    extensionReserve: FOUNDERS_FACILITY_STOCK.cards.filter(card => card.group === 'extension-hub').map(card => card.id),
    unusedCoreTowers: cores.slice(setup.playerIds.length).map(card => card.id), returnedToBox: [],
    playerHoldings: setup.playerIds.map((playerId, index) => ({ playerId, cardIds: [cores[index]!.id] })),
  });
}
export type FacilitySupplyRefillResult =
  | { readonly status: 'unchanged'; readonly state: FacilitySupplyState }
  | { readonly status: 'replenished'; readonly state: FacilitySupplyState; readonly drawnCardIds: readonly string[] }
  | { readonly status: 'insufficient-cards'; readonly state: FacilitySupplyState; readonly required: number; readonly available: number };
/** Internal p07 refill primitive: no taking cards, construction, payment or player-command authorization. */
export function replenishFacilitySupply(input: unknown, expectedRevision: number): FacilitySupplyRefillResult {
  const state = parseFacilitySupplyState(input);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || state.revision !== expectedRevision) throw new Error('Stale or invalid facility supply revision');
  const required = 6 - state.supply.length;
  if (required === 0) return deepFreeze({ status: 'unchanged', state });
  // The supplied rules do not specify an exhausted-pile fallback. Report the unsupported condition without inventing one.
  if (state.drawPile.length < required) return deepFreeze({ status: 'insufficient-cards', state, required, available: state.drawPile.length });
  if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('Facility supply revision overflow');
  const drawnCardIds = state.drawPile.slice(0, required);
  const next = parseFacilitySupplyState({ ...state, revision: state.revision + 1,
    supply: [...state.supply, ...drawnCardIds], drawPile: state.drawPile.slice(required) });
  return deepFreeze({ status: 'replenished', state: next, drawnCardIds });
}
/** Explicit allowlist: hidden draw order never appears in the public projection. */
export function getFacilitySupplyPublicView(input: unknown) {
  const state = parseFacilitySupplyState(input);
  return deepFreeze({ schemaVersion: state.schemaVersion, gameId: state.gameId, revision: state.revision, stockRef: state.stockRef,
    supply: state.supply, extensionReserve: state.extensionReserve, unusedCoreTowers: state.unusedCoreTowers,
    playerHoldings: state.playerHoldings, returnedToBox: state.returnedToBox, drawPileCount: state.drawPile.length });
}
