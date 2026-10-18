import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';
import { loadFoundersBoard } from '../board/index.js';
import { resourceNodeIdSchema, slotIdSchema } from '../board/schema.js';
import { getFoundersEventCard } from '../events/index.js';
import type { EventChoice } from '../events/types.js';
import type { BoardDefinition } from '../board/types.js';
import { gameEntityIdSchema, gamePositionSchema } from './schema.js';
import { getFoundersMapSide, parseGamePosition } from './state.js';
import { availableInfluenceSlots } from './influence.js';
import type { DeepReadonly, GameDefinition, GamePosition } from './types.js';

/** Constructed by the trusted action caller after revealing a card. Never a player payload. */
export const eventSettlementContextSchema = z.strictObject({
  gameId: gameEntityIdSchema, actorId: gameEntityIdSchema,
  nodeId: resourceNodeIdSchema, cardId: z.string().regex(/^[GYR]\d{2}$/),
});
export type EventSettlementContext = DeepReadonly<z.infer<typeof eventSettlementContextSchema>>;
export const eventSettlementChoiceSchema = z.strictObject({
  choiceId: z.string().regex(/^[GYR]\d{2}:[1-3]$/),
  costDecision: z.enum(['pay', 'decline']).optional(),
  influenceSlotId: slotIdSchema.nullable().optional(),
});
export type EventSettlementChoice = z.infer<typeof eventSettlementChoiceSchema>;

type GainAsset = 'orirock' | 'originium' | 'iron' | 'columbia-voucher' | 'pure-originium' | 'point';
export type SettledEffect =
  | { readonly kind: 'gain'; readonly effectIndex: number; readonly playerId: string; readonly asset: GainAsset; readonly amount: number }
  | { readonly kind: 'place-influence'; readonly effectIndex: number; readonly status: 'placed'; readonly slotId: string; readonly markerId: string }
  | { readonly kind: 'place-influence'; readonly effectIndex: number; readonly status: 'skipped'; readonly reason: 'no-supply' | 'no-legal-slot' };
export interface EventSettlementReceipt {
  readonly cardId: string;
  readonly choiceId: string;
  readonly cost: { readonly status: 'not-required' | 'declined' } |
    { readonly status: 'paid'; readonly asset: 'columbia-voucher'; readonly amount: number };
  readonly effects: readonly SettledEffect[];
}
export interface EventSettlementResult {
  readonly position: GamePosition;
  /** Diagnostic result, not a second authoritative inventory or a persisted event history. */
  readonly receipt: EventSettlementReceipt;
}
export class EventSettlementError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'EventSettlementError'; }
}
const reject = (code: string, message: string): never => { throw new EventSettlementError(code, message); };

function checkedContext(input: GamePosition, definition: GameDefinition, rawContext: EventSettlementContext) {
  const position = parseGamePosition(input, definition);
  const parsed = eventSettlementContextSchema.safeParse(rawContext);
  if (!parsed.success) return reject('CONTEXT_SCHEMA', parsed.error.message);
  const context = parsed.data;
  if (context.gameId !== position.gameId) return reject('GAME_REFERENCE', 'Event belongs to another game');
  if (!definition.players.some(player => player.id === context.actorId)) return reject('ACTOR_REFERENCE', 'Unknown event actor');
  // Own-key checks prevent prototype names from being interpreted as board facts.
  if (!Object.hasOwn(position.board.resourceMarkerByNode, context.nodeId) ||
      position.board.resourceMarkerByNode[context.nodeId]?.markerDefinitionId !== context.cardId) {
    return reject('EVENT_REFERENCE', 'Event must match the revealed marker at the specified node');
  }
  const card = getFoundersEventCard(context.cardId);
  return { position, context, card, board: loadFoundersBoard(getFoundersMapSide(definition.players.length)) };
}

function choiceFor(card: ReturnType<typeof getFoundersEventCard>, id: string): EventChoice {
  return card.choices.find(choice => choice.id === id) ?? reject('EVENT_CHOICE', 'Choice does not belong to the revealed card');
}
function placementSlots(position: GamePosition, board: BoardDefinition, context: EventSettlementContext, choice: EventChoice): string[] {
  const placement = choice.effects.find(effect => effect.kind === 'place-influence');
  if (!placement || placement.kind !== 'place-influence') return [];
  return availableInfluenceSlots(position, board, context.actorId).filter(slotId => {
    const slot = board.influenceSlots[slotId]!;
    if (placement.scope === 'standard') return true;
    if (slot.kind === 'route') return board.routes[slot.routeId]!.incidentNodeIds.includes(context.nodeId);
    return placement.scope === 'event-node-or-incident-route' && slot.nodeId === context.nodeId;
  });
}

/** Choice requirements only; does not authorize drawing/exploring or identify an authenticated actor. */
export function getEventChoiceRequirements(input: GamePosition, definition: GameDefinition, rawContext: EventSettlementContext, choiceId: string) {
  const { position, context, card, board } = checkedContext(input, definition, rawContext);
  const choice = choiceFor(card, choiceId);
  return deepFreeze({
    requiresCostDecision: choice.cost !== null,
    canPay: choice.cost === null || position.players[context.actorId]!.balances[choice.cost.asset] >= choice.cost.amount,
    legalInfluenceSlotIds: placementSlots(position, board, context, choice),
  });
}

/**
 * Internal pure settlement of ONE already-revealed event choice. No turn advancement, drawing,
 * exploration fee, authentication, replay protection or action-end placement is implied.
 * The action owner must apply this result once under its own pending-event/version guard.
 */
export function settleEventChoice(input: GamePosition, definition: GameDefinition, rawContext: EventSettlementContext, payload: unknown): EventSettlementResult {
  const { position, context, card, board } = checkedContext(input, definition, rawContext);
  const parsed = eventSettlementChoiceSchema.safeParse(payload);
  if (!parsed.success) return reject('CHOICE_SCHEMA', parsed.error.message);
  const request = parsed.data;
  const choice = choiceFor(card, request.choiceId);
  const placement = choice.effects.some(effect => effect.kind === 'place-influence');
  if ((choice.cost !== null) !== (request.costDecision !== undefined)) return reject('COST_DECISION', 'Only a conditional choice requires an explicit cost decision');
  if (!placement && request.influenceSlotId !== undefined) return reject('UNEXPECTED_PLACEMENT', 'This choice has no influence placement');
  if (request.costDecision === 'decline') {
    if (request.influenceSlotId !== undefined && request.influenceSlotId !== null) return reject('UNEXPECTED_PLACEMENT', 'Declined precondition has no placement');
    return deepFreeze({ position, receipt: { cardId: card.id, choiceId: choice.id, cost: { status: 'declined' }, effects: [] } });
  }
  if (choice.cost && position.players[context.actorId]!.balances[choice.cost.asset] < choice.cost.amount) return reject('CANNOT_PAY', 'Conditional cost must be fully paid');
  const slots = placementSlots(position, board, context, choice);
  if (slots.length && (!request.influenceSlotId || !slots.includes(request.influenceSlotId))) return reject('PLACEMENT_REQUIRED', 'Choose a legal slot; executable nonconditional effects cannot be abandoned');
  if (!slots.length && request.influenceSlotId != null) return reject('INFLUENCE_SLOT', 'No legal placement target is available');

  const next = gamePositionSchema.parse(position);
  const effects: SettledEffect[] = [];
  const cost: EventSettlementReceipt['cost'] = choice.cost ? { status: 'paid', ...choice.cost } : { status: 'not-required' };
  if (choice.cost) next.players[context.actorId]!.balances[choice.cost.asset] -= choice.cost.amount;
  choice.effects.forEach((effect, effectIndex) => {
    if (effect.kind === 'gain') {
      const recipients = effect.recipient === 'actor' ? [context.actorId] : definition.players.map(player => player.id).filter(id => id !== context.actorId);
      for (const playerId of recipients) {
        const player = next.players[playerId]!;
        const old = effect.asset === 'point' ? player.score : player.balances[effect.asset];
        const value = old + effect.amount;
        if (!Number.isSafeInteger(value)) return reject('BALANCE_OVERFLOW', 'Reward exceeds representable integer range');
        if (effect.asset === 'point') player.score = value; else player.balances[effect.asset] = value;
        effects.push({ kind: 'gain', effectIndex, playerId, asset: effect.asset, amount: effect.amount });
      }
    } else if (slots.length) {
      const markerId = next.markerSupplyByPlayer[context.actorId]!.shift()!;
      const slotId = request.influenceSlotId!;
      next.board.influenceBySlot[slotId] = { markerId, ownerPlayerId: context.actorId };
      effects.push({ kind: 'place-influence', effectIndex, status: 'placed', slotId, markerId });
    } else {
      effects.push({ kind: 'place-influence', effectIndex, status: 'skipped',
        reason: next.markerSupplyByPlayer[context.actorId]!.length ? 'no-legal-slot' : 'no-supply' });
    }
  });
  return deepFreeze({ position: parseGamePosition(next, definition), receipt: { cardId: card.id, choiceId: choice.id, cost, effects } });
}
