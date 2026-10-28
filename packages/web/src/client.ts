import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { GamePlayerView, ExplorationPlayerCommand, CityMovePlayerCommand, ExplorationPathStep } from "@nomad-city-online/game-core";
import type {
  EntryOptionsResult,
  ActionOptionsResult,
  ExplorationRouteResult,
  ConstructionDraft, ConstructionPreviewResult, QuickDraft, QuickPreviewResult, HarvestDraft, HarvestPreviewResult, HarvestOptionsResult,
  LobbyView,
  RoomSummary,
  RoundSetupOptionsResult,
} from "@nomad-city-online/server";

export type RoundPreparationCommand =
  | { readonly type: "remove-round-supply-card"; readonly cardId: string }
  | { readonly type: "place-round-role"; readonly roleId: string };

export type MajorActionCommand =
  | { readonly type: "choose-major-action"; readonly action: "deploy" | "dispatch" | "explore" | "city-move" | "construct" }
  | { readonly type: "cancel-major-preparation" | "finish-player-turn" | "finish-pattern-action" };
export type InfluenceCommand =
  | { readonly type: "deploy-influence"; readonly slotId: string }
  | { readonly type: "dispatch-influence"; readonly sourceSlotId: string; readonly targetSlotId: string }
  | { readonly type: "finish-dispatch" };

type WithoutEnvelope<T> = T extends unknown ? Omit<T, "gameId" | "expectedVersion"> : never;
export type ExplorationCommand = WithoutEnvelope<ExplorationPlayerCommand>;
export type CityMoveCommand = WithoutEnvelope<CityMovePlayerCommand>;

export type ClientSnapshot = {
  connected: boolean;
  userId: string | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  lobbies: readonly LobbyView[];
  rooms: readonly RoomSummary[];
  lobby: LobbyView | null;
  roomId: string | null;
  game: GamePlayerView | null;
  entry: Extract<EntryOptionsResult, { status: "ready" }> | null;
  roundSetup: Extract<RoundSetupOptionsResult, { status: "ready" }> | null;
  actionOptions: Extract<ActionOptionsResult, { status: "ready" }> | null;
  harvestOptions: Extract<HarvestOptionsResult, { status: "ready" }> | null;
  inviteToken: string | null;
};
export const emptyClient = (): ClientSnapshot => ({
  connected: false,
  userId: null,
  busy: false,
  error: null,
  notice: null,
  lobbies: [],
  rooms: [],
  lobby: null,
  roomId: null,
  game: null,
  entry: null,
  roundSetup: null, actionOptions: null, harvestOptions: null,
  inviteToken: null,
});
const messages: Record<string, string> = {
  STALE_VERSION: "局面已有更新，请确认最新状态后再操作。",
  COMMIT_CONFLICT: "房间刚刚发生变化，请刷新后重试。",
  NOT_READY: "请等待全员准备。",
  NOT_CONFIGURED: "请先由房主确认先手与顺时针顺序。",
  INVALID_SETUP: "先手与顺序需要包含所有成员且不能重复。",
  OWNER_REQUIRED: "这项操作需要房主完成。",
  LOBBY_UNAVAILABLE: "无法进入大厅，请检查大厅编号与邀请凭证。",
  LOBBY_FULL: "大厅已满员。",
  LOBBY_CLOSED: "大厅已开始或已取消。",
  ROOM_UNAVAILABLE: "无法进入这场对局。",
  AUTH_REQUIRED: "会话已失效，请重新选择本地测试身份。",
  AUTH_UNAVAILABLE: "暂时无法验证会话，请稍后重试。",
  TIMEOUT: "请求未收到确认。请刷新状态，确认结果后再操作。",
  ROLE_ALREADY_PLACED: "本回合已经盖放角色，请等待其余玩家确认。",
  WRONG_ACTOR: "请等待当前玩家完成选择。",
};
export function errorMessage(code: string): string {
  return messages[code] ?? "操作未完成，请刷新状态后重试。";
}
export function newerLobby(
  current: LobbyView | null,
  next: LobbyView,
): LobbyView {
  return current?.lobbyId === next.lobbyId && current.version >= next.version
    ? current
    : next;
}
export function newerGame(
  current: GamePlayerView | null,
  next: GamePlayerView,
): GamePlayerView {
  return current?.public.gameId === next.public.gameId &&
    current.public.stateVersion >= next.public.stateVersion
    ? current
    : next;
}
type Result = {
  status: string;
  view?: LobbyView;
  inviteToken?: string;
  lobbies?: LobbyView[];
  rooms?: RoomSummary[];
  nextAfterLobbyId?: string | null;
  nextAfterRoomId?: string | null;
};
export class CityClient {
  private state = emptyClient();
  private listeners = new Set<() => void>();
  private socket: Socket | null = null;
  private epoch = 0;
  private activeRun: { epoch: number; promise: Promise<void> } | null = null;
  constructor(
    private readonly storage: Pick<
      Storage,
      "getItem" | "setItem" | "removeItem"
    >,
    private readonly makeSocket: (token: string) => Socket = (token) =>
      io("/game", {
        autoConnect: false,
        transports: ["websocket"],
        auth: { protocolVersion: "1.0.0", sessionToken: token },
      }),
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(changes: Partial<ClientSnapshot>) {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener();
  }
  private clear(message?: string) {
    this.epoch++;
    this.activeRun = null;
    this.socket?.disconnect();
    this.socket = null;
    for (const key of [
      "nco.local.session",
      "nco.local.lobby",
      "nco.local.room",
    ])
      this.storage.removeItem(key);
    this.state = { ...emptyClient(), ...(message ? { error: message } : {}) };
    for (const listener of this.listeners) listener();
  }
  dispose() {
    this.clear();
    this.listeners.clear();
  }
  resume() {
    const token = this.storage.getItem("nco.local.session");
    if (token) this.connect(token);
  }
  async fixture(fixtureId: number) {
    this.clear();
    const epoch = this.epoch;
    this.patch({ busy: true });
    try {
      const response = await fetch("/__local/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureId }),
      });
      if (!response.ok) throw Error("AUTH_UNAVAILABLE");
      const session = (await response.json()) as { token: string };
      if (epoch === this.epoch) this.connect(session.token);
    } catch {
      if (epoch === this.epoch)
        this.patch({
          busy: false,
          error: "本地测试身份暂时不可用，请检查本地服务。",
        });
    }
  }
  private connect(token: string) {
    this.storage.setItem("nco.local.session", token);
    const epoch = ++this.epoch,
      socket = this.makeSocket(token);
    this.socket = socket;
    socket.on("connect", () => {
      if (epoch === this.epoch)
        void this.run(async () => {
          const session = await this.rpc<{ userId: string }>(
            "session:current",
            {},
          );
          this.patch({ connected: true, userId: session.userId });
          await this.refresh();
          const lobbyId = this.storage.getItem("nco.local.lobby"),
            roomId = this.storage.getItem("nco.local.room");
          if (lobbyId) await this.openLobby(lobbyId);
          if (roomId) await this.openRoom(roomId);
        });
    });
    socket.on("disconnect", () => {
      if (epoch === this.epoch)
        this.patch({
          connected: false,
          game: null,
          entry: null,
          roundSetup: null, actionOptions: null, harvestOptions: null,
          lobby: null,
          inviteToken: null,
          notice: "连接中断，正在重连…",
        });
    });
    socket.on("connect_error", () => {
      if (epoch === this.epoch)
        this.patch({
          connected: false,
          busy: false,
          error: "连接失败，请检查本地服务或重新选择测试身份。",
        });
    });
    socket.on("session:invalidated", () => {
      if (epoch === this.epoch) this.clear(errorMessage("AUTH_REQUIRED"));
    });
    socket.on("lobby:state", (event: { view: LobbyView }) => {
      if (
        epoch !== this.epoch ||
        event.view.lobbyId !== this.storage.getItem("nco.local.lobby")
      )
        return;
      this.acceptLobby(event.view);
      void this.refresh().catch(() => {});
    });
    socket.on("lobby:unavailable", (event: { lobbyId: string }) => {
      if (
        epoch === this.epoch &&
        event.lobbyId === this.storage.getItem("nco.local.lobby")
      ) {
        this.storage.removeItem("nco.local.lobby");
        this.patch({ lobby: null, inviteToken: null });
        void this.refresh().catch(() => {});
      }
    });
    socket.on(
      "room:state",
      (event: { roomId: string; view: GamePlayerView }) => {
        if (
          epoch !== this.epoch ||
          event.roomId !== this.storage.getItem("nco.local.room")
        )
          return;
        this.acceptGame(event.view);
        void this.options().catch(() => {});
      },
    );
    socket.on("room:unavailable", (event: { roomId: string }) => {
      if (
        epoch === this.epoch &&
        event.roomId === this.storage.getItem("nco.local.room")
      )
        this.patch({
          game: null,
          entry: null,
          roundSetup: null, actionOptions: null, harvestOptions: null,
          error: errorMessage("ROOM_UNAVAILABLE"),
        });
    });
    socket.connect();
  }
  private async rpc<T>(event: string, payload: unknown): Promise<T> {
    const socket = this.socket,
      epoch = this.epoch;
    if (!socket?.connected) throw Error("AUTH_REQUIRED");
    let result: {
      status?: string;
      error?: { code?: string };
      reply?: { error?: { code?: string; ruleCode?: string } };
    };
    try {
      result = await socket.timeout(5000).emitWithAck(event, payload);
    } catch {
      throw Error("TIMEOUT");
    }
    if (epoch !== this.epoch || socket !== this.socket || !socket.connected)
      throw Error("AUTH_REQUIRED");
    if (
      !result ||
      typeof result.status !== "string" ||
      result.status === "unavailable" ||
      result.status === "rejected"
    )
      throw Error(
        result?.error?.code ??
          result?.reply?.error?.ruleCode ??
          result?.reply?.error?.code ??
          "SERVER_UNAVAILABLE",
      );
    return result as T;
  }
  async run(work: () => Promise<void>) {
    const epoch = this.epoch;
    if (this.activeRun?.epoch === epoch) return this.activeRun.promise;
    const pending = { epoch, promise: Promise.resolve() };
    this.activeRun = pending;
    this.patch({ busy: true, error: null, notice: null });
    pending.promise = Promise.resolve().then(async () => {
      try { if (epoch === this.epoch) await work(); }
      catch (error) {
        if (epoch === this.epoch) this.patch({ error: errorMessage(error instanceof Error ? error.message : "") });
      } finally {
        if (this.activeRun === pending) this.activeRun = null;
        if (epoch === this.epoch) this.patch({ busy: false });
      }
    });
    return pending.promise;
  }
  private acceptLobby(view: LobbyView) {
    this.patch({ lobby: newerLobby(this.state.lobby, view) });
  }
  private acceptGame(view: GamePlayerView) {
    const next = newerGame(this.state.game, view);
    if (next !== this.state.game)
      this.patch({ game: next, entry: null, roundSetup: null, actionOptions: null, harvestOptions: null });
  }
  async refresh() {
    const epoch = this.epoch;
    const collect = async (event: "lobby:list" | "room:list") => {
      const rows: (LobbyView | RoomSummary)[] = [];
      let cursor: string | null = null;
      do {
        const result: Result = await this.rpc(event, {
          limit: 50,
          ...(cursor
            ? event === "lobby:list"
              ? { afterLobbyId: cursor }
              : { afterRoomId: cursor }
            : {}),
        });
        rows.push(...(result.lobbies ?? result.rooms ?? []));
        cursor = result.nextAfterLobbyId ?? result.nextAfterRoomId ?? null;
      } while (cursor);
      return rows;
    };
    const [lobbies, rooms] = await Promise.all([
      collect("lobby:list"),
      collect("room:list"),
    ]);
    if (epoch === this.epoch)
      this.patch({
        lobbies: lobbies as LobbyView[],
        rooms: rooms as RoomSummary[],
      });
  }
  async openLobby(lobbyId: string) {
    const previous = this.storage.getItem("nco.local.lobby");
    if (previous && previous !== lobbyId)
      await this.rpc("lobby:unsubscribe", { lobbyId: previous });
    this.storage.setItem("nco.local.lobby", lobbyId);
    this.patch({ lobby: null, inviteToken: null });
    const result = await this.rpc<Result>("lobby:subscribe", { lobbyId });
    if (result.view && this.storage.getItem("nco.local.lobby") === lobbyId)
      this.acceptLobby(result.view);
  }
  async create(playerCount: number) {
    const result = await this.rpc<Result>("lobby:create", {
      requestId: crypto.randomUUID(),
      playerCount,
    });
    if (result.view) {
      await this.openLobby(result.view.lobbyId);
      this.patch({ inviteToken: result.inviteToken ?? null });
    }
    await this.refresh();
  }
  async join(lobbyId: string, inviteToken: string) {
    await this.rpc("lobby:join", {
      lobbyId: lobbyId.trim(),
      inviteToken: inviteToken.trim(),
    });
    await this.openLobby(lobbyId.trim());
    await this.refresh();
  }
  async lobbyCommand(type: string, fields: Record<string, unknown> = {}) {
    const lobby = this.state.lobby;
    if (!lobby) return;
    const result = await this.rpc<Result>("lobby:command", {
      lobbyId: lobby.lobbyId,
      expectedVersion: lobby.version,
      type,
      ...fields,
    });
    if (this.storage.getItem("nco.local.lobby") !== lobby.lobbyId) return;
    if (
      result.view &&
      this.storage.getItem("nco.local.lobby") === lobby.lobbyId
    )
      this.acceptLobby(result.view);
    else {
      this.storage.removeItem("nco.local.lobby");
      this.patch({ lobby: null, inviteToken: null });
    }
    if (result.inviteToken) this.patch({ inviteToken: result.inviteToken });
    await this.refresh();
  }
  async openRoom(roomId: string) {
    const previous = this.storage.getItem("nco.local.room");
    if (previous && previous !== roomId)
      await this.rpc("room:unsubscribe", { roomId: previous });
    this.storage.setItem("nco.local.room", roomId);
    this.patch({ roomId, game: null, entry: null, roundSetup: null, actionOptions: null, harvestOptions: null, notice: null });
    const result = await this.rpc<{ view: GamePlayerView }>("room:subscribe", {
      roomId,
    });
    if (this.state.roomId === roomId) {
      this.acceptGame(result.view);
      await this.options();
    }
  }
  private async options() {
    const roomId = this.state.roomId;
    if (!roomId) return;
    const entryPhase = !!this.state.game?.public.entry;
    if (this.state.game?.public.finalResult) return;
    const harvestPhase = this.state.game?.public.phase === "harvest" && this.state.game.public.harvest?.status === "planning";
    const actionPhase = ["player-actions", "cleanup"].includes(this.state.game?.public.round?.stage ?? "");
    const result = await this.rpc<
      Extract<EntryOptionsResult | RoundSetupOptionsResult | ActionOptionsResult | HarvestOptionsResult, { status: "ready" }>
    >(harvestPhase ? "room:harvest-options" : entryPhase ? "room:entry-options" : actionPhase ? "room:action-options" : "room:round-setup-options", { roomId });
    if (
      this.state.roomId === result.roomId &&
      this.state.game?.public.gameId === result.gameId &&
      this.state.game.public.stateVersion === result.stateVersion
    )
      this.patch(harvestPhase
        ? { harvestOptions: result as Extract<HarvestOptionsResult, { status: "ready" }> }
        : entryPhase
        ? { entry: result as Extract<EntryOptionsResult, { status: "ready" }> }
        : actionPhase
          ? { actionOptions: result as Extract<ActionOptionsResult, { status: "ready" }> }
          : { roundSetup: result as Extract<RoundSetupOptionsResult, { status: "ready" }> });
  }

  async entryCommand(command: Record<string, unknown>) {
    return this.playerCommand("entry", command);
  }
  async roundSetupCommand(command: RoundPreparationCommand) {
    return this.playerCommand("round", command);
  }
  async majorActionCommand(command: MajorActionCommand) {
    return this.playerCommand("round", command);
  }
  async influenceCommand(command: InfluenceCommand) {
    return this.playerCommand("influence", command);
  }
  async explorationCommand(command: ExplorationCommand) {
    return this.playerCommand("exploration", command);
  }
  async cityMoveCommand(command: CityMoveCommand) {
    return this.playerCommand("city-move", command);
  }
  async explorationPreview(path: readonly ExplorationPathStep[]): Promise<Extract<ExplorationRouteResult, { status: "ready" }> | null> {
    const { game, roomId } = this.state;
    if (!game || !roomId) return null;
    const result = await this.rpc<Extract<ExplorationRouteResult, { status: "ready" }>>("room:exploration-route", {
      roomId, gameId: game.public.gameId, expectedVersion: game.public.stateVersion, path,
    });
    return this.state.roomId === result.roomId && this.state.game?.public.gameId === result.gameId &&
      this.state.game.public.stateVersion === result.stateVersion && result.stateVersion === game.public.stateVersion ? result : null;
  }
  async constructionCommand(draft: ConstructionDraft) {
    return this.playerCommand(draft.channel, draft.command);
  }
  async constructionPreview(draft: ConstructionDraft): Promise<Extract<ConstructionPreviewResult, { status: "ready" }> | null> {
    const { game, roomId } = this.state;
    if (!game || !roomId) return null;
    const result = await this.rpc<Extract<ConstructionPreviewResult, { status: "ready" }>>("room:construction-preview", {
      roomId, channel: draft.channel, command: { gameId: game.public.gameId, expectedVersion: game.public.stateVersion, ...draft.command },
    });
    return this.state.roomId === result.roomId && this.state.game?.public.gameId === result.gameId &&
      this.state.game.public.stateVersion === result.stateVersion && result.stateVersion === game.public.stateVersion ? result : null;
  }
  async harvestCommand(draft: HarvestDraft) {
    return this.playerCommand("harvest", draft);
  }
  async harvestPreview(draft: HarvestDraft): Promise<Extract<HarvestPreviewResult, { status: "ready" }> | null> {
    const { game, roomId } = this.state;
    if (!game || !roomId) return null;
    const result = await this.rpc<Extract<HarvestPreviewResult, { status: "ready" }>>("room:harvest-preview", {
      roomId, command: { gameId: game.public.gameId, expectedVersion: game.public.stateVersion, ...draft },
    });
    return this.state.roomId === result.roomId && this.state.game?.public.gameId === result.gameId &&
      this.state.game.public.stateVersion === result.stateVersion && result.stateVersion === game.public.stateVersion ? result : null;
  }
  async quickCommand(draft: QuickDraft) {
    return this.playerCommand(draft.channel, draft.command);
  }
  async quickPreview(draft: QuickDraft): Promise<Extract<QuickPreviewResult, { status: "ready" }> | null> {
    const { game, roomId } = this.state;
    if (!game || !roomId) return null;
    const result = await this.rpc<Extract<QuickPreviewResult, { status: "ready" }>>("room:quick-preview", {
      roomId, channel: draft.channel, command: { gameId: game.public.gameId, expectedVersion: game.public.stateVersion, ...draft.command },
    });
    return this.state.roomId === result.roomId && this.state.game?.public.gameId === result.gameId &&
      this.state.game.public.stateVersion === result.stateVersion && result.stateVersion === game.public.stateVersion ? result : null;
  }
  private async playerCommand(
    channel: "harvest" | "entry" | "round" | "influence" | "exploration" | "city-move" | ConstructionDraft["channel"] | QuickDraft["channel"],
    command: Record<string, unknown>,
  ) {
    const { game, roomId } = this.state, epoch = this.epoch;
    if (!game || !roomId) return;
    const result = await this.rpc<{ view: GamePlayerView }>("room:command", {
      roomId,
      request: {
        apiVersion: "1.0.0",
        requestId: crypto.randomUUID(),
        channel,
        command: {
          gameId: game.public.gameId,
          expectedVersion: game.public.stateVersion,
          ...command,
        },
      },
    });
    if (this.state.roomId === roomId) {
      this.acceptGame(result.view);
      this.patch({ notice: command.type === "set-harvest-plan" ? "采集方案已保存；全员齐备前可修改本人方案。"
        : command.type === "finish-player-turn" ? "行动轮已保存结束，请按最新指引继续。"
        : "操作已保存，请按最新局面继续下一步。" });
      try { await this.options(); }
      catch {
        if (epoch === this.epoch && this.state.roomId === roomId && this.socket?.connected && this.state.game?.public.gameId === game.public.gameId)
          this.patch({ error: "操作已保存，但后续选项未能同步。请同步局面后继续，无需重复提交。" });
      }
    }
  }
  async logout() {
    try {
      await this.rpc("session:logout", {});
    } finally {
      this.clear();
      this.storage.removeItem("nco.local.lobby");
      this.storage.removeItem("nco.local.room");
    }
  }
}
