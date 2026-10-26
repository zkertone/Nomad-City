import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { deepFreeze, FOUNDERS_EVENT_CATALOG, PROJECT_BASE_FACILITY_STOCK, getEligibleCityPatterns } from '@nomad-city-online/game-core';
import type { DeepReadonly, GameState } from '@nomad-city-online/game-core';

export const automaticBasePlanSchema = z.strictObject({ schemaVersion: z.literal('1.0.0'), profile: z.literal('project-base-automatic'),
  facilityDeckOrder: z.array(z.string().min(1)).length(44), yellowDeckOrder: z.array(z.string().min(1)).max(10),
  redDeckOrder: z.array(z.string().min(1)).max(6), patternOrder: z.array(z.string().min(1)).min(6).max(15),
});
export type AutomaticBasePlan = DeepReadonly<z.infer<typeof automaticBasePlanSchema>>;
export function baseSetupIds(playerCount: number) {
  return { facilityDeckOrder: PROJECT_BASE_FACILITY_STOCK.cards.filter(c => c.group === 'ordinary').map(c => c.id),
    yellowDeckOrder: FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === 'yellow' && (playerCount === 4 || !c.hasFourPlayerMark)).map(c => c.id),
    redDeckOrder: FOUNDERS_EVENT_CATALOG.cards.filter(c => c.color === 'red' && (playerCount === 4 || !c.hasFourPlayerMark)).map(c => c.id),
    patternOrder: getEligibleCityPatterns('base', playerCount).map(p => p.id) };
}
export function parseAutomaticBasePlan(input: unknown, playerCount: number): AutomaticBasePlan {
  const plan = automaticBasePlanSchema.parse(input), expected = baseSetupIds(playerCount);
  for (const key of ['facilityDeckOrder', 'yellowDeckOrder', 'redDeckOrder', 'patternOrder'] as const) {
    if (JSON.stringify([...plan[key]].sort()) !== JSON.stringify([...expected[key]].sort())) throw new Error(`Invalid automatic base setup permutation: ${key}`);
  }
  return deepFreeze(plan);
}
function shuffled(ids: readonly string[]): string[] {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j]!, result[i]!]; }
  return result;
}
export function createAutomaticBasePlan(playerCount: number, overrides: Partial<AutomaticBasePlan> = {}): AutomaticBasePlan {
  const ids = baseSetupIds(playerCount);
  return parseAutomaticBasePlan({ schemaVersion: '1.0.0', profile: 'project-base-automatic',
    ...Object.fromEntries(Object.entries(ids).map(([key, values]) => [key, shuffled(values)])), ...overrides }, playerCount);
}
/** Only explicit new-game startup snapshots may cross the older initialization formats. */
export function validateAutomaticBaseState(state: GameState): void {
  if (state.schemaVersion === '1.1.0' || state.schemaVersion === '1.16.0' || state.schemaVersion === '1.17.0') return;
  const flow = state.roundFlow, supply = state.facilities?.supply;
  if (!['1.7.0', '1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0', '1.15.0'].includes(state.schemaVersion)
    || state.phase !== 'round-control' || !flow || flow.roundNumber !== 1 || flow.turnIndex !== 0
    || !['role-removal', 'role-placement'].includes(flow.stage) || flow.majorActionOpened || flow.supplyRemovalCount || flow.rolePlacementCount
    || flow.rolesByPlayer.some(r => r.placed !== null || r.discarded.length || r.used != null)
    || !supply || supply.revision !== 0 || supply.playerHoldings.some(h => h.cardIds.length !== 1)
    || state.facilities!.panels.some(p => p.revision !== 0 || p.placements.length !== 1)
    || state.patternMarkers?.length || state.cityPatterns?.useTracks.length || state.cityPatterns?.usedSpecialActions.length
    || (state.cityPatterns && Object.values(state.cityPatterns.exhaustedFacilityIdsByPlayer).some(ids => ids.length))
    || state.cityPatternContinuation || state.cityPatternMajorActions?.length) {
    throw new Error('Automatic lifecycle requires explicit entry, pristine initialization, or project-base play');
  }
}
