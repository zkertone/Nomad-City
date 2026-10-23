import { z } from 'zod';
import { loadFoundersBoard } from '../board/index.js';
import { preparePhaseWindow } from './action-window.js';
import type { OpenPhaseWindowOptions } from './action-window.js';
import { gameEntityIdSchema, gameStateSchema, harvestPlanSchema } from './schema.js';
import { getFoundersMapSide, parseGameState } from './state.js';
import { harvestEligibleNodes, quoteHarvest, rejectHarvest } from './harvest-rules.js';
import type { GameDefinition, GameState, HarvestPlan } from './types.js';
export { HarvestError } from './harvest-rules.js';
export type OpenHarvestPhaseOptions = OpenPhaseWindowOptions;
export const harvestPlayerCommandSchema = z.strictObject({
  type: z.literal('set-harvest-plan'), gameId: gameEntityIdSchema,
  expectedVersion: z.number().int().nonnegative().safe(), plan: harvestPlanSchema,
});
export type HarvestPlayerCommand = z.infer<typeof harvestPlayerCommandSchema>;
export type HarvestQuote = ReturnType<typeof quoteHarvest>;
export interface HarvestActorContext { readonly authenticatedPlayerId: string }
/** Trusted phase grant after both action cycles. Full round scheduling remains external. */
export function openHarvestPhase(input: GameState, definition: GameDefinition, options: OpenHarvestPhaseOptions): GameState {
  const prepared = preparePhaseWindow(input, definition, options, rejectHarvest);
  return parseGameState({ ...prepared.position, ...prepared.facilityFields, ...prepared.roundFields, schemaVersion: prepared.previousFormat === '1.8.0' ? '1.8.0' : prepared.previousFormat === '1.7.0' ? '1.7.0' : prepared.previousFormat === '1.6.0' ? '1.6.0' : '1.5.0', stateVersion: prepared.stateVersion,
    phase: 'harvest', eventDecks: prepared.eventDecks, playerOrder: prepared.playerOrder,
    harvest: { roundNumber: prepared.options.roundNumber, status: 'planning',
      plansByPlayer: Object.fromEntries(definition.players.map(player => [player.id, null])) } }, definition);
}
function planning(input: GameState, definition: GameDefinition) {
  const state = parseGameState(input, definition);
  if (state.phase !== 'harvest' || state.harvest?.status !== 'planning') return rejectHarvest('HARVEST_STAGE', 'No harvest planning phase');
  return state;
}
export function getHarvestEligibleNodeIds(input: GameState, definition: GameDefinition, playerId: string): readonly string[] {
  const state = planning(input, definition);
  return Object.freeze(harvestEligibleNodes(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), playerId));
}
export function getHarvestQuote(input: GameState, definition: GameDefinition, playerId: string, plan: HarvestPlan): HarvestQuote {
  const state = planning(input, definition);
  return quoteHarvest(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), playerId, plan);
}
/** Planning leaves balances unchanged. Last plan debits EVERY payer before any recipient/gain credit. */
export function applyHarvestCommand(input: GameState, definition: GameDefinition, context: HarvestActorContext, payload: unknown): GameState {
  const state = parseGameState(input, definition);
  const parsed = harvestPlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return rejectHarvest('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== state.gameId) return rejectHarvest('GAME_REFERENCE', 'Wrong game');
  if (command.expectedVersion !== state.stateVersion) return rejectHarvest('STALE_VERSION', 'Expected state version is stale');
  planning(state, definition);
  const actorId = context.authenticatedPlayerId;
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  quoteHarvest(state, board, actorId, command.plan);
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return rejectHarvest('VERSION_OVERFLOW', 'State version exhausted');
  const next = gameStateSchema.parse(state);
  next.harvest!.plansByPlayer[actorId] = command.plan;
  if (Object.values(next.harvest!.plansByPlayer).every(plan => plan !== null)) {
    const quotes = definition.players.map(player => ({ playerId: player.id,
      quote: quoteHarvest(state, board, player.id, next.harvest!.plansByPlayer[player.id]!) }));
    // No payer may rely on incoming tolls in this simultaneous collection phase.
    for (const { playerId, quote } of quotes) next.players[playerId]!.balances['columbia-voucher'] -= quote.total;
    const credit = (playerId: string, asset: keyof GameState['players'][string]['balances'], amount: number): void => {
      const balances = next.players[playerId]!.balances;
      if (!Number.isSafeInteger(balances[asset] + amount)) return rejectHarvest('BALANCE_OVERFLOW', 'Resource balance exceeds safe integer range');
      balances[asset] += amount;
    };
    for (const { playerId, quote } of quotes) {
      for (const payment of quote.payments) if (payment.payeePlayerId) credit(payment.payeePlayerId, 'columbia-voucher', payment.amount);
      for (const asset of ['orirock', 'originium', 'iron', 'pure-originium'] as const) credit(playerId, asset, quote.gains[asset]);
    }
    next.harvest!.status = 'complete';
  }
  next.stateVersion++;
  return parseGameState(next, definition);
}
