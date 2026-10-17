import type { z } from 'zod';
import type {
  eventCardDefinitionSchema, eventChoiceSchema, eventColorSchema,
  eventEffectSchema, foundersEventCatalogSchema,
} from './schema.js';

export type EventColor = z.infer<typeof eventColorSchema>;
export type EventEffect = z.infer<typeof eventEffectSchema>;
export type EventChoice = z.infer<typeof eventChoiceSchema>;
export type EventCardDefinition = z.infer<typeof eventCardDefinitionSchema>;
export type EventCatalog = z.infer<typeof foundersEventCatalogSchema>;
export type UnsignedEventCatalog = Omit<EventCatalog, 'contentHash'>;
