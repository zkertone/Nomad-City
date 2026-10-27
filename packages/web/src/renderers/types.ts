import type {
  BoardDefinition,
  GamePlayerView,
} from "@nomad-city-online/game-core";

export type BoardRendererId = "2d" | "2.5d";
/** Presentation-local selection; stable domain IDs, never a second authoritative board. */
export type BoardIntent =
  | { readonly type: "select-node"; readonly nodeId: string }
  | { readonly type: "select-route"; readonly routeId: string }
  | { readonly type: "select-slot"; readonly slotId: string };
export interface BoardPresentationProps {
  readonly board: BoardDefinition | null;
  readonly view: GamePlayerView;
  readonly targets: {
    readonly nodeIds: readonly string[];
    readonly routeIds: readonly string[];
    readonly slotIds: readonly string[];
  };
  readonly selectedNodeId: string | null;
  readonly selectedSlotId?: string | null;
  readonly sourceSlotId?: string | null;
  readonly disabled: boolean;
  readonly onIntent: (intent: BoardIntent) => void;
}
