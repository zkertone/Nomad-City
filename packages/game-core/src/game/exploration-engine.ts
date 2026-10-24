import { z } from 'zod';
import { loadFoundersBoard } from '../board/index.js';
import { resourceNodeIdSchema, routeIdSchema, slotIdSchema } from '../board/schema.js';
import { getFoundersEventCard } from '../events/index.js';
import { gameEntityIdSchema, gamePositionSchema } from './schema.js';
import type { gameStateSchema, explorationProgressSchema } from './schema.js';
import { getFoundersMapSide } from './state.js';
import { quoteRouteTolls } from './route-tolls.js';
import { finalExplorationSlots, redExplorationOpeningRound } from './exploration-rules.js';
import { eventSettlementChoiceSchema, settleEventChoice, EventSettlementError } from './settlement.js';
import type { DeepReadonly, GameDefinition, GameState, ExplorationProgress } from './types.js';
const versionSchema = z.number().int().nonnegative().safe();
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

type Reject = (code: string, message: string) => never;
/** Internal exact path/toll rules shared by normal exploration and construction-owned exploration. */
export function quoteExplorationStep(state: GameState, definition: GameDefinition, progress: ExplorationProgress, nodeId: string, rawPath: readonly ExplorationPathStep[], reject: Reject) {
  const actorId = progress.actorId;
  const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  const target = Object.hasOwn(board.resourceNodes, nodeId) ? board.resourceNodes[nodeId] : undefined;
  if (!target || state.board.resourceMarkerByNode[nodeId] !== null) return reject('EXPLORATION_TARGET', 'Target must be an existing unexplored resource node');
  if (target.redRestricted && progress.roundNumber < redExplorationOpeningRound(definition.players.length)) return reject('RED_CLOSED', 'Red target is not open this round');
  const parsed = pathSchema.safeParse(rawPath);
  if (!parsed.success) return reject('PATH_SCHEMA', parsed.error.message);
  let current = state.board.cityNodeByPlayer[actorId]!;
  const used = new Set<string>();
  for (const step of parsed.data) {
    const route = Object.hasOwn(board.routes, step.routeId) ? board.routes[step.routeId] : undefined;
    if (!route || !route.incidentNodeIds.includes(current) || !route.incidentNodeIds.includes(step.toNodeId) || current === step.toNodeId) {
      return reject('PATH_CONNECTION', 'Every step must use one route incident to both consecutive nodes');
    }
    // A route remains ONE identity even when revisited in the selected walk.
    used.add(route.id);
    current = step.toNodeId;
  }
  if (current !== nodeId) return reject('PATH_TARGET', 'Path must end at the selected target');
  return quoteRouteTolls(state, board, actorId, [...used]);
}
/** Mutate a private transaction copy; caller alone owns phase authorization and version commit. */
export function resolveExplorationStep(next: z.infer<typeof gameStateSchema>, definition: GameDefinition, progress: z.infer<typeof explorationProgressSchema>, command: ExplorationPlayerCommand, reject: Reject): void {
  const current = next, action = progress, board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
  if (command.type === 'explore' && progress.status !== 'ready') return reject('ACTION_STAGE', 'Exploration has already started');
  switch (command.type) {
    case 'explore': {
      const quote = quoteExplorationStep(current, definition, progress, command.nodeId, command.path, reject);
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
        const settled = settleEventChoice({ gameId: current.gameId, board: current.board, players: current.players, markerSupplyByPlayer: current.markerSupplyByPlayer, ...(current.patternMarkers ? { patternMarkers: current.patternMarkers } : {}) }, definition,
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
      if (!finalExplorationSlots(current, board, progress.actorId, progress.targetNodeId!).includes(command.slotId)) return reject('FINAL_SLOT', 'Final influence must occupy a legal slot at the explored target');
      const markerId = next.markerSupplyByPlayer[progress.actorId]!.shift()!;
      next.board.influenceBySlot[command.slotId] = { markerId, ownerPlayerId: progress.actorId };
      action.status = 'complete';
      break;
    }
  }
}
