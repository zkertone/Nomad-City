import {
  applyRoundCommand,
  deepFreeze,
  FOUNDERS_BASE_ROLES,
  getFacilityEffectText,
  getFacilityExecutionFace,
  getFacilityPhysicalCard,
  getRoundTurn,
  RoundFlowError,
} from "@nomad-city-online/game-core";
import type {
  FacilityFaceTranscription,
  FacilityPhysicalCard,
} from "@nomad-city-online/game-core";
import type { RoomSnapshot } from "./room-state.js";
import { automaticProgress } from "./automatic-lifecycle.js";

export interface RoundSupplyChoice {
  readonly cardId: string;
  readonly facilityId: string;
  readonly name: string;
  readonly color: FacilityPhysicalCard["color"];
  readonly score: number;
  readonly effect: string;
  readonly constructionCost: FacilityFaceTranscription["constructionCost"];
  readonly legal: boolean;
  readonly blockedBy: string | null;
}
export type RoundSetupOptions =
  | {
      readonly stage: "role-removal";
      readonly actorId: string;
      readonly cards: readonly RoundSupplyChoice[];
    }
  | {
      readonly stage: "role-placement";
      readonly actorId: string;
      readonly recoversDiscard: boolean;
      readonly roles: readonly {
        readonly roleId: string;
        readonly name: string;
        readonly legal: boolean;
        readonly blockedBy: string | null;
      }[];
    };
export type RoundSetupOptionsResult =
  | {
      readonly status: "ready";
      readonly roomId: string;
      readonly gameId: string;
      readonly stateVersion: number;
      readonly blockedReason: "AUTOMATION_PENDING" | null;
      readonly options: RoundSetupOptions | null;
    }
  | {
      readonly status: "unavailable";
      readonly error: {
        readonly code: "ROOM_UNAVAILABLE" | "STORAGE_UNAVAILABLE";
      };
    };

/** Probe the original pure reducer. Candidate states are discarded and never exposed or persisted. */
function blockedBy(
  snapshot: RoomSnapshot,
  playerId: string,
  command: Record<string, unknown>,
): string | null {
  try {
    applyRoundCommand(
      snapshot.state,
      snapshot.definition,
      { authenticatedPlayerId: playerId },
      {
        gameId: snapshot.state.gameId,
        expectedVersion: snapshot.state.stateVersion,
        ...command,
      },
    );
    return null;
  } catch (error) {
    if (error instanceof RoundFlowError) return error.code;
    throw error;
  }
}
export function getRoomRoundSetupOptions(
  snapshot: RoomSnapshot,
  playerId: string,
): RoundSetupOptionsResult {
  const { state, definition } = snapshot,
    flow = state.roundFlow;
  const pending = automaticProgress(snapshot)?.status === "pending";
  let options: RoundSetupOptions | null = null;
  const turn = flow ? getRoundTurn(state, definition) : null;
  const ownRole = flow?.rolesByPlayer.find(role => role.playerId === playerId);
  if (
    !pending &&
    flow &&
    state.phase === "round-control" &&
    ["role-removal", "role-placement"].includes(turn!.stage) &&
    (turn!.stage === "role-removal" ? turn!.actorId === playerId : !!ownRole && ownRole.placed === null && !ownRole.used)
  ) {
    if (turn!.stage === "role-removal") {
      options = {
        stage: "role-removal",
        actorId: playerId,
        cards: state.facilities!.supply.supply.map((cardId) => {
          const card = getFacilityPhysicalCard(cardId),
            face = getFacilityExecutionFace(card.facilityId);
          const reason = blockedBy(snapshot, playerId, {
            type: "remove-round-supply-card",
            cardId,
          });
          const cost = face.constructionCost;
          return {
            cardId,
            facilityId: card.facilityId,
            name: face.name,
            color: card.color,
            score: face.printedScore,
            effect: getFacilityEffectText(card.facilityId),
            constructionCost:
              cost.kind === "not-printed"
                ? { kind: cost.kind }
                : {
                    kind: cost.kind,
                    resourcePayment: { ...cost.resourcePayment },
                    voucherPayment: cost.voucherPayment,
                  },
            legal: reason === null,
            blockedBy: reason,
          };
        }),
      };
    } else {
      const own = flow.rolesByPlayer.find(
        (role) => role.playerId === playerId,
      )!;
      options = {
        stage: "role-placement",
        actorId: playerId,
        recoversDiscard: own.hand.length === 0,
        roles: FOUNDERS_BASE_ROLES.flatMap((role) => {
          const reason = blockedBy(snapshot, playerId, {
            type: "place-round-role",
            roleId: role.id,
          });
          return reason === "ROLE_NOT_IN_HAND"
            ? []
            : [
                {
                  roleId: role.id,
                  name: role.name,
                  legal: reason === null,
                  blockedBy: reason,
                },
              ];
        }),
      };
    }
  }
  return deepFreeze({
    status: "ready",
    roomId: snapshot.roomId,
    gameId: state.gameId,
    stateVersion: state.stateVersion,
    blockedReason: pending ? "AUTOMATION_PENDING" : null,
    options,
  });
}
