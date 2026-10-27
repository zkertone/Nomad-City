import { Board2D } from "./Board2D.js";
import type { BoardPresentationProps } from "./types.js";

export const IMPLEMENTED_BOARD_RENDERERS = ["2d"] as const;
/** Add the modeled renderer only when it meets the same projection and intent contract. */
export function BoardRenderer(
  props: BoardPresentationProps & {
    readonly mode: (typeof IMPLEMENTED_BOARD_RENDERERS)[number];
  },
) {
  return <Board2D {...props} />;
}
