import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { loadFoundersBoard } from '../board/index.js';
import { resourceNodeIdSchema, slotIdSchema } from '../board/schema.js';
import { getFoundersEventCard } from '../events/index.js';
import { gameEntityIdSchema, gameStateSchema, gamePositionSchema } from './schema.js';
import { getFoundersMapSide, getGamePosition, parseGameState } from './state.js';
import { settleEventChoice, EventSettlementError } from './settlement.js';
import { eligibleEntryGreenIds, initialEntryFunds, entryInfluenceSlots } from './entry-rules.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';

export class EntryCommandError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'EntryCommandError'; }
}
const reject = (code: string, message: string): never => { throw new EntryCommandError(code, message); };
const version = z.number().int().nonnegative().safe();
const beginOptionsSchema = z.strictObject({
  startingPlayerId: gameEntityIdSchema,
  clockwisePlayerIds: z.array(gameEntityIdSchema).min(2).max(4),
  expectedVersion: version,
  // Server-only deterministic override; never take a deck order from a player request.
  greenDeckOrder: z.array(z.string().regex(/^G\d{2}$/)).max(6).optional(),
});
export type BeginEntryOptions = DeepReadonly<z.infer<typeof beginOptionsSchema>>;
const envelope = { gameId: gameEntityIdSchema, expectedVersion: version };
export const entryPlayerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...envelope, type: z.literal('select-initial-node'), nodeId: resourceNodeIdSchema,
    b01Bonus: z.enum(['claim', 'decline']).optional() }),
  z.strictObject({ ...envelope, type: z.literal('choose-green-event'), choiceId: z.string().regex(/^G\d{2}:[1-3]$/) }),
  z.strictObject({ ...envelope, type: z.literal('choose-entry-influence'), slotId: slotIdSchema.nullable() }),
]);
export type EntryPlayerCommand = z.infer<typeof entryPlayerCommandSchema>;
export interface EntryActorContext { readonly authenticatedPlayerId: string }

function nextVersion(current: number): number {
  if (current === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return current + 1;
}
function checkedAdd(value: number, amount: number): number {
  const result = value + amount;
  if (!Number.isSafeInteger(result)) return reject('BALANCE_OVERFLOW', 'Balance exceeds safe integer range');
  return result;
}
function shuffledGreenIds(count: number): string[] {
  const ids = eligibleEntryGreenIds(count);
  for (let i = ids.length - 1; i > 0; i--) { const j = randomInt(i + 1); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  return ids;
}

/** Trusted server setup: actual clockwise seats + chosen first player, independent of player commands. */
export function beginEntry(input: GameState, definition: GameDefinition, inputOptions: BeginEntryOptions): GameState {
  const state = parseGameState(input, definition);
  const parsed = beginOptionsSchema.safeParse(inputOptions);
  if (!parsed.success) return reject('SETUP_SCHEMA', parsed.error.message);
  const options = parsed.data;
  if (options.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.entry || state.stateVersion !== 0 || Object.values(state.board.cityNodeByPlayer).some(node => node !== null) ||
      Object.values(state.board.resourceMarkerByNode).some(marker => marker !== null) ||
      Object.values(state.board.influenceBySlot).some(marker => marker !== null) ||
      Object.values(state.players).some(player => player.score !== 0 || Object.values(player.balances).some(value => value !== 0))) {
    return reject('ENTRY_ALREADY_STARTED', 'Only a pristine pre-entry snapshot may start entry');
  }
  const registered = definition.players.map(player => player.id).sort();
  if (JSON.stringify([...options.clockwisePlayerIds].sort()) !== JSON.stringify(registered)) return reject('PLAYER_ORDER', 'Clockwise seats must contain every player once');
  const start = options.clockwisePlayerIds.indexOf(options.startingPlayerId);
  if (start < 0) return reject('STARTING_PLAYER', 'Starting player is not registered');
  const deck = options.greenDeckOrder ?? shuffledGreenIds(registered.length);
  if (JSON.stringify([...deck].sort()) !== JSON.stringify(eligibleEntryGreenIds(registered.length).sort())) {
    return reject('GREEN_DECK', 'Green deck must be the exact eligible-card permutation');
  }
  return parseGameState({ ...state, schemaVersion: '1.1.0', stateVersion: nextVersion(state.stateVersion), entry: {
    status: 'selecting-node', playerOrder: [...options.clockwisePlayerIds.slice(start), ...options.clockwisePlayerIds.slice(0, start)],
    completedPlayerCount: 0, remainingGreenEventIds: deck, pendingEvent: null,
  } }, definition);
}

export function getLegalInitialNodeIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const state = parseGameState(input, definition); const entry = state.entry;
  if (!entry || entry.status !== 'selecting-node' || entry.playerOrder[entry.completedPlayerCount] !== actorId) return Object.freeze([]);
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  return Object.freeze(Object.values(board.resourceNodes).filter(node => node.initialCityEligible && node.eventDeckColor === 'green' &&
    !(definition.players.length === 2 && node.id === 'B-01') && !Object.values(state.board.cityNodeByPlayer).includes(node.id)).map(node => node.id));
}

export function getLegalEntryInfluenceSlotIds(input: GameState, definition: GameDefinition, actorId: string): readonly string[] {
  const state = parseGameState(input, definition); const entry = state.entry;
  if (!entry || entry.status !== 'bonus-influence' || entry.playerOrder[1] !== actorId) return Object.freeze([]);
  return Object.freeze(entryInfluenceSlots(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId));
}

type MutableState = z.infer<typeof gameStateSchema>;
function finishEntry(state: MutableState): void {
  const entry = state.entry!;
  const funds = initialEntryFunds(entry.playerOrder.length);
  entry.playerOrder.forEach((id, index) => {
    state.players[id]!.balances['columbia-voucher'] = checkedAdd(state.players[id]!.balances['columbia-voucher'], funds[index]!);
  });
  if (entry.playerOrder.length === 2) {
    const second = state.players[entry.playerOrder[1]!]!;
    second.score = checkedAdd(second.score, 3);
  }
  entry.status = 'complete';
}

/** Pure authoritative reducer; identity is supplied by a future authenticated server adapter, not the payload. */
export function applyEntryCommand(input: GameState, definition: GameDefinition, context: EntryActorContext, payload: unknown): GameState {
  const current = parseGameState(input, definition);
  const parsed = entryPlayerCommandSchema.safeParse(payload);
  if (!parsed.success) return reject('COMMAND_SCHEMA', parsed.error.message);
  const command = parsed.data;
  if (command.gameId !== current.gameId) return reject('GAME_REFERENCE', 'Command belongs to another game');
  if (command.expectedVersion !== current.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  const entry = current.entry;
  if (!entry || entry.status === 'complete') return reject('ENTRY_STAGE', 'No entry choice is pending');
  const actor = entry.status === 'bonus-influence' ? entry.playerOrder[1] : entry.playerOrder[entry.completedPlayerCount];
  if (!definition.players.some(player => player.id === context.authenticatedPlayerId) || actor !== context.authenticatedPlayerId) {
    return reject('WRONG_ACTOR', 'Only the current entry player can choose');
  }
  const state = gameStateSchema.parse(current); const progress = state.entry!;
  switch (command.type) {
    case 'select-initial-node': {
      if (entry.status !== 'selecting-node') return reject('ENTRY_STAGE', 'Resolve the current event before choosing another node');
      if (!getLegalInitialNodeIds(current, definition, actor!).includes(command.nodeId)) return reject('INITIAL_NODE', 'Initial node is unavailable');
      if ((command.nodeId === 'B-01') !== (command.b01Bonus !== undefined)) return reject('B01_DECISION', 'B-01 requires an explicit bonus decision; other nodes have no B-01 decision');
      state.board.cityNodeByPlayer[actor!] = command.nodeId;
      if (command.b01Bonus === 'claim') {
        for (const asset of ['orirock', 'originium', 'iron'] as const) state.players[actor!]!.balances[asset] = checkedAdd(state.players[actor!]!.balances[asset], 2);
      }
      const cardId = progress.remainingGreenEventIds.shift();
      if (!cardId) return reject('GREEN_DECK', 'No green event remains');
      const card = getFoundersEventCard(cardId);
      state.board.resourceMarkerByNode[command.nodeId] = { markerDefinitionId: card.id, resourceKind: card.resourceMarker.resource, harvestAmount: card.resourceMarker.harvestAmount };
      progress.pendingEvent = { playerId: actor!, nodeId: command.nodeId, cardId };
      progress.status = 'resolving-event';
      break;
    }
    case 'choose-green-event': {
      if (entry.status !== 'resolving-event' || !entry.pendingEvent) return reject('ENTRY_STAGE', 'No green event choice is pending');
      const card = getFoundersEventCard(entry.pendingEvent.cardId);
      const choice = card.choices.find(item => item.id === command.choiceId);
      if (!choice) return reject('EVENT_CHOICE', 'Choice does not belong to the revealed event');
      if (choice.cost !== null || choice.effects.some(effect => effect.kind !== 'gain' || effect.recipient !== 'actor')) return reject('UNSUPPORTED_GREEN_EFFECT', 'Entry supports confirmed green actor gains only');
      try {
        const settled = settleEventChoice(getGamePosition(current, definition), definition,
          { gameId: current.gameId, actorId: actor!, nodeId: entry.pendingEvent.nodeId, cardId: card.id },
          { choiceId: choice.id });
        state.players = gamePositionSchema.parse(settled.position).players;
      } catch (error) {
        if (error instanceof EventSettlementError) return reject(error.code, error.message);
        throw error;
      }
      progress.pendingEvent = null; progress.completedPlayerCount++;
      if (progress.completedPlayerCount < progress.playerOrder.length) progress.status = 'selecting-node';
      else if (progress.playerOrder.length === 2) progress.status = 'bonus-influence';
      else finishEntry(state);
      break;
    }
    case 'choose-entry-influence': {
      if (entry.status !== 'bonus-influence') return reject('ENTRY_STAGE', 'No optional two-player bonus is pending');
      if (command.slotId !== null) {
        if (!getLegalEntryInfluenceSlotIds(current, definition, actor!).includes(command.slotId)) return reject('INFLUENCE_SLOT', 'Bonus influence target is unavailable');
        const markerId = state.markerSupplyByPlayer[actor!]!.shift();
        if (!markerId) return reject('MARKER_SUPPLY', 'No player marker remains');
        state.board.influenceBySlot[command.slotId] = { markerId, ownerPlayerId: actor! };
      }
      finishEntry(state);
      break;
    }
  }
  state.stateVersion = nextVersion(current.stateVersion);
  return parseGameState(state, definition);
}
