import { deepFreeze } from '../board/hash.js';

/** Only complete, implemented modes. This is an execution capability boundary, not an official restriction. */
export const BASE_ROLE_EFFECT_SUPPORT = deepFreeze([
  { roleId: 'ROLE-01', strategy: false, scheme: false },
  { roleId: 'ROLE-02', strategy: true, scheme: false },
  { roleId: 'ROLE-03', strategy: true, scheme: false },
  { roleId: 'ROLE-04', strategy: true, scheme: false },
  { roleId: 'ROLE-05', strategy: true, scheme: true },
] as const);
export type BaseRoleMode = 'strategy' | 'scheme' | 'both';
export function isBaseRoleModeSupported(roleId: string, mode: BaseRoleMode): boolean {
  const support = BASE_ROLE_EFFECT_SUPPORT.find(row => row.roleId === roleId);
  return !!support && (mode !== 'scheme' ? support.strategy : true) && (mode !== 'strategy' ? support.scheme : true);
}
export function getBaseRoleEffectSupport() {
  return deepFreeze({ roles: BASE_ROLE_EFFECT_SUPPORT, supportedModeCount: 5, allBaseRoleEffectsImplemented: false,
    source: { rulebookSha256: '6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42', printedPages: [8, 11, 13, 14] } });
}
