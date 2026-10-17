import data from './founders-base.json' with { type: 'json' };
import { computeEventCatalogHash } from './hash.js';
import { foundersEventCatalogSchema } from './schema.js';
import type { EventCardDefinition, EventCatalog, EventColor } from './types.js';

// Approval baseline is fixed separately from the supplied data and its claimed hash.
export const FOUNDERS_EVENT_CATALOG_HASH =
  'sha256:aada5d9e8cb65c18897fca37eb0935e1cc4d38e848aab4fa6f3e64031d8e2ca7';

export type EventCatalogValidationResult =
  | { readonly success: true; readonly catalog: EventCatalog }
  | { readonly success: false; readonly issues: readonly string[] };

/** Validates the approved base catalog, never executes an event or authorizes an action. */
export function validateFoundersEventCatalog(input: unknown): EventCatalogValidationResult {
  const result = foundersEventCatalogSchema.safeParse(input);
  if (!result.success) {
    return { success: false, issues: result.error.issues.map(issue =>
      `${issue.path.join('.')}: ${issue.message}`) };
  }
  const actual = computeEventCatalogHash(result.data);
  const issues: string[] = [];
  if (actual !== result.data.contentHash) issues.push('Catalog content hash mismatch');
  if (actual !== FOUNDERS_EVENT_CATALOG_HASH) issues.push('Catalog differs from approved baseline');
  return issues.length ? { success: false, issues } : { success: true, catalog: result.data };
}

export function parseFoundersEventCatalog(input: unknown): EventCatalog {
  const result = validateFoundersEventCatalog(input);
  if (!result.success) throw new Error(`Invalid founders event catalog: ${result.issues.join('; ')}`);
  return result.catalog;
}

export const FOUNDERS_EVENT_CATALOG: EventCatalog = parseFoundersEventCatalog(data);

export function getFoundersEventCard(id: string): EventCardDefinition {
  const card = FOUNDERS_EVENT_CATALOG.cards.find(item => item.id === id);
  if (!card) throw new RangeError(`Unknown base event card: ${id}`);
  return card;
}

/** Color lookup only. Player-count eligibility belongs to the future rule/setup module. */
export function getFoundersEventCards(color: EventColor): readonly EventCardDefinition[] {
  return Object.freeze(FOUNDERS_EVENT_CATALOG.cards.filter(card => card.color === color));
}
