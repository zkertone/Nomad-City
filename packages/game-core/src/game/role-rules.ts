import { deepFreeze } from '../board/hash.js';

/** Only complete, implemented modes. This is an execution capability boundary, not an official restriction. */
export const BASE_ROLE_EFFECT_SUPPORT = deepFreeze([
  { roleId: 'ROLE-01', strategy: true, scheme: true },
  { roleId: 'ROLE-02', strategy: true, scheme: true },
  { roleId: 'ROLE-03', strategy: true, scheme: true },
  { roleId: 'ROLE-04', strategy: true, scheme: true },
  { roleId: 'ROLE-05', strategy: true, scheme: true },
] as const);
export type BaseRoleMode = 'strategy' | 'scheme' | 'both';
export function isBaseRoleModeSupported(roleId: string, mode: BaseRoleMode): boolean {
  const support = BASE_ROLE_EFFECT_SUPPORT.find(row => row.roleId === roleId);
  return !!support && (mode !== 'scheme' ? support.strategy : true) && (mode !== 'strategy' ? support.scheme : true);
}
export function getBaseRoleEffectSupport() {
  return deepFreeze({ roles: BASE_ROLE_EFFECT_SUPPORT, supportedModeCount: 10, allBaseRoleEffectsImplemented: true,
    liskarmMinimumSnapshotVersion: '1.9.0', remainingSchemesMinimumSnapshotVersion: '1.10.0',
    source: { rulebookSha256: '6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42', printedPages: [8, 11, 13, 14] } });
}

/** Capabilities and saved-use records are version gated; an older snapshot never acquires new history. */
export function isBaseRoleModeAvailableInFormat(roleId: string, mode: BaseRoleMode, format: string): boolean {
  if (!isBaseRoleModeSupported(roleId, mode) || !['1.8.0', '1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0'].includes(format)) return false;
  if (roleId === 'ROLE-01' && format === '1.8.0') return false;
  if (['ROLE-02', 'ROLE-03', 'ROLE-04'].includes(roleId) && mode !== 'strategy' && !['1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0'].includes(format)) return false;
  return true;
}
