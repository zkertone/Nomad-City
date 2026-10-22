import { createHash } from 'node:crypto';
import type { FacilityFacesCatalog, UnsignedFacilityFacesCatalog } from './faces-schema.js';

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Facility face hash requires JSON values');
  return json;
}
/** Hash all fields except contentHash. Source/facility sets sort by ID, the icon legend by icon; other arrays retain order. */
export function canonicalFacilityFacesContent(input: FacilityFacesCatalog | UnsignedFacilityFacesCatalog): string {
  const { contentHash: _ignored, ...catalog } = input as FacilityFacesCatalog;
  const byId = (a: { readonly id: string }, b: { readonly id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return canonicalize({ hashProtocol: 'nco-facility-faces-c14n-v2', catalog: {
    ...catalog, sources: [...catalog.sources].sort(byId), textSources: [...catalog.textSources].sort(byId),
    iconLegend: [...catalog.iconLegend].sort((a, b) => byId({ id: a.icon }, { id: b.icon })),
    facilities: [...catalog.facilities].sort(byId),
  } });
}
export function computeFacilityFacesHash(input: FacilityFacesCatalog | UnsignedFacilityFacesCatalog): string {
  return `sha256:${createHash('sha256').update(canonicalFacilityFacesContent(input), 'utf8').digest('hex')}`;
}
