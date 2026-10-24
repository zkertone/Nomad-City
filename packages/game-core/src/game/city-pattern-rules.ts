import { deepFreeze } from '../board/hash.js';
import { getCityPattern } from '../patterns/catalog.js';
import type { z } from 'zod';
import type { gameStateSchema } from './schema.js';

export const IMPLEMENTED_PATTERN_SPECIALS = ['PAT-001', 'PAT-005', 'PAT-009', 'PAT-011'] as const;
export const CONTINUATION_PATTERN_SPECIALS = ['PAT-004', 'PAT-006', 'PAT-012'] as const;
export function getCityPatternActionSupport(snapshotVersion = '1.13.0') {
  const nested = snapshotVersion === '1.14.0';
  return deepFreeze({ minimumSnapshotVersion: '1.13.0', gameplayVersions: ['base'], playerCounts: [2, 3, 4],
    declarationPatternIds: ['PAT-001', 'PAT-002', 'PAT-003', 'PAT-004', 'PAT-005', 'PAT-006', 'PAT-008', 'PAT-009', 'PAT-010', 'PAT-011', 'PAT-012', 'PAT-014', ...(nested ? ['PAT-013'] : [])],
    specialActionPatternIds: [...IMPLEMENTED_PATTERN_SPECIALS, ...(nested ? CONTINUATION_PATTERN_SPECIALS : [])] as string[],
    continuationSnapshotVersion: '1.14.0', allPatternActionsImplemented: false });
}
export function resetCityPatternsForCleanup(state: z.infer<typeof gameStateSchema>): void {
  if (!state.cityPatterns) return;
  for (const track of state.cityPatterns.useTracks) {
    const pattern = getCityPattern(track.patternId);
    // Level II has a lifetime limit; cleanup clears the cooldown, never replenishes uses.
    if (pattern.level === 1) track.remainingUses = pattern.useCapacity;
  }
  state.cityPatterns.usedSpecialActions = [];
}
