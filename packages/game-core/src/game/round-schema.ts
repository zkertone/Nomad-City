import { z } from 'zod';
import { deepFreeze } from '../board/hash.js';

/** Project IDs, not printed card numbers. Only the five initial BASE roles, rulebook p03/p14. */
export const FOUNDERS_BASE_ROLES = deepFreeze([
  { id: 'ROLE-01', name: '雷蛇' }, { id: 'ROLE-02', name: '极境' }, { id: 'ROLE-03', name: '德克萨斯' },
  { id: 'ROLE-04', name: '坎诺特' }, { id: 'ROLE-05', name: '锡人' },
] as const);
export const ROUND_RULE_SOURCE = deepFreeze({
  rulebookSha256: '6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42',
  printedPages: [3, 4, 5, 8, 10, 11, 14, 23], roleEffectsImplemented: false,
});
export const baseRoleIdSchema = z.enum(['ROLE-01', 'ROLE-02', 'ROLE-03', 'ROLE-04', 'ROLE-05']);
const roleIds = z.array(baseRoleIdSchema).max(5);
export const roundFlowSchema = z.strictObject({
  roundNumber: z.number().int().min(1).max(8),
  stage: z.enum(['role-removal', 'role-placement', 'player-actions', 'harvest', 'cleanup', 'finished']),
  supplyRemovalCount: z.number().int().min(0).max(2),
  rolePlacementCount: z.number().int().min(0).max(4),
  turnIndex: z.number().int().min(0).max(8),
  majorActionOpened: z.boolean(),
  rolesByPlayer: z.array(z.strictObject({
    playerId: z.string().min(1), hand: roleIds, discarded: roleIds, placed: baseRoleIdSchema.nullable(),
    // Reference to a card in discarded, not an additional physical card zone. Absent in 1.7.0.
    used: z.strictObject({ roleId: baseRoleIdSchema, mode: z.enum(['strategy', 'scheme', 'both']), turnIndex: z.number().int().min(0).max(7),
      cleanupResolved: z.boolean().optional(),
    }).nullable().optional(),
  })).min(2).max(4),
});
