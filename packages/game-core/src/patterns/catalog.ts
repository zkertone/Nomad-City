import { createHash, randomInt } from 'node:crypto';
import data from './catalog.json' with { type: 'json' };
import { deepFreeze } from '../board/hash.js';
import { cityPatternCatalogSchema, gameplayVersionSchema } from './schema.js';
import type { CityPatternCatalog, CityPattern, GameplayVersion } from './schema.js';

export const CITY_PATTERNS_HASH = 'sha256:f18485ebafb5bb04792c2804428a095c81ee9a2052b34cfc54d7583053041e33';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  const result = JSON.stringify(value); if (result === undefined) throw new TypeError('Pattern catalog requires JSON values'); return result;
}
export function computeCityPatternCatalogHash(input: CityPatternCatalog | Omit<CityPatternCatalog, 'contentHash'>): string {
  const { contentHash: _ignored, ...catalog } = input as CityPatternCatalog;
  return `sha256:${createHash('sha256').update(canonical({ hashProtocol: 'nco-city-patterns-c14n-v1', catalog }), 'utf8').digest('hex')}`;
}
export function validateCityPatternCatalog(input: unknown) {
  const parsed = cityPatternCatalogSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const hash = computeCityPatternCatalogHash(parsed.data), issues: string[] = [];
  if (hash !== parsed.data.contentHash) issues.push('Pattern catalog self hash mismatch');
  if (hash !== CITY_PATTERNS_HASH) issues.push('Pattern catalog differs from pinned source reading');
  return issues.length ? { success: false as const, issues } : { success: true as const, data: deepFreeze(parsed.data) };
}
export function parseCityPatternCatalog(input: unknown): CityPatternCatalog {
  const result = validateCityPatternCatalog(input);
  if (!result.success) throw new Error(`Invalid city patterns: ${result.issues.join('; ')}`);
  return result.data;
}
export const CITY_PATTERNS = parseCityPatternCatalog(data);
export function getCityPattern(id: string): CityPattern {
  const pattern = CITY_PATTERNS.patterns.find(row => row.id === id);
  if (!pattern) throw new RangeError(`Unknown city pattern: ${id}`);
  return pattern;
}
export function getEligibleCityPatterns(version: GameplayVersion, playerCount: number): readonly CityPattern[] {
  gameplayVersionSchema.parse(version);
  if (![2, 3, 4].includes(playerCount)) throw new RangeError('Pattern player count must be 2, 3 or 4');
  const rank = { base: 0, enterprise: 1, entrepreneur: 2 };
  // Eligibility is only this module's card/dependency filter, not a promise that a whole ruleset is executable.
  return deepFreeze(CITY_PATTERNS.patterns.filter(pattern => rank[pattern.minimumGameplayVersion] <= rank[version]));
}
/** Trusted setup only: choose four level-I and two level-II public patterns. No player submits this order. */
export function selectCityPatterns(version: GameplayVersion, playerCount: number, order?: readonly string[]) {
  const eligible = getEligibleCityPatterns(version, playerCount), eligibleIds = eligible.map(pattern => pattern.id);
  if (order !== undefined && (order.length !== eligibleIds.length || new Set(order).size !== order.length || order.some(id => !eligibleIds.includes(id)))) throw new Error('Pattern order must be an exact eligible-card permutation');
  const ids = [...(order ?? eligibleIds)];
  if (order === undefined) for (let i = ids.length - 1; i > 0; i--) { const j = randomInt(i + 1); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  return deepFreeze([...ids.filter(id => getCityPattern(id).level === 1).slice(0, 4), ...ids.filter(id => getCityPattern(id).level === 2).slice(0, 2)]);
}
export function getCityPatternSupport() {
  return deepFreeze({ transcribedPatterns: 15, flavors: 15, matchingImplemented: true, declarationPreviewImplemented: true,
    authoritativeDeclarationsImplemented: false, specialActionsImplemented: false, sourceHash: CITY_PATTERNS_HASH });
}
