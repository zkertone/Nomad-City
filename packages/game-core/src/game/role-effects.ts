import { z } from 'zod';
import { getCityPattern } from '../patterns/catalog.js';
import { bothRoleModesAllowed } from './city-pattern-major-actions.js';
import { loadFoundersBoard } from '../board/index.js';
import { slotIdSchema } from '../board/schema.js';
import { gameEntityIdSchema, gameStateSchema } from './schema.js';
import { getFoundersMapSide, parseGameState } from './state.js';
import { getRoundTurn } from './round.js';
import { baseRoleIdSchema } from './round-schema.js';
import { isBaseRoleModeAvailableInFormat } from './role-rules.js';
import { emptyInfluenceSlots } from './influence.js';
import { facilitySupplyStateSchema, replenishFacilitySupply } from '../facilities/supply.js';
import type { DeepReadonly, GameDefinition, GameState } from './types.js';
import { sellStandardResources } from './resource-sales.js';
import { deepFreeze } from '../board/hash.js';
import { elysiumSchemeChoiceSchema, texasSchemeChoiceSchema, cannotSchemeChoiceSchema, elysiumDestinations, resolveElysiumScheme, resolveTexasScheme, resolveCannotScheme } from './role-schemes.js';
import { placeLiskarmInfluence, replaceLiskarmInfluence } from './liskarm-rules.js';

export class BaseRoleEffectError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'BaseRoleEffectError'; }
}
const reject = (code: string, message: string): never => { throw new BaseRoleEffectError(code, message); };
const version = z.number().int().nonnegative().safe();
const upgradeOptionsSchema = z.strictObject({ expectedVersion: version });
/** Explicitly add role-use tracking to a validated, effect-free 1.7.0 snapshot; preserve all facts. */
export function enableBaseRoleEffects(input: GameState, definition: GameDefinition, rawOptions: DeepReadonly<z.infer<typeof upgradeOptionsSchema>>): GameState {
  const state = parseGameState(input, definition), options = upgradeOptionsSchema.safeParse(rawOptions);
  if (!options.success) return reject('OPTIONS_SCHEMA', options.error.message);
  if (options.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.schemaVersion !== '1.7.0') return reject('ROLE_FORMAT', 'Only a validated role-effect-free 1.7.0 snapshot can be upgraded');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return parseGameState({ ...state, schemaVersion: '1.8.0', stateVersion: state.stateVersion + 1,
    roundFlow: { ...state.roundFlow!, rolesByPlayer: state.roundFlow!.rolesByPlayer.map(role => ({ ...role, used: null })) },
  }, definition);
}

/** Explicitly enable the final three BASE schemes without inferring or resetting prior role history. */
export function enableRemainingBaseRoleEffects(input: GameState, definition: GameDefinition, rawOptions: DeepReadonly<z.infer<typeof upgradeOptionsSchema>>): GameState {
  const state = parseGameState(input, definition), options = upgradeOptionsSchema.safeParse(rawOptions);
  if (!options.success) return reject('OPTIONS_SCHEMA', options.error.message);
  if (options.data.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (state.schemaVersion !== '1.9.0') return reject('ROLE_FORMAT', 'Upgrade a validated 1.9.0 snapshot exactly once');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  return parseGameState({ ...state, schemaVersion: '1.10.0', stateVersion: state.stateVersion + 1,
    roundFlow: { ...state.roundFlow!, completedMajorAction: null },
  }, definition);
}
/** Public target query on validated board facts; neither pays the cost nor grants a role use. */
export function getElysiumSchemeOptions(input: GameState, definition: GameDefinition, actorId: string) {
  const state = parseGameState(input, definition);
  if (!state.roundFlow || !definition.players.some(player => player.id === actorId)) return Object.freeze([]);
  return deepFreeze(elysiumDestinations(state, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, state.roundFlow.roundNumber, definition.players.length));
}

const quantity = z.number().int().nonnegative().safe();
const strategyChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('liskarm-place'), slotIds: z.array(slotIdSchema).max(2) }),
  z.strictObject({ kind: z.literal('minimum-resource'), asset: z.enum(['orirock', 'originium', 'iron']) }),
  z.strictObject({ kind: z.literal('cycle-facility'), cardId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('sell-resources'), amounts: z.strictObject({ orirock: quantity, originium: quantity, iron: quantity, 'pure-originium': quantity }) }),
  z.strictObject({ kind: z.literal('tin-point') }),
  z.strictObject({ kind: z.literal('tin-purchases'), payFirst: z.boolean(), paySecond: z.boolean() }),
]);
const recoveryChoiceSchema = z.strictObject({ kind: z.literal('recover-roles'), rewards: z.array(z.discriminatedUnion('kind', [
  z.strictObject({ roleId: baseRoleIdSchema, kind: z.literal('vouchers') }),
  z.strictObject({ roleId: baseRoleIdSchema, kind: z.literal('move-influence'), sourceSlotId: slotIdSchema, targetSlotId: slotIdSchema }),
])).max(4) });
const schemeChoiceSchema = z.discriminatedUnion('kind', [recoveryChoiceSchema, elysiumSchemeChoiceSchema, texasSchemeChoiceSchema, cannotSchemeChoiceSchema,
  z.strictObject({ kind: z.literal('liskarm-replace'), costDecision: z.enum(['pay', 'decline']), slotId: slotIdSchema.optional() }),
]);
export const baseRolePlayerCommandSchema = z.strictObject({
  type: z.literal('use-base-role'), gameId: gameEntityIdSchema, expectedVersion: version,
  roleId: baseRoleIdSchema, mode: z.enum(['strategy', 'scheme', 'both']),
  strategyChoice: strategyChoiceSchema.optional(), schemeChoice: schemeChoiceSchema.optional(),
});
export type BaseRolePlayerCommand = DeepReadonly<z.infer<typeof baseRolePlayerCommandSchema>>;
export interface BaseRoleActorContext { readonly authenticatedPlayerId: string }

/** Atomic complete role use. Role effects grant no additional major action and cannot interrupt one. */
export function applyBaseRoleCommand(input: GameState, definition: GameDefinition, context: BaseRoleActorContext, payload: unknown): GameState {
  const state = parseGameState(input, definition), checked = baseRolePlayerCommandSchema.safeParse(payload);
  if (!checked.success) return reject('COMMAND_SCHEMA', checked.error.message);
  const command = checked.data;
  if (command.gameId !== state.gameId) return reject('GAME_REFERENCE', 'Wrong role game');
  if (command.expectedVersion !== state.stateVersion) return reject('STALE_VERSION', 'Expected state version is stale');
  if (!isBaseRoleModeAvailableInFormat(command.roleId, command.mode, state.schemaVersion)) return reject('ROLE_FORMAT', 'This role mode requires its explicit snapshot upgrade (remaining schemes: 1.10.0)');
  const flow = state.roundFlow!, turn = getRoundTurn(state, definition);
  if (flow.stage !== 'player-actions' || turn.actorId !== context.authenticatedPlayerId) return reject('ROLE_WINDOW', 'Only the current action player may use their placed role');
  if (turn.majorActionStatus === 'pending') return reject('ACTION_PENDING', 'Quick actions cannot interrupt a major action');
  if (state.cityPatterns?.usedSpecialActions.some(use => use.playerId === turn.actorId && use.turnIndex === flow.turnIndex && getCityPattern(use.patternId).forbidsRoleInTurn)) return reject('ROLE_CONFLICT', 'This special forbids a role in its action turn');
  const actorId = turn.actorId!, roles = flow.rolesByPlayer.find(role => role.playerId === actorId)!;
  if (roles.used || roles.placed === null) return reject('ROLE_ALREADY_USED', 'This round role has already been used');
  if (roles.placed !== command.roleId) return reject('PLACED_ROLE', 'Only the placed role can be used');
  if (command.mode === 'both' && !bothRoleModesAllowed(state, actorId, flow.turnIndex)) return reject('STARTING_PLAYER_ONLY', 'Both modes require the starting player or this turn command-pattern authority');
  const usesStrategy = command.mode !== 'scheme', usesScheme = command.mode !== 'strategy';
  if (usesStrategy !== (command.strategyChoice !== undefined) || usesScheme !== (command.schemeChoice !== undefined)) return reject('ROLE_CHOICES', 'Provide exactly the choices for the requested modes');
  const expectedChoice = command.roleId === 'ROLE-01' ? ['liskarm-place'] : command.roleId === 'ROLE-02' ? ['minimum-resource'] : command.roleId === 'ROLE-03' ? ['cycle-facility']
    : command.roleId === 'ROLE-04' ? ['sell-resources'] : ['tin-point', 'tin-purchases'];
  if (usesStrategy && !expectedChoice.includes(command.strategyChoice!.kind)) return reject('ROLE_CHOICES', 'Choice does not belong to this role strategy');
  const expectedScheme = { 'ROLE-01': 'liskarm-replace', 'ROLE-02': 'elysium-city-move', 'ROLE-03': 'texas-influence', 'ROLE-04': 'forced-sale', 'ROLE-05': 'recover-roles' };
  if (usesScheme && command.schemeChoice!.kind !== expectedScheme[command.roleId]) return reject('ROLE_CHOICES', 'Choice does not belong to this role scheme');
  if (state.stateVersion === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'State version exhausted');
  const next = gameStateSchema.parse(state), actor = next.players[actorId]!, nextRoles = next.roundFlow!.rolesByPlayer.find(role => role.playerId === actorId)!;
  if (['1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0', '1.16.0'].includes(state.schemaVersion) && turn.majorActionStatus === 'complete' && state.phase !== 'round-control') {
    next.roundFlow!.completedMajorAction = state.phase === 'exploration' ? 'explore' : state.phase === 'city-move' ? 'city-move'
      : state.phase === 'construction' ? 'construct' : state.influenceAction!.kind;
    delete next.exploration; delete next.cityMove; delete next.influenceAction; delete next.construction;
    next.phase = 'round-control';
  }
  const gain = (asset: keyof typeof actor.balances, amount: number) => {
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(actor.balances[asset] + amount)) return reject('BALANCE_OVERFLOW', 'Role gain exceeds safe integer range');
    actor.balances[asset] += amount;
  };
  const payVouchers = (amount: number) => {
    if (actor.balances['columbia-voucher'] < amount) return reject('CANNOT_PAY', 'Role conditional cost must be payable at this step');
    actor.balances['columbia-voucher'] -= amount;
  };
  // Starting player must finish strategy BEFORE scheme. Current card stays out of discard
  // until both effects finish, as explicitly required for Tin Man's recovered-card count (p14).
  if (usesStrategy) {
    const choice = command.strategyChoice!;
    switch (choice.kind) {
      case 'liskarm-place': placeLiskarmInfluence(next, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, choice.slotIds, reject); break;
      case 'minimum-resource': {
        const minimum = Math.min(actor.balances.orirock, actor.balances.originium, actor.balances.iron);
        if (actor.balances[choice.asset] !== minimum) return reject('MINIMUM_RESOURCE', 'Select one of the tied minimum basic resources');
        gain(choice.asset, 4); break;
      }
      case 'cycle-facility': {
        const supply = next.facilities!.supply, index = supply.supply.indexOf(choice.cardId);
        if (index < 0 || supply.supply.length !== 6) return reject('CARD_SOURCE', 'Select one current six-card market facility');
        if (supply.revision === Number.MAX_SAFE_INTEGER) return reject('VERSION_OVERFLOW', 'Supply version exhausted');
        gain('columbia-voucher', 12);
        supply.drawPile.push(supply.supply.splice(index, 1)[0]!);
        // p14 explicitly permits an empty deck: the bottomed card is immediately revealed again.
        const refill = replenishFacilitySupply(supply, supply.revision);
        if (refill.status !== 'replenished') return reject('REFILL_UNRESOLVED', 'Texas must complete the immediate market refill');
        next.facilities!.supply = facilitySupplyStateSchema.parse(refill.state); break;
      }
      case 'sell-resources': sellStandardResources(next, actorId, choice.amounts, reject); break;
      case 'tin-point': {
        if (!Number.isSafeInteger(actor.score + 1)) return reject('SCORE_OVERFLOW', 'Role point exceeds safe integer range');
        actor.score++; break;
      }
      case 'tin-purchases': {
        if (choice.payFirst) { payVouchers(12); gain('pure-originium', 1); }
        if (choice.paySecond) { payVouchers(15); gain('pure-originium', 1); }
        break;
      }
    }
  }
  if (usesScheme) {
    const scheme = command.schemeChoice!;
    if (scheme.kind === 'liskarm-replace') replaceLiskarmInfluence(next, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, scheme.costDecision, scheme.slotId, reject);
    else if (scheme.kind === 'elysium-city-move') resolveElysiumScheme(next, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, flow.roundNumber, definition.players.length, scheme, reject);
    else if (scheme.kind === 'texas-influence') resolveTexasScheme(next, loadFoundersBoard(getFoundersMapSide(definition.players.length)), actorId, scheme, reject);
    else if (scheme.kind === 'forced-sale') resolveCannotScheme(next, actorId, scheme, reject);
    else {
      const rewards = scheme.rewards, recovering = [...nextRoles.discarded];
      if (JSON.stringify(rewards.map(row => row.roleId).sort()) !== JSON.stringify([...recovering].sort())) return reject('RECOVERY_CHOICES', 'Choose one reward for each prior discarded card, excluding this Tin Man');
      nextRoles.hand.push(...nextRoles.discarded.splice(0));
      const board = loadFoundersBoard(getFoundersMapSide(definition.players.length));
      for (const reward of rewards) {
        if (reward.kind === 'vouchers') gain('columbia-voucher', 5);
        else {
          const marker = next.board.influenceBySlot[reward.sourceSlotId];
          if (!Object.hasOwn(next.board.influenceBySlot, reward.sourceSlotId) || marker?.ownerPlayerId !== actorId) return reject('MOVE_SOURCE', 'Move one of the actor own board markers');
          if (!emptyInfluenceSlots(next, board, actorId).includes(reward.targetSlotId)) return reject('MOVE_TARGET', 'Move to one legal empty influence slot');
          next.board.influenceBySlot[reward.sourceSlotId] = null; next.board.influenceBySlot[reward.targetSlotId] = marker;
        }
      }
    }
  }
  nextRoles.discarded.push(nextRoles.placed!); nextRoles.placed = null;
  nextRoles.used = { roleId: command.roleId, mode: command.mode, turnIndex: flow.turnIndex,
    ...(command.roleId === 'ROLE-01' && usesStrategy ? { cleanupResolved: false } : {}),
  };
  next.stateVersion++;
  return parseGameState(next, definition);
}
