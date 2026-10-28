import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  BoardDefinition,
  EventEffect,
  ExplorationPathStep,
} from "@nomad-city-online/game-core";
import { CityClient } from "./client.js";
import "./style.css";
import { BoardRenderer } from "./renderers/BoardRenderer.js";
import { RoundPreparation } from "./RoundPreparation.js";
import { MajorActionPanel } from "./MajorActionPanel.js";

const client = new CityClient(sessionStorage);
const previewExploration = (path: readonly ExplorationPathStep[]) => client.explorationPreview(path);
const assets: Record<string, string> = {
  orirock: "源岩",
  iron: "异铁",
  originium: "源石",
  "columbia-voucher": "金券",
  "pure-originium": "至纯源石",
  point: "分数",
};
const colors: Record<string, string> = {
  red: "红",
  blue: "蓝",
  green: "绿",
  yellow: "黄",
};
const stageNames: Record<string, string> = {
  "role-removal": "移除供应设施",
  "role-placement": "选择并盖放角色",
  "player-actions": "玩家行动",
  harvest: "资源采集",
  cleanup: "回合清理",
  finished: "回合结束",
};
function gains(effects: readonly EventEffect[]) {
  return effects
    .map((e) =>
      e.kind === "gain" ? `${assets[e.asset]} +${e.amount}` : "放置影响力",
    )
    .join(" · ");
}
function Skyline() {
  return (
    <svg viewBox="0 0 600 180" role="img" aria-label="行进中的工业城邦插画">
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path
            d="M30 0H0V30"
            fill="none"
            stroke="currentColor"
            strokeWidth=".5"
          />
        </pattern>
      </defs>
      <rect width="600" height="180" fill="url(#grid)" opacity=".12" />
      <g fill="currentColor" opacity=".35">
        <path d="M80 142V94h35V48h45v94zm96 0V72h65v70zm81 0V30h17v28h30v84zm65 0V84h71v58zm90 0V57h40v85zm59 0V100h52v42z" />
        <path d="M57 143h490l-28 23H92z" />
      </g>
      <g fill="#ef824b">
        <rect x="124" y="60" width="6" height="27" />
        <rect x="282" y="82" width="9" height="33" />
        <rect x="432" y="69" width="6" height="15" />
      </g>
      <path d="M35 174h530" stroke="currentColor" opacity=".4" />
    </svg>
  );
}
function App() {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [section, setSection] = useState<"lobby" | "game">("lobby");
  const [count, setCount] = useState(2),
    [joinId, setJoinId] = useState(""),
    [invite, setInvite] = useState("");
  const [first, setFirst] = useState("p1"),
    [reverse, setReverse] = useState(false),
    [node, setNode] = useState(""),
    [bonus, setBonus] = useState<"claim" | "decline">("decline");
  const [actionSlot, setActionSlot] = useState(""),
    [sourceSlot, setSourceSlot] = useState("");
  const [slot, setSlot] = useState(""),
    [boards, setBoards] = useState<{
      three: BoardDefinition;
      four: BoardDefinition;
    } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  useEffect(() => {
    setCopied(false);
    setShowInvite(false);
  }, [state.inviteToken, state.lobby?.lobbyId]);
  useEffect(() => {
    client.resume();
    fetch("/__local/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then(setBoards)
      .catch(() => {});
    return () => client.dispose();
  }, []);
  const lobby = state.lobby,
    game = state.game,
    options = state.entry?.options;
  const blocked = state.busy || !state.connected,
    owner = lobby?.selfPlayerId === lobby?.ownerPlayerId;
  const board =
    game && boards
      ? game.public.players.length === 4
        ? boards.four
        : boards.three
      : null;
  const influence = state.actionOptions?.options?.influence;
  const actionTargets = influence?.kind === "deploy" ? influence.deploymentSlotIds
    : sourceSlot ? influence?.dispatches.find(row => row.sourceSlotId === sourceSlot)?.targetSlotIds ?? []
      : influence?.dispatches.map(row => row.sourceSlotId) ?? [];
  useEffect(() => {
    setActionSlot("");
    setSourceSlot("");
  }, [state.roomId, game?.public.gameId, game?.public.stateVersion]);
  useEffect(() => {
    setNode("");
    setSlot("");
  }, [state.entry?.stateVersion]);
  useEffect(() => {
    setFirst(lobby?.setup?.startingPlayerId ?? "p1");
  }, [lobby?.lobbyId, lobby?.setup?.startingPlayerId]);
  const run = (work: () => Promise<void>) => {
    void client.run(work);
  };
  const enter = (roomId: string) =>
    run(async () => {
      await client.openRoom(roomId);
      setSection("game");
    });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Nomad City Online 首页">
          <span className="brand-symbol">
            N<span>/</span>C
          </span>
          <span>
            NOMAD CITY<small>ONLINE · 游城拓荒</small>
          </span>
        </a>
        <div className="side-label">控制台 / CONSOLE</div>
        <nav aria-label="主要导航">
          <button
            className={section === "lobby" ? "nav active" : "nav"}
            onClick={() => setSection("lobby")}
          >
            <span>01</span> 联机大厅 <b>↗</b>
          </button>
          <button
            className={section === "game" ? "nav active" : "nav"}
            onClick={() => setSection("game")}
          >
            <span>02</span> 当前对局 <b>↗</b>
          </button>
        </nav>
        <div className="side-map">
          <Skyline />
          <span>城市仍在前行。</span>
          <small>BUILD. EXPLORE. KEEP MOVING.</small>
        </div>
        <div className="local-badge">
          <span className="status-dot" /> 本地开发环境
          <small>基础版 · 2–4 人</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            工作台 <i>/</i> {section === "lobby" ? "联机大厅" : "当前对局"}
          </span>
          <div>
            <span className={`connection ${state.connected ? "online" : ""}`}>
              <span className="status-dot" />
              {state.connected ? "已连接" : "未连接"}
            </span>
            {state.userId && (
              <>
                <span className="account">
                  测试用户 {state.userId.split("-").at(-1)}
                </span>
                <button
                  className="text-button"
                  onClick={() => run(() => client.logout())}
                >
                  退出
                </button>
              </>
            )}
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                NOMAD CITY ONLINE /{" "}
                {section === "lobby" ? "LOBBY" : "EXPEDITION"}
              </div>
              <h1>
                {section === "lobby"
                  ? "下一站，荒野。"
                  : "你的城邦，正在启程。"}
              </h1>
              <p>
                {section === "lobby"
                  ? "召集同行者，确认座次，开始一段新的拓荒旅程。"
                  : "每一步选择，都将成为这座城邦的一部分。"}
              </p>
            </div>
            <span className="edition">
              FOUNDERS<small>铸基者 / 基础版</small>
            </span>
          </div>
          {state.error && (
            <div className="message error" role="alert">
              {state.error}
              <button
                className="text-button"
                disabled={blocked}
                onClick={() =>
                  run(async () => {
                    await client.refresh();
                    if (lobby) await client.openLobby(lobby.lobbyId);
                    if (state.roomId) await client.openRoom(state.roomId);
                  })
                }
              >
                刷新状态
              </button>
            </div>
          )}
          {state.notice && (
            <div className="message" role="status">
              {state.notice}
            </div>
          )}
          {!state.userId ? (
            <section className="identity card">
              <div className="eyebrow">LOCAL PLAYTEST / 本地测试</div>
              <h2>以一个测试身份进入</h2>
              <p>用不同窗口选择不同身份，即可在本机模拟多人联机。</p>
              <div className="identity-grid">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    disabled={state.busy}
                    onClick={() => {
                      void client.fixture(n);
                    }}
                  >
                    <span
                      className="avatar"
                      data-color={["red", "blue", "green", "yellow"][n - 1]}
                    >
                      {String(n).padStart(2, "0")}
                    </span>
                    <strong>测试用户 {n}</strong>
                    <span>进入大厅 →</span>
                  </button>
                ))}
              </div>
              <small>这些身份只用于本地验证，不是正式账号登录。</small>
            </section>
          ) : section === "lobby" ? (
            <>
              <div className="launch-grid">
                <section className="card create-card">
                  <div className="eyebrow">01 / ASSEMBLE</div>
                  <h2>组建拓荒小队</h2>
                  <p>创建私人房间，邀请你的同行者。</p>
                  <label>
                    对局人数
                    <select
                      aria-label="对局人数"
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                    >
                      {[2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n} 人对局
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary"
                    disabled={blocked}
                    onClick={() => run(() => client.create(count))}
                  >
                    创建私人大厅 <span>＋</span>
                  </button>
                  <Skyline />
                </section>
                <section className="card">
                  <div className="eyebrow">02 / RENDEZVOUS</div>
                  <h2>加入同行者</h2>
                  <p>向房主索取大厅编号与邀请凭证。</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () => {
                        await client.join(joinId, invite);
                        setInvite("");
                      });
                    }}
                  >
                    <label>
                      大厅编号
                      <input
                        required
                        value={joinId}
                        onChange={(e) => setJoinId(e.target.value)}
                        placeholder="粘贴大厅编号"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      邀请凭证
                      <input
                        required
                        type="password"
                        value={invite}
                        onChange={(e) => setInvite(e.target.value)}
                        placeholder="粘贴邀请凭证"
                        autoComplete="off"
                      />
                    </label>
                    <button
                      className="secondary"
                      disabled={blocked || !joinId.trim() || !invite.trim()}
                    >
                      加入大厅 <span>→</span>
                    </button>
                  </form>
                </section>
              </div>
              {lobby && (
                <section className="card current-lobby">
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">READY ROOM / 当前大厅</div>
                      <h2>
                        {lobby.status === "started"
                          ? "小队已出发"
                          : lobby.status === "cancelled"
                            ? "大厅已取消"
                            : "等待小队集合"}{" "}
                        <span className="count-tag">
                          {lobby.members.length} / {lobby.playerCount}
                        </span>
                      </h2>
                    </div>
                    <span className="version">大厅版本 {lobby.version}</span>
                  </div>
                  <label>
                    大厅编号
                    <input readOnly value={lobby.lobbyId} />
                  </label>
                  {owner && lobby.status === "waiting" && (
                    <div className="invite-panel">
                      <div>
                        <strong>
                          {state.inviteToken
                            ? "邀请已生成"
                            : "需要新的邀请凭证？"}
                        </strong>
                        <small>只向你信任的同行者分享。</small>
                      </div>
                      <button
                        className="secondary compact"
                        disabled={blocked}
                        onClick={() =>
                          run(async () => {
                            if (!state.inviteToken)
                              await client.lobbyCommand("rotate-invite");
                            else {
                              try {
                                await navigator.clipboard.writeText(
                                  state.inviteToken,
                                );
                                setCopied(true);
                              } catch {
                                setCopied(false);
                                setShowInvite(true);
                              }
                            }
                          })
                        }
                      >
                        {state.inviteToken
                          ? copied
                            ? "已复制"
                            : "复制凭证"
                          : "生成新邀请"}
                      </button>
                      {state.inviteToken && (
                        <input
                          aria-label="当前邀请凭证"
                          type={showInvite ? "text" : "password"}
                          readOnly
                          value={state.inviteToken}
                        />
                      )}
                    </div>
                  )}
                  <div className="seats">
                    {Array.from({ length: lobby.playerCount }, (_, i) => {
                      const member = lobby.members.find(
                        (m) => m.playerId === `p${i + 1}`,
                      );
                      return (
                        <div
                          key={i}
                          className={`seat ${member ? "" : "empty"}`}
                        >
                          <span className="avatar" data-color={member?.color}>
                            {member ? String(i + 1).padStart(2, "0") : "＋"}
                          </span>
                          <div>
                            <strong>
                              {member
                                ? `${colors[member.color]}色席位${member.playerId === lobby.selfPlayerId ? " · 你" : ""}`
                                : "等待加入"}
                            </strong>
                            <small>
                              {member?.playerId === lobby.ownerPlayerId
                                ? "房主"
                                : member
                                  ? "同行者"
                                  : "空闲席位"}
                            </small>
                          </div>
                          <span
                            className={
                              member?.ready ? "ready-tag" : "waiting-tag"
                            }
                          >
                            {member?.ready ? "已准备" : "未准备"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {lobby.status === "waiting" && (
                    <>
                      <div className="setup-panel">
                        <div>
                          <strong>启程顺序</strong>
                          <p>
                            {lobby.setup
                              ? `先手 ${lobby.setup.startingPlayerId.toUpperCase()} · 顺时针 ${lobby.setup.clockwisePlayerIds.join(" → ").toUpperCase()}`
                              : "房主需要在满员后确认先手与顺时针顺序。"}
                          </p>
                        </div>
                        {owner && (
                          <div className="setup-controls">
                            <label>
                              先手
                              <select
                                value={first}
                                onChange={(e) => setFirst(e.target.value)}
                              >
                                {lobby.members.map((m) => (
                                  <option key={m.playerId} value={m.playerId}>
                                    {m.playerId.toUpperCase()} ·{" "}
                                    {colors[m.color]}色
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={reverse}
                                onChange={(e) => setReverse(e.target.checked)}
                              />
                              反向座次
                            </label>
                            <button
                              className="secondary compact"
                              disabled={
                                blocked ||
                                lobby.members.length !== lobby.playerCount
                              }
                              onClick={() =>
                                run(() =>
                                  client.lobbyCommand("configure", {
                                    startingPlayerId: first,
                                    clockwisePlayerIds: [...lobby.members]
                                      .sort((a, b) =>
                                        a.playerId.localeCompare(b.playerId),
                                      )
                                      .map((m) => m.playerId)
                                      [reverse ? "reverse" : "slice"](),
                                  }),
                                )
                              }
                            >
                              确认顺序
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="actions">
                        <button
                          className="secondary"
                          disabled={blocked || !lobby.setup}
                          onClick={() =>
                            run(() =>
                              client.lobbyCommand("set-ready", {
                                ready: !lobby.members.find(
                                  (m) => m.playerId === lobby.selfPlayerId,
                                )?.ready,
                              }),
                            )
                          }
                        >
                          {lobby.members.find(
                            (m) => m.playerId === lobby.selfPlayerId,
                          )?.ready
                            ? "取消准备"
                            : "我已准备"}
                        </button>
                        {owner && (
                          <button
                            className="primary"
                            disabled={
                              blocked ||
                              !lobby.setup ||
                              lobby.members.length !== lobby.playerCount ||
                              lobby.members.some((m) => !m.ready)
                            }
                            onClick={() =>
                              run(() => client.lobbyCommand("start"))
                            }
                          >
                            开始拓荒 →
                          </button>
                        )}
                        <button
                          className="text-button danger"
                          disabled={blocked}
                          onClick={() =>
                            run(() =>
                              client.lobbyCommand(owner ? "cancel" : "leave"),
                            )
                          }
                        >
                          {owner ? "取消大厅" : "离开大厅"}
                        </button>
                      </div>
                    </>
                  )}
                  {lobby.status === "started" && lobby.roomId && (
                    <button
                      className="primary"
                      disabled={blocked}
                      onClick={() => enter(lobby.roomId!)}
                    >
                      进入对局 →
                    </button>
                  )}
                </section>
              )}
              <section className="card">
                <div className="section-heading">
                  <h2>我的大厅与对局</h2>
                  <button
                    className="text-button"
                    disabled={blocked}
                    onClick={() => run(() => client.refresh())}
                  >
                    刷新列表 ↻
                  </button>
                </div>
                {state.lobbies.length === 0 && state.rooms.length === 0 ? (
                  <div className="empty-list">
                    <span>＋</span>
                    <p>还没有同行的小队</p>
                    <small>创建一个大厅，或者接受朋友的邀请。</small>
                  </div>
                ) : (
                  <div className="room-list">
                    {state.lobbies.map((row) => (
                      <button
                        key={row.lobbyId}
                        disabled={blocked}
                        onClick={() => run(() => client.openLobby(row.lobbyId))}
                      >
                        <span className="room-icon">N/C</span>
                        <div>
                          <strong>{row.playerCount} 人拓荒小队</strong>
                          <small>
                            {row.lobbyId.slice(0, 19)}… · {row.members.length}{" "}
                            人在席
                          </small>
                        </div>
                        <span>
                          {row.status === "started"
                            ? "已开始"
                            : row.status === "cancelled"
                              ? "已取消"
                              : "等待中"}{" "}
                          ↗
                        </span>
                      </button>
                    ))}
                    {state.rooms.map((row) => (
                      <button
                        key={row.roomId}
                        disabled={blocked}
                        onClick={() => enter(row.roomId)}
                      >
                        <span className="room-icon">↗</span>
                        <div>
                          <strong>
                            {row.scored
                              ? "已结束的拓荒"
                              : row.roundNumber
                                ? `第 ${row.roundNumber} 回合`
                                : "选择初始资源点"}
                          </strong>
                          <small>
                            {row.roomId.slice(0, 19)}… · 你的席位{" "}
                            {row.playerId.toUpperCase()}
                          </small>
                        </div>
                        <span>继续对局 →</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : game ? (
            <>
              <div className="game-strip">
                <span className="tag">
                  {game.private.playerId.toUpperCase()} · 你的城邦
                </span>
                <span>
                  {game.public.round
                    ? `第 ${game.public.round.roundNumber} / 8 回合`
                    : "初始入场"}
                </span>
                <span className="version">
                  对局版本 {game.public.stateVersion}
                </span>
                <button
                  className="text-button"
                  disabled={blocked}
                  onClick={() => run(() => client.openRoom(state.roomId!))}
                >
                  同步局面 ↻
                </button>
              </div>
              {game.public.round &&
                ["role-removal", "role-placement", "player-actions"].includes(
                  game.public.round.stage,
                ) && (
                  <RoundPreparation
                    view={game}
                    result={state.roundSetup}
                    disabled={blocked}
                    onCommand={(command) =>
                      run(() => client.roundSetupCommand(command))
                    }
                  />
                )}
              <div className="game-grid">
                <BoardRenderer
                  mode="2d"
                  board={board}
                  view={game}
                  targets={{
                    nodeIds: options?.nodeIds ?? [],
                    routeIds: [],
                    slotIds: actionTargets,
                  }}
                  selectedNodeId={node || null}
                  selectedSlotId={actionSlot || null}
                  sourceSlotId={sourceSlot || null}
                  disabled={blocked}
                  onIntent={(intent) => {
                    if (intent.type === "select-node") setNode(intent.nodeId);
                    if (intent.type === "select-slot") {
                      if (influence?.kind === "dispatch" && !sourceSlot) {
                        setSourceSlot(intent.slotId);
                        setActionSlot("");
                      } else setActionSlot(intent.slotId);
                    }
                  }}
                />
                {game.public.round?.stage === "player-actions" ? <MajorActionPanel
                  view={game} result={state.actionOptions} selectedSlotId={actionSlot}
                  sourceSlotId={sourceSlot} disabled={blocked}
                  onRound={command => run(() => client.majorActionCommand(command))}
                  onInfluence={command => run(() => client.influenceCommand(command))}
                  onExplore={command => run(() => client.explorationCommand(command))}
                  onMove={command => run(() => client.cityMoveCommand(command))}
                  preview={previewExploration}
                  onResetSource={() => { setSourceSlot(""); setActionSlot(""); }}
                /> : <section className="card decision">
                  <div className="eyebrow">YOUR DECISION / 玩家决策</div>
                  <h2>
                    {options?.status === "selecting-node"
                      ? "选择你的起点"
                      : options?.status === "resolving-event"
                        ? options.event?.title
                        : options?.status === "bonus-influence"
                          ? "入场影响力奖励"
                          : game.public.entry
                            ? "等待同行者"
                            : "入场已完成"}
                  </h2>
                  {options?.status === "selecting-node" && (
                    <>
                      <p>从左侧可用资源点中选择初始城邦位置。</p>
                      {node === "B-01" && (
                        <label>
                          B-01 额外资源
                          <select
                            value={bonus}
                            onChange={(e) =>
                              setBonus(e.target.value as "claim" | "decline")
                            }
                          >
                            <option value="decline">放弃奖励</option>
                            <option value="claim">领取每种基础资源各 2</option>
                          </select>
                        </label>
                      )}
                      <button
                        className="primary"
                        disabled={blocked || !options.nodeIds.includes(node)}
                        onClick={() =>
                          run(() =>
                            client.entryCommand({
                              type: "select-initial-node",
                              nodeId: node,
                              ...(node === "B-01" ? { b01Bonus: bonus } : {}),
                            }),
                          )
                        }
                      >
                        {node ? `确认起点 ${node}` : "请先选择资源点"} →
                      </button>
                    </>
                  )}
                  {options?.event && (
                    <>
                      <p className="event-story">{options.event.description}</p>
                      <div className="event-choices">
                        {options.event.choices.map((choice) => (
                          <button
                            className="event-choice"
                            key={choice.id}
                            disabled={blocked}
                            onClick={() =>
                              run(() =>
                                client.entryCommand({
                                  type: "choose-green-event",
                                  choiceId: choice.id,
                                }),
                              )
                            }
                          >
                            <span>{choice.narration}</span>
                            <strong>{gains(choice.effects)} →</strong>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {options?.canDeclineInfluence && (
                    <>
                      <p>你可以放置一枚入场奖励影响力，也可以放弃。</p>
                      <label>
                        影响力位置
                        <select
                          value={slot}
                          onChange={(e) => setSlot(e.target.value)}
                        >
                          <option value="">请选择位置</option>
                          {options.influenceSlotIds.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="primary"
                        disabled={blocked || !slot}
                        onClick={() =>
                          run(() =>
                            client.entryCommand({
                              type: "choose-entry-influence",
                              slotId: slot,
                            }),
                          )
                        }
                      >
                        确认放置 →
                      </button>
                      <button
                        className="secondary"
                        disabled={blocked}
                        onClick={() =>
                          run(() =>
                            client.entryCommand({
                              type: "choose-entry-influence",
                              slotId: null,
                            }),
                          )
                        }
                      >
                        放弃本次奖励
                      </button>
                    </>
                  )}
                  {!options && (
                    <div className="waiting">
                      <span>◷</span>
                      <p>
                        {game.public.entry
                          ? "请等待当前玩家完成入场选择。"
                          : `当前阶段：${stageNames[game.public.round?.stage ?? ""] ?? "回合进行中"}`}
                      </p>
                      {!game.public.entry && (
                        <small>
                          当前已接通入场、回合准备、部署、调度、探索与移城；其余操作界面待接入。
                        </small>
                      )}
                    </div>
                  )}
                </section>}
              </div>
              <div className="player-summary">
                {game.public.players.map((p) => (
                  <section className="card" key={p.playerId}>
                    <h3>
                      <span className="color-dot" data-color={p.color} />
                      {p.playerId.toUpperCase()}
                      {p.playerId === game.private.playerId ? " · 你" : ""}
                      <span>{p.score} 分</span>
                    </h3>
                    <div>
                      {Object.entries(p.balances).map(([asset, amount]) => (
                        <span key={asset}>
                          <small>{assets[asset]}</small>
                          <strong>{amount}</strong>
                        </span>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <section className="card empty-list">
              <Skyline />
              <h2>选择一场对局继续</h2>
              <p>先在大厅组队，或从已保存的对局中恢复进度。</p>
              <button className="primary" onClick={() => setSection("lobby")}>
                返回联机大厅 →
              </button>
            </section>
          )}
          <footer>
            <span>NOMAD CITY ONLINE</span>
            <span>私人非商业项目 · 本地测试 / v0.2.0</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
