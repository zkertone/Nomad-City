import data from './founders-color-counts.json' with { type: 'json' };
import { deepFreeze } from '../board/hash.js';
import { facilityColorCountsCatalogSchema } from './schema.js';
import { computeFacilityColorCountsHash } from './hash.js';
import type { FacilityColorCountsCatalog, FacilityColorCountRecord } from './types.js';

// Fixed independently of the contentHash supplied by the imported JSON.
export const FOUNDERS_FACILITY_COLOR_COUNTS_HASH = 'sha256:935420d88b603f20333ef399c4968f98e72ab30c41d715cf145f1380889b5e7d';
export type FacilityColorCountsValidationResult =
  | { readonly success: true; readonly catalog: FacilityColorCountsCatalog }
  | { readonly success: false; readonly issues: readonly string[] };
export function validateFoundersFacilityColorCounts(input: unknown): FacilityColorCountsValidationResult {
  const parsed = facilityColorCountsCatalogSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) };
  const actual = computeFacilityColorCountsHash(parsed.data);
  const issues: string[] = [];
  if (actual !== parsed.data.contentHash) issues.push('Facility color counts hash mismatch');
  if (actual !== FOUNDERS_FACILITY_COLOR_COUNTS_HASH) issues.push('Facility color counts differ from user-reported baseline');
  return issues.length ? { success: false, issues } : { success: true, catalog: deepFreeze(parsed.data) };
}
export function parseFoundersFacilityColorCounts(input: unknown): FacilityColorCountsCatalog {
  const result = validateFoundersFacilityColorCounts(input);
  if (!result.success) throw new Error(`Invalid facility color counts: ${result.issues.join('; ')}`);
  return result.catalog;
}
export const FOUNDERS_FACILITY_COLOR_COUNTS: FacilityColorCountsCatalog = parseFoundersFacilityColorCounts(data);
/** FAC IDs are project identifiers, not official printed card numbers. */
export function getFoundersFacilityColorCountRecord(id: string): FacilityColorCountRecord {
  const facility = FOUNDERS_FACILITY_COLOR_COUNTS.facilities.find(item => item.id === id);
  if (!facility) throw new RangeError(`Unknown reported facility count record: ${id}`);
  return facility;
}
