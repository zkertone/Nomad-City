import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { gameEntityIdSchema } from './schema.js';
import { getGamePosition, parseGameState } from './state.js';
import { eligibleBaseEventIds } from './exploration-rules.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

// Shared action preparation and managed scheduling gate; not a player endpoint.
const phaseOptionsSchema = z.strictObject({
  roundNumber: z.number().int().min(1).max(8),
  expectedVersion: z.number().int().nonnegative().safe(),
  deckOrder: z.strictObject({
    yellow: z.array(z.string().regex(/^Y\d{2}$/)).max(10),
    red: z.array(z.string().regex(/^R\d{2}$/)).max(6),
  }).optional(),
});
export const actionWindowOptionsSchema = phaseOptionsSchema.extend({ actorId: gameEntityIdSchema });
export type OpenPhaseWindowOptions = DeepReadonly<z.infer<typeof phaseOptionsSchema>>;
export type OpenActionWindowOptions = DeepReadonly<z.infer<typeof actionWindowOptionsSchema>>;
type Reject = (code: string, message: string) => never;
function shuffle(ids: string[]): string[] {
  for (let i = ids.length - 1; i > 0; i--) { const j = randomInt(i + 1); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  return ids;
}
const sameIds = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function preparePhaseWindow(input: GameState, definition: GameDefinition, rawOptions: OpenPhaseWindowOptions, reject: Reject, actorId?: string) {
  const state = parseGameState(input, definition);
  const parsed = phaseOptionsSchema.safeParse(rawOptions);
  if (!parsed.success) return reject('WINDOW_SCHEMA', parsed.error.message);
  const options = parsed.data;
  if (options.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const flow = state.roundFlow;
  if (flow) {
    if (options.deckOrder !== undefined || options.roundNumber !== flow.roundNumber) return reject('ROUND_WINDOW', 'Managed round cannot reset decks or choose a different round');
    if (state.phase !== 'round-control') return reject('ROUND_WINDOW', 'Finish the active action and explicitly end its turn first');
    if (actorId === undefined ? flow.stage !== 'harvest' : flow.stage !== 'player-actions' || flow.majorActionOpened || state.playerOrder![flow.turnIndex % definition.players.length] !== actorId) {
      return reject('ROUND_WINDOW', 'Only the scheduled actor/action or scheduled harvest can open');
    }
    if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
    return { position: getGamePosition(state, definition), eventDecks: state.eventDecks!, playerOrder: state.playerOrder!,
      stateVersion: state.stateVersion + 1, options, previousFormat: state.schemaVersion,
      facilityFields: { facilities: state.facilities! }, roundFields: { roundFlow: { ...flow, majorActionOpened: actorId !== undefined } } };
  }
  const initializing = state.phase === 'entry';
  const previous = state.phase === 'exploration' ? state.exploration : state.phase === 'city-move' ? state.cityMove : state.phase === 'influence-action' ? state.influenceAction : state.phase === 'construction' ? state.construction : state.harvest;
  if (initializing ? state.entry?.status !== 'complete' : previous?.status !== 'complete') {
    return reject('ACTION_PENDING', 'Finish entry or the existing action before granting another');
  }
  if (!initializing && (options.deckOrder !== undefined || options.roundNumber < previous!.roundNumber || (state.phase === 'harvest' && options.roundNumber === previous!.roundNumber))) {
    return reject('WINDOW_RESET', 'Cannot reset decks or move the round backwards');
  }
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  let decks = state.eventDecks;
  if (initializing) {
    const yellow = options.deckOrder?.yellow ?? shuffle(eligibleBaseEventIds(definition.players.length, 'yellow'));
    const red = options.deckOrder?.red ?? shuffle(eligibleBaseEventIds(definition.players.length, 'red'));
    if (!sameIds(yellow, eligibleBaseEventIds(definition.players.length, 'yellow')) || !sameIds(red, eligibleBaseEventIds(definition.players.length, 'red'))) {
      return reject('EVENT_DECK', 'Initial decks must be exact eligible-card permutations');
    }
    decks = { green: state.entry!.remainingGreenEventIds, yellow, red };
  }
  return { position: getGamePosition(state, definition), eventDecks: decks!, playerOrder: initializing ? state.entry!.playerOrder : state.playerOrder!,
    stateVersion: state.stateVersion + 1, options, previousFormat: state.schemaVersion,
    facilityFields: state.facilities ? { facilities: state.facilities } : {}, roundFields: {} };
}

export function prepareActionWindow(input: GameState, definition: GameDefinition, rawOptions: OpenActionWindowOptions, reject: Reject) {
  const parsed = actionWindowOptionsSchema.safeParse(rawOptions);
  if (!parsed.success) return reject('WINDOW_SCHEMA', parsed.error.message);
  const { actorId, ...phaseOptions } = parsed.data;
  if (!definition.players.some(player => player.id === actorId)) return reject('ACTOR_REFERENCE', 'Unknown granted actor');
  return { ...preparePhaseWindow(input, definition, phaseOptions, reject, actorId), options: parsed.data };
}
