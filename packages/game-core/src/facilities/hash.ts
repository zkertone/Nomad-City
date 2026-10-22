import { createHash } from 'node:crypto';
import type { FacilityColorCountsCatalog, UnsignedFacilityColorCountsCatalog } from './types.js';
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Facility color hash requires JSON values');
  return json;
}
export function canonicalFacilityColorCountsContent(input: FacilityColorCountsCatalog | UnsignedFacilityColorCountsCatalog): string {
  const { contentHash: _ignored, ...catalog } = input as FacilityColorCountsCatalog;
  return canonicalize({ hashProtocol: 'nco-facility-colors-c14n-v1', catalog: {
    ...catalog, facilities: [...catalog.facilities].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  } });
}
export function computeFacilityColorCountsHash(input: FacilityColorCountsCatalog | UnsignedFacilityColorCountsCatalog): string {
  return `sha256:${createHash('sha256').update(canonicalFacilityColorCountsContent(input), 'utf8').digest('hex')}`;
}
