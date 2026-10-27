import {
  deepFreeze,
  getFoundersEventCard,
  getLegalEntryInfluenceSlotIds,
  getLegalInitialNodeIds,
} from "@nomad-city-online/game-core";
import type { EventEffect, GameState } from "@nomad-city-online/game-core";
import type { RoomSnapshot } from "./room-state.js";

export interface EntryOptions {
  readonly actorId: string;
  readonly status: NonNullable<GameState["entry"]>["status"];
  readonly nodeIds: readonly string[];
  readonly event: {
    readonly cardId: string;
    readonly title: string;
    readonly description: string;
    readonly choices: readonly {
      readonly id: string;
      readonly narration: string;
      readonly effects: readonly EventEffect[];
    }[];
  } | null;
  readonly influenceSlotIds: readonly string[];
  readonly canDeclineInfluence: boolean;
}
export type EntryOptionsResult =
  | {
      readonly status: "ready";
      readonly roomId: string;
      readonly gameId: string;
      readonly stateVersion: number;
      readonly options: EntryOptions | null;
    }
  | {
      readonly status: "unavailable";
      readonly error: {
        readonly code: "ROOM_UNAVAILABLE" | "STORAGE_UNAVAILABLE";
      };
    };
/** Read-only legal choices for the current entry actor, using the original rule helpers. */
export function getRoomEntryOptions(
  snapshot: RoomSnapshot,
  playerId: string,
): EntryOptionsResult {
  const { state, definition } = snapshot,
    entry = state.entry;
  const actorId =
    entry?.status === "bonus-influence"
      ? entry.playerOrder[1]
      : entry?.playerOrder[entry.completedPlayerCount];
  const acting = entry && entry.status !== "complete" && actorId === playerId;
  const card =
    acting && entry.pendingEvent
      ? getFoundersEventCard(entry.pendingEvent.cardId)
      : null;
  return deepFreeze({
    status: "ready",
    roomId: snapshot.roomId,
    gameId: state.gameId,
    stateVersion: state.stateVersion,
    options: !acting
      ? null
      : {
          actorId: playerId,
          status: entry.status,
          nodeIds: getLegalInitialNodeIds(state, definition, playerId),
          event: card
            ? {
                cardId: card.id,
                title: card.title,
                description: card.description,
                choices: card.choices.map((c) => ({
                  id: c.id,
                  narration: c.narration,
                  effects: c.effects.map((effect) => ({ ...effect })),
                })),
              }
            : null,
          influenceSlotIds: getLegalEntryInfluenceSlotIds(
            state,
            definition,
            playerId,
          ),
          canDeclineInfluence: entry.status === "bonus-influence",
        },
  });
}
