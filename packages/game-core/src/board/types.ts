/** IDs are checked by the runtime schemas; all IDs are scoped to a definition. */
export type RegionId = string;
export type ResourceNodeId = string;
export type RouteId = string;
export type SlotId = string;
export type PlayerId = string;
export type MarkerId = string;
export type EvidenceId = string;
export type MapSide = 'three-player' | 'four-player';
export type EventDeckColor = 'green' | 'yellow' | 'red';

export interface RegionDefinition {
  readonly id: RegionId;
  readonly label: string;
  readonly controlRewardPoints: number;
}

export interface DefinitionRef {
  readonly definitionId: string;
  readonly definitionVersion: string;
  readonly contentHash: string;
}

export type SlotLocation =
  | { readonly kind: 'resource-node'; readonly nodeId: ResourceNodeId }
  | { readonly kind: 'route'; readonly routeId: RouteId };

export interface ResourceNodeDefinition {
  readonly id: ResourceNodeId;
  readonly regionId: RegionId;
  readonly eventDeckColor: EventDeckColor;
  readonly redRestricted: boolean;
  readonly initialCityEligible: boolean;
  readonly influenceSlotIds: readonly SlotId[];
  readonly sourceRefs: readonly EvidenceId[];
}

export interface RouteDefinition {
  readonly id: RouteId;
  readonly regionId: RegionId;
  readonly incidentNodeIds: readonly ResourceNodeId[];
  readonly influenceSlotIds: readonly SlotId[];
  readonly sourceRefs: readonly EvidenceId[];
}

export interface BoardDefinition extends DefinitionRef {
  readonly schemaVersion: string;
  readonly mapSide: MapSide;
  readonly regions: Readonly<Record<RegionId, RegionDefinition>>;
  readonly resourceNodes: Readonly<Record<ResourceNodeId, ResourceNodeDefinition>>;
  readonly routes: Readonly<Record<RouteId, RouteDefinition>>;
  readonly influenceSlots: Readonly<Record<SlotId, SlotLocation>>;
  readonly sourceRefs: readonly EvidenceId[];
}

export type UnsignedBoardDefinition = Omit<BoardDefinition, 'contentHash'>;

export interface RevealedResourceMarker {
  readonly markerDefinitionId: string;
  readonly resourceKind: 'orirock' | 'originium' | 'iron';
  readonly harvestAmount: 1 | 2;
}

export interface InfluenceMarker {
  readonly ownerPlayerId: PlayerId;
  readonly markerId: MarkerId;
}

/** No balances, player count rules, renderer coordinates or action permissions. */
export interface BoardState {
  readonly definitionRef: DefinitionRef;
  readonly resourceMarkerByNode: Readonly<Record<ResourceNodeId, RevealedResourceMarker | null>>;
  readonly influenceBySlot: Readonly<Record<SlotId, InfluenceMarker | null>>;
  readonly cityNodeByPlayer: Readonly<Record<PlayerId, ResourceNodeId | null>>;
}

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };
