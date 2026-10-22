import type { z } from 'zod';
import type { facilityColorCountsSchema, facilityColorCountRecordSchema, facilityColorCountsCatalogSchema } from './schema.js';
import type { DeepReadonly } from '../game/types.js';
export type FacilityColorCounts = DeepReadonly<z.infer<typeof facilityColorCountsSchema>>;
export type FacilityColorCountRecord = DeepReadonly<z.infer<typeof facilityColorCountRecordSchema>>;
export type FacilityColorCountsCatalog = DeepReadonly<z.infer<typeof facilityColorCountsCatalogSchema>>;
export type UnsignedFacilityColorCountsCatalog = Omit<FacilityColorCountsCatalog, 'contentHash'>;
