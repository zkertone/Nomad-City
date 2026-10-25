import { z } from 'zod';
import { gameStateSchema } from './schema.js';
import { parseGameState } from './state.js';
import { createFoundersFacilitySupply } from '../facilities/supply.js';
import { isTemporarySettlementCard, TEMPORARY_SETTLEMENT_RULE } from '../facilities/temporary-settlement.js';
import type { ValidationIssue } from '../board/types.js';
import type { GameDefinition, GameState, DeepReadonly } from './types.js';

const optionsSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative().safe(), deckOrder: z.array(z.string().min(1)).length(44) });
export type EnableTemporarySettlementsOptions = DeepReadonly<z.infer<typeof optionsSchema>>;
export class TemporarySettlementError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TemporarySettlementError'; }
}
const reject = (code: string, message: string): never => { throw new TemporarySettlementError(code, message); };

/** Trusted fresh-game setup only. Never inject three cards into a running legacy game. */
export function enableTemporarySettlements(input: GameState, definition: GameDefinition, rawOptions: EnableTemporarySettlementsOptions): GameState {
  const state = parseGameState(input, definition), checked = optionsSchema.safeParse(rawOptions);
  if (!checked.success) return reject('OPTIONS_SCHEMA', checked.error.message);
  if (checked.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected version is stale');
  if (state.schemaVersion !== '1.15.0') return reject('TEMPORARY_FORMAT', 'Initialize from an explicit fresh 1.15.0 game exactly once');
  const flow = state.roundFlow!, supply = state.facilities!.supply;
  if (state.phase !== 'round-control' || flow.roundNumber !== 1 || flow.turnIndex !== 0 || flow.majorActionOpened
    || !['role-removal', 'role-placement'].includes(flow.stage) || flow.rolePlacementCount || flow.supplyRemovalCount
    || flow.rolesByPlayer.some(role => role.placed !== null || role.used !== null || role.discarded.length)
    || supply.revision !== 0 || supply.playerHoldings.some(holding => holding.cardIds.length !== 1)
    || state.facilities!.panels.some(panel => panel.revision !== 0 || panel.placements.length !== 1)
    || Object.values(state.cityPatterns!.exhaustedFacilityIdsByPlayer).some(ids => ids.length)
    || state.patternMarkers!.length || state.cityPatterns!.useTracks.length || state.cityPatternMajorActions!.length || state.cityPatternContinuation) {
    return reject('FRESH_GAME_REQUIRED', 'Choose project-base facilities before any role, supply or gameplay decision');
  }
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const nextSupply = createFoundersFacilitySupply({ gameId: state.gameId, playerIds: definition.players.map(p => p.id),
    deckOrder: checked.data.deckOrder, includeTemporarySettlements: true });
  return parseGameState({ ...state, schemaVersion: '1.16.0', stateVersion: state.stateVersion + 1,
    facilities: { ...state.facilities!, supply: nextSupply }, temporarySettlementReturns: [] }, definition);
}

type Mutable = z.infer<typeof gameStateSchema>;
/** A choice on this declaration only; it cannot become a later general sell action. */
export function returnTemporarySettlements(next: Mutable, actorId: string, usedIds: readonly string[], selected: readonly string[], fail: (code: string, message: string) => never): void {
  if (!selected.length) return;
  if (next.schemaVersion !== '1.16.0') return fail('TEMPORARY_FORMAT', 'Returning a temporary settlement requires explicit format 1.16.0');
  if (new Set(selected).size !== selected.length || selected.some(id => !usedIds.includes(id) || !isTemporarySettlementCard(id))) return fail('TEMPORARY_RETURN_CHOICE', 'Return only distinct temporary cards used in this exact declaration');
  const facilities = next.facilities!, panel = facilities.panels.find(p => p.playerId === actorId)!, supply = facilities.supply;
  const holding = supply.playerHoldings.find(p => p.playerId === actorId)!;
  if (selected.some(id => !holding.cardIds.includes(id) || !panel.placements.some(p => p.cardId === id))) return fail('TEMPORARY_RETURN_CHOICE', 'Only your actual placed cards can be returned');
  if (supply.revision === Number.MAX_SAFE_INTEGER || panel.revision === Number.MAX_SAFE_INTEGER) return fail('VERSION_OVERFLOW', 'Facility version exhausted');
  const amount = TEMPORARY_SETTLEMENT_RULE.rewardVouchers * selected.length, balances = next.players[actorId]!.balances;
  if (!Number.isSafeInteger(balances['columbia-voucher'] + amount)) return fail('BALANCE_OVERFLOW', 'Temporary settlement reward exceeds safe integer range');
  balances['columbia-voucher'] += amount;
  holding.cardIds = holding.cardIds.filter(id => !selected.includes(id));
  panel.placements = panel.placements.filter(p => !selected.includes(p.cardId));
  supply.returnedToBox.push(...selected); supply.revision++; panel.revision++;
  next.temporarySettlementReturns!.push(...selected.map(cardId => ({ playerId: actorId, cardId })));
}

export function temporarySettlementIssues(state: GameState, definition: GameDefinition): ValidationIssue[] {
  if (!['1.16.0', '1.17.0'].includes(state.schemaVersion)) return [];
  const issues: ValidationIssue[] = [], records = state.temporarySettlementReturns!;
  const report = (message: string) => issues.push({ code: 'TEMPORARY_SETTLEMENT_STATE', path: 'temporarySettlementReturns', message });
  if (new Set(records.map(r => r.cardId)).size !== records.length) report('Each physical temporary facility can be returned only once');
  for (const record of records) {
    if (!definition.players.some(p => p.id === record.playerId) || !isTemporarySettlementCard(record.cardId)
      || !state.facilities!.supply.returnedToBox.includes(record.cardId)
      || !state.cityPatterns!.exhaustedFacilityIdsByPlayer[record.playerId]?.includes(record.cardId)) report('Each return requires its real box card and the declaring player exhaustion history');
  }
  for (const [playerId, ids] of Object.entries(state.cityPatterns!.exhaustedFacilityIdsByPlayer)) {
    for (const cardId of ids) if (isTemporarySettlementCard(cardId) && state.facilities!.supply.returnedToBox.includes(cardId)
      && !records.some(r => r.cardId === cardId && r.playerId === playerId)) report('Returned exhausted facility needs its exact declaring owner');
  }
  return issues;
}
