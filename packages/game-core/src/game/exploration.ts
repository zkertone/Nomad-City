import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { loadFoundersBoard } from '../board/index.js';
import { resourceNodeIdSchema, routeIdSchema, slotIdSchema } from '../board/schema.js';
import { getFoundersEventCard } from '../events/index.js';
import { gameEntityIdSchema, gamePositionSchema, gameStateSchema } from './schema.js';
import { getFoundersMapSide, getGamePosition, parseGameState } from './state.js';
import { eligibleBaseEventIds, finalExplorationSlots, redExplorationOpeningRound } from './exploration-rules.js';
import { eventSettlementChoiceSchema, getEventChoiceRequirements, settleEventChoice, EventSettlementError } from './settlement.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

export class ExplorationCommandError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ExplorationCommandError'; }
}
const reject = (code: string, message: string): never => { throw new ExplorationCommandError(code, message); };
const versionSchema = z.number().int().nonnegative().safe();
const windowOptionsSchema = z.strictObject({
  actorId: gameEntityIdSchema, roundNumber: z.number().int().min(1).max(8), expectedVersion: versionSchema,
  // Trusted deterministic initialization only. Never accept this from a player.
  deckOrder: z.strictObject({
    yellow: z.array(z.string().regex(/^Y\d{2}$/)).max(10),
    red: z.array(z.string().regex(/^R\d{2}$/)).max(6),
  }).optional(),
});
export type OpenExplorationWindowOptions = DeepReadonly<z.infer<typeof windowOptionsSchema>>;
export const explorationPathStepSchema = z.strictObject({
  routeId: routeIdSchema, toNodeId: resourceNodeIdSchema, payeePlayerId: gameEntityIdSchema.optional(),
});
const pathSchema = z.array(explorationPathStepSchema).min(1).max(22);
export type ExplorationPathStep = DeepReadonly<z.infer<typeof explorationPathStepSchema>>;
const envelope = { gameId: gameEntityIdSchema, expectedVersion: versionSchema };
export const explorationPlayerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('explore'), nodeId: resourceNodeIdSchema, path: pathSchema }),
  z.strictObject({ ...envelope, type: z.literal('choose-exploration-event'), choice: eventSettlementChoiceSchema }),
  z.strictObject({ ...envelope, type: z.literal('place-exploration-influence'), slotId: slotIdSchema }),
]);
export type ExplorationPlayerCommand = z.infer<typeof explorationPlayerCommandSchema>;
export interface ExplorationActorContext { readonly authenticatedPlayerId: string }
export interface ExplorationTollLeg {
  readonly routeId: string;
  readonly amount: 0 | 2;
  readonly recipientPlayerIds: readonly string[];
  readonly toSupply: boolean;
}
export interface ExplorationTollQuote { readonly total: number; readonly legs: readonly ExplorationTollLeg[] }

function nextVersion(version: number): number {
  if (version === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return version + 1;
}
function shuffle(ids: string[]): string[] {
  for (let i = ids.length - 1; i > 0; i--) { const j = randomInt(i + 1); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  return ids;
}
function sameIds(a: readonly string[], b: readonly string[]): boolean { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }

/**
 * TRUSTED orchestration boundary granting exactly one exploration. The future round owner must
 * authorize the actor/round/major-action slot before calling. This is not a player command or
 * an implementation of role placement, clockwise turns, quick actions or two action cycles.
 */
export function openExplorationWindow(input: GameState, definition: GameDefinition, rawOptions: OpenExplorationWindowOptions): GameState {
  const state = parseGameState(input, definition);
  const parsed = windowOptionsSchema.safeParse(rawOptions);
  if (!parsed.success) return reject('WINDOW_SCHEMA', parsed.error.message);
  const options = parsed.data;
  if (options.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (!definition.players.some(player => player.id === options.actorId)) return reject('ACTOR_REFERENCE', 'Unknown granted actor');
  const initializing = state.phase === 'entry';
  if (initializing ? state.entry?.status !== 'complete' : state.exploration?.status !== 'complete') {
    return reject('ACTION_PENDING', 'Finish entry or the existing exploration before granting another action');
  }
  if (!initializing && (options.deckOrder !== undefined || options.roundNumber < state.exploration!.roundNumber)) {
    return reject('WINDOW_RESET', 'Cannot reset decks or move the round backwards');
  }
  let decks = state.eventDecks;
  if (initializing) {
    const yellow = options.deckOrder?.yellow ?? shuffle(eligibleBaseEventIds(definition.players.length, 'yellow'));
    const red = options.deckOrder?.red ?? shuffle(eligibleBaseEventIds(definition.players.length, 'red'));
    if (!sameIds(yellow, eligibleBaseEventIds(definition.players.length, 'yellow')) || !sameIds(red, eligibleBaseEventIds(definition.players.length, 'red'))) {
      return reject('EVENT_DECK', 'Initial decks must be exact eligible-card permutations');
    }
    decks = { green: state.entry!.remainingGreenEventIds, yellow, red };
  }
  const position = getGamePosition(state, definition);
  return parseGameState({ ...position, schemaVersion: '1.2.0', stateVersion: nextVersion(state.stateVersion), phase: 'exploration',
    eventDecks: decks, playerOrder: initializing ? state.entry!.playerOrder : state.playerOrder,
    exploration: { actorId: options.actorId, roundNumber: options.roundNumber, status: 'ready',
      targetNodeId: null, cardId: null, resolvedChoiceId: null } }, definition);
}

function readyState(input: GameState, definition: GameDefinition, actorId: string) {
  const state = parseGameState(input, definition);
  if (state.phase !== 'exploration' || !state.exploration || state.exploration.status !== 'ready') return reject('ACTION_STAGE', 'No granted exploration is ready');
  if (state.exploration.actorId !== actorId) return reject('WRONG_ACTOR', 'Only the granted actor may explore');
  return state;
}

/** Ordered node/route walk from the actual city; coordinates and intermediate discovery never gate travel. */
export function getExplorationTollQuote(input: GameState, definition: GameDefinition, actorId: string, nodeId: string, rawPath: readonly ExplorationPathStep[]): ExplorationTollQuote {
  const state = readyState(input, definition, actorId);
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const target = Object.hasOwn(board.resourceNodes, nodeId) ? board.resourceNodes[nodeId] : undefined;
  if (!target || state.board.resourceMarkerByNode[nodeId] !== null) return reject('EXPLORATION_TARGET', 'Target must be an existing unexplored resource node');
  if (target.redRestricted && state.exploration!.roundNumber < redExplorationOpeningRound(definition.players.length)) return reject('RED_CLOSED', 'Red target is not open this round');
  const parsed = pathSchema.safeParse(rawPath);
  if (!parsed.success) return reject('PATH_SCHEMA', parsed.error.message);
  let current = state.board.cityNodeByPlayer[actorId]!;
  const used = new Set<string>();
  const legs: ExplorationTollLeg[] = [];
  for (const step of parsed.data) {
    const route = Object.hasOwn(board.routes, step.routeId) ? board.routes[step.routeId] : undefined;
    if (!route || !route.incidentNodeIds.includes(current) || !route.incidentNodeIds.includes(step.toNodeId) || current === step.toNodeId) {
      return reject('PATH_CONNECTION', 'Every step must use one route incident to both consecutive nodes');
    }
    // A route remains ONE identity even when revisited in the selected walk.
    if (!used.has(route.id)) {
      used.add(route.id);
      const owners = [...new Set(route.influenceSlotIds.flatMap(id => {
        const marker = state.board.influenceBySlot[id]; return marker ? [marker.ownerPlayerId] : [];
      }))];
      const own = owners.includes(actorId);
      legs.push({ routeId: route.id, amount: own ? 0 : 2, recipientPlayerIds: own ? [] : owners, toSupply: !owners.length });
    }
    current = step.toNodeId;
  }
  if (current !== nodeId) return reject('PATH_TARGET', 'Path must end at the selected target');
  return deepFreeze({ total: legs.reduce((total, leg) => total + leg.amount, 0), legs });
}

export function getExplorationFinalSlotIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const state = parseGameState(input, definition); const progress = state.exploration;
  if (state.phase !== 'exploration' || progress?.status !== 'final-influence' || progress.actorId !== actorId) return Object.freeze([]);
  return Object.freeze(finalExplorationSlots(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, progress.targetNodeId!));
}
export function getPendingExplorationChoiceRequirements(input: GameState, definition: GameDefinition, actorId: string, choiceId: string) {
  const state = parseGameState(input, definition); const progress = state.exploration;
  if (state.phase !== 'exploration' || progress?.status !== 'event-choice') return reject('ACTION_STAGE', 'No exploration event choice is pending');
  if (progress.actorId !== actorId) return reject('WRONG_ACTOR', 'Only the event actor may query this choice');
  return getEventChoiceRequirements(getGamePosition(state, definition), definition,
    { gameId: state.gameId, actorId, nodeId: progress.targetNodeId!, cardId: progress.cardId! }, choiceId);
}

/** Identity is supplied by a trusted adapter; payload never selects actor, round, deck or reward. */
export function applyExplorationCommand(input: GameState, definition: GameDefinition, context: ExplorationActorContext, payload: unknown): GameState {
  const current = parseGameState(input, definition);
  const parsed = explorationPlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== current.gameId) return reject('GAME_REFERENCE', 'Wrong game');
  if (command.expectedVersion !== current.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const progress = current.exploration;
  if (current.phase !== 'exploration' || !progress || progress.status === 'complete') return reject('ACTION_STAGE', 'No unfinished exploration grant');
  if (progress.actorId !== context.authenticatedPlayerId) return reject('WRONG_ACTOR', 'Only the granted actor may act');
  const next = gameStateSchema.parse(current); const action = next.exploration!;
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  switch (command.type) {
    case 'explore': {
      const quote = getExplorationTollQuote(current, definition, progress.actorId, command.nodeId, command.path);
      if (next.players[progress.actorId]!.balances['columbia-voucher'] < quote.total) return reject('CANNOT_PAY', 'Road fees must be affordable before the event reward');
      const node = board.resourceNodes[command.nodeId]!;
      const cardId = next.eventDecks![node.eventDeckColor][0];
      if (!cardId) return reject('EVENT_DECK', 'No eligible event remains');
      const payees = new Map<string, string | null>();
      for (const step of command.path) {
        const leg = quote.legs.find(leg => leg.routeId === step.routeId)!;
        const recipient = leg.amount === 0 || leg.toSupply ? null : step.payeePlayerId ?? (leg.recipientPlayerIds.length === 1 ? leg.recipientPlayerIds[0]! : undefined);
        if (leg.amount === 0 || leg.toSupply) {
          if (step.payeePlayerId !== undefined) return reject('TOLL_RECIPIENT', 'Free/supply route does not accept a player recipient');
        } else if (!recipient || !leg.recipientPlayerIds.includes(recipient)) return reject('TOLL_RECIPIENT', 'Select an actual opposing influence owner on that route');
        if (payees.has(step.routeId) && payees.get(step.routeId) !== recipient) return reject('TOLL_RECIPIENT', 'One route cannot have conflicting recipients');
        payees.set(step.routeId, recipient ?? null);
      }
      next.players[progress.actorId]!.balances['columbia-voucher'] -= quote.total;
      for (const leg of quote.legs) {
        const payee = payees.get(leg.routeId);
        if (leg.amount && payee) {
          const player = next.players[payee]!;
          const balance = player.balances['columbia-voucher'] + leg.amount;
          if (!Number.isSafeInteger(balance)) return reject('BALANCE_OVERFLOW', 'Toll recipient exceeds safe integer range');
          player.balances['columbia-voucher'] = balance;
        }
      }
      next.eventDecks![node.eventDeckColor].shift();
      const card = getFoundersEventCard(cardId);
      next.board.resourceMarkerByNode[command.nodeId] = { markerDefinitionId: card.id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
      action.targetNodeId = command.nodeId; action.cardId = card.id; action.status = 'event-choice';
      break;
    }
    case 'choose-exploration-event': {
      if (progress.status !== 'event-choice') return reject('ACTION_STAGE', 'No unresolved event');
      try {
        const settled = settleEventChoice(getGamePosition(current, definition), definition,
          { gameId: current.gameId, actorId: progress.actorId, nodeId: progress.targetNodeId!, cardId: progress.cardId! }, command.choice);
        Object.assign(next, gamePositionSchema.parse(settled.position));
      } catch (error) {
        if (error instanceof EventSettlementError) return reject(error.code, error.message);
        throw error;
      }
      action.resolvedChoiceId = command.choice.choiceId;
      action.status = finalExplorationSlots(next, board, progress.actorId, progress.targetNodeId!).length ? 'final-influence' : 'complete';
      break;
    }
    case 'place-exploration-influence': {
      if (progress.status !== 'final-influence') return reject('ACTION_STAGE', 'No final placement is pending');
      if (!getExplorationFinalSlotIds(current, definition, progress.actorId).includes(command.slotId)) return reject('FINAL_SLOT', 'Final influence must occupy a legal slot at the explored target');
      const markerId = next.markerSupplyByPlayer[progress.actorId]!.shift()!;
      next.board.influenceBySlot[command.slotId] = { markerId, ownerPlayerId: progress.actorId };
      action.status = 'complete';
      break;
    }
  }
  next.stateVersion = nextVersion(current.stateVersion);
  return parseGameState(next, definition);
}
