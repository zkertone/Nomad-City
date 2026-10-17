import { createHash } from 'node:crypto';
import type { EventCatalog, UnsignedEventCatalog } from './types.js';

/** Unlike the board ID-set protocol, event card/choice/effect arrays retain order. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Catalog hash requires JSON values');
  return json;
}

export function canonicalEventCatalogContent(catalog: EventCatalog | UnsignedEventCatalog): string {
  const { contentHash: _ignored, ...content } = catalog as EventCatalog;
  return canonicalize({ hashProtocol: 'nco-events-c14n-v1', catalog: content });
}

export function computeEventCatalogHash(catalog: EventCatalog | UnsignedEventCatalog): string {
  return `sha256:${createHash('sha256').update(canonicalEventCatalogContent(catalog), 'utf8').digest('hex')}`;
}
