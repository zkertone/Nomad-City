import { deepFreeze } from '../board/hash.js';
import { loadFoundersBoard } from '../board/index.js';
import type { BoardDefinition } from '../board/types.js';
import { resourceBalancesSchema } from './schema.js';
import { getFoundersMapSide, parseGamePosition } from './state.js';
import type { DeepReadonly, GameDefinition, GamePosition, ResourceBalances } from './types.js';

export class ScoringError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ScoringError'; }
}
function safeScore(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || BigInt(result) !== value) throw new ScoringError('SCORE_OVERFLOW', 'Score exceeds the safe integer range');
  return result;
}
export interface ResourceScoreBreakdown {
  readonly pointsByAsset: { readonly orirock: number; readonly originium: number; readonly iron: number; readonly 'pure-originium': number };
  readonly unscoredRemainders: { readonly orirock: number; readonly originium: number; readonly iron: number; readonly 'pure-originium': number };
  readonly totalPoints: number;
}
/** Printed p10 resource scoring. No conversion/payment, action grant or balance mutation. */
export function getResourceScoreBreakdown(input: ResourceBalances): ResourceScoreBreakdown {
  const balances = resourceBalancesSchema.parse(input);
  const rock = BigInt(balances.orirock), ore = BigInt(balances.originium);
  const iron = BigInt(balances.iron), pure = BigInt(balances['pure-originium']);
  const pointsByAsset = { orirock: safeScore(rock / 9n), originium: safeScore(ore / 8n), iron: safeScore(iron / 6n), 'pure-originium': safeScore(pure) };
  return deepFreeze({ pointsByAsset,
    unscoredRemainders: { orirock: Number(rock % 9n), originium: Number(ore % 8n), iron: Number(iron % 6n), 'pure-originium': 0 },
    totalPoints: safeScore(rock / 9n + ore / 8n + iron / 6n + pure) });
}
export interface RegionInfluence {
  readonly nodeMarkers: number;
  readonly routeMarkers: number;
  readonly cityInfluence: number;
  readonly total: number;
}
export interface RegionControl {
  readonly regionId: string;
  readonly rewardPoints: number;
  readonly influenceByPlayer: Readonly<Record<string, RegionInfluence>>;
  /** Empty for an unoccupied region; multiple leaders means nobody controls it. */
  readonly leadingPlayerIds: readonly string[];
  readonly controllerPlayerId: string | null;
}
function regionControl(position: GamePosition, definition: GameDefinition, board: BoardDefinition): Record<string, RegionControl> {
  return Object.fromEntries(Object.values(board.regions).map(region => {
    const influenceByPlayer = Object.fromEntries(definition.players.map(player => [player.id,
      { nodeMarkers: 0, routeMarkers: 0, cityInfluence: 0, total: 0 }]));
    for (const [slotId, marker] of Object.entries(position.board.influenceBySlot)) {
      if (!marker) continue;
      const location = board.influenceSlots[slotId]!;
      const owner = influenceByPlayer[marker.ownerPlayerId]!;
      if (location.kind === 'resource-node' && board.resourceNodes[location.nodeId]!.regionId === region.id) owner.nodeMarkers++;
      if (location.kind === 'route' && board.routes[location.routeId]!.regionId === region.id) owner.routeMarkers++;
    }
    for (const player of definition.players) {
      const nodeId = position.board.cityNodeByPlayer[player.id];
      if (nodeId && board.resourceNodes[nodeId]!.regionId === region.id) influenceByPlayer[player.id]!.cityInfluence += 2;
      const value = influenceByPlayer[player.id]!;
      value.total = value.nodeMarkers + value.routeMarkers + value.cityInfluence;
    }
    const maximum = Math.max(...Object.values(influenceByPlayer).map(value => value.total));
    const leadingPlayerIds = maximum === 0 ? [] : definition.players.filter(player => influenceByPlayer[player.id]!.total === maximum).map(player => player.id);
    return [region.id, { regionId: region.id, rewardPoints: region.controlRewardPoints, influenceByPlayer,
      leadingPlayerIds, controllerPlayerId: leadingPlayerIds.length === 1 ? leadingPlayerIds[0]! : null }];
  }));
}
/** p10/p12: count real node/route markers plus city +2, never endpoint copies or coordinates. */
export function getRegionControl(input: GamePosition, definition: GameDefinition): Readonly<Record<string, RegionControl>> {
  const position = parseGamePosition(input, definition);
  return deepFreeze(regionControl(position, definition, loadFoundersBoard(getFoundersMapSide(definition.players.length))));
}
export interface PlayerBaseScore {
  readonly existingPoints: number;
  readonly regionPoints: number;
  readonly resources: ResourceScoreBreakdown;
  readonly totalPoints: number;
  readonly remainingVouchers: number;
  readonly remainingPureOriginium: number;
}
export interface BaseScoringPreview {
  readonly scope: 'base-components-only';
  readonly regions: Readonly<Record<string, RegionControl>>;
  readonly players: Readonly<Record<string, PlayerBaseScore>>;
  /** Comparison of the supplied position only; does not declare an actual game winner. */
  readonly leadingPlayerIds: readonly string[];
  readonly resolvedBy: 'score' | 'columbia-voucher' | 'pure-originium' | 'shared';
}
/** A read-only preview, safe at any position. Caller must not use it to skip cleanup/style effects. */
export function getBaseScoringPreview(input: GamePosition, definition: GameDefinition): DeepReadonly<BaseScoringPreview> {
  const position = parseGamePosition(input, definition);
  const regions = regionControl(position, definition, loadFoundersBoard(getFoundersMapSide(definition.players.length)));
  const players = Object.fromEntries(definition.players.map(player => {
    const current = position.players[player.id]!;
    const regionPoints = Object.values(regions).filter(region => region.controllerPlayerId === player.id).reduce((sum, region) => sum + region.rewardPoints, 0);
    const resources = getResourceScoreBreakdown(current.balances);
    return [player.id, { existingPoints: current.score, regionPoints, resources,
      totalPoints: safeScore(BigInt(current.score) + BigInt(regionPoints) + BigInt(resources.totalPoints)),
      remainingVouchers: current.balances['columbia-voucher'], remainingPureOriginium: current.balances['pure-originium'] }];
  }));
  let leadingPlayerIds = definition.players.map(player => player.id);
  const comparisons = [['totalPoints', 'score'], ['remainingVouchers', 'columbia-voucher'], ['remainingPureOriginium', 'pure-originium']] as const;
  for (const [field, resolvedBy] of comparisons) {
    const maximum = Math.max(...leadingPlayerIds.map(id => players[id]![field]));
    leadingPlayerIds = leadingPlayerIds.filter(id => players[id]![field] === maximum);
    if (leadingPlayerIds.length === 1) return deepFreeze({ scope: 'base-components-only', regions, players, leadingPlayerIds, resolvedBy });
  }
  return deepFreeze({ scope: 'base-components-only', regions, players, leadingPlayerIds, resolvedBy: 'shared' });
}
