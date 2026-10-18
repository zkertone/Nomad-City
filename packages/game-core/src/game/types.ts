import type { z } from 'zod';
import type {
  gameDefinitionSchema, gameStateSchema, gamePositionSchema, playerSetupSchema,
  resourceBalancesSchema, resourceCostSchema,
} from './schema.js';

export type DeepReadonly<T> = T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;
export type PlayerSetup = DeepReadonly<z.infer<typeof playerSetupSchema>>;
export type ResourceBalances = DeepReadonly<z.infer<typeof resourceBalancesSchema>>;
export type ResourceCost = DeepReadonly<z.infer<typeof resourceCostSchema>>;
export type GameDefinition = DeepReadonly<z.infer<typeof gameDefinitionSchema>>;
export type GamePosition = DeepReadonly<z.infer<typeof gamePositionSchema>>;
export type GameState = DeepReadonly<z.infer<typeof gameStateSchema>>;
export type EntryProgress = NonNullable<GameState['entry']>;
export type ExplorationProgress = NonNullable<GameState['exploration']>;
export type CityMoveProgress = NonNullable<GameState['cityMove']>;
export type InfluenceActionProgress = NonNullable<GameState['influenceAction']>;
export type EventDeckState = NonNullable<GameState['eventDecks']>;
export type MarkerLocation =
  | { readonly kind: 'supply'; readonly playerId: string }
  | { readonly kind: 'score'; readonly playerId: string }
  | { readonly kind: 'board-slot'; readonly slotId: string };
export interface MarkerLedgerEntry {
  readonly markerId: string;
  readonly ownerPlayerId: string;
  readonly location: MarkerLocation;
}

export type HarvestPlan = NonNullable<NonNullable<GameState['harvest']>['plansByPlayer'][string]>;
