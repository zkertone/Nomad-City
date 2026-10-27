import { useEffect, useState } from "react";
import type { GamePlayerView } from "@nomad-city-online/game-core";
import type {
  RoundSetupOptionsResult,
  RoundSupplyChoice,
} from "@nomad-city-online/server";
import type { RoundPreparationCommand } from "./client.js";

const roleNames: Record<string, string> = {
  "ROLE-01": "雷蛇",
  "ROLE-02": "极境",
  "ROLE-03": "德克萨斯",
  "ROLE-04": "坎诺特",
  "ROLE-05": "锡人",
};
const colors: Record<string, string> = {
  red: "红",
  blue: "蓝",
  yellow: "黄",
  rainbow: "虹",
};
function costText(card: RoundSupplyChoice): string {
  const cost = card.constructionCost;
  if (cost.kind === "not-printed") return "卡面未印建设费用";
  const labels: Record<string, string> = {
    orirock: "源岩",
    originium: "源石",
    iron: "异铁",
    pureOriginium: "至纯源石",
    vouchers: "金券",
  };
  return `${Object.entries(cost.resourcePayment)
    .filter(([, n]) => n > 0)
    .map(([asset, n]) => `${labels[asset]} ${n}`)
    .join(" + ")} / 金券 ${cost.voucherPayment}`;
}
export function RoundPreparation({
  view,
  result,
  disabled,
  onCommand,
}: {
  readonly view: GamePlayerView;
  readonly result: Extract<RoundSetupOptionsResult, { status: "ready" }> | null;
  readonly disabled: boolean;
  readonly onCommand: (command: RoundPreparationCommand) => void;
}) {
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected("");
  }, [result?.stateVersion, view.public.gameId]);
  const options = result?.options,
    turn = view.public.round;
  const removal = options?.stage === "role-removal" ? options : null,
    placement = options?.stage === "role-placement" ? options : null;
  const choice =
    removal?.cards.find((c) => c.cardId === selected) ??
    placement?.roles.find((r) => r.roleId === selected);
  return (
    <section className="card round-preparation" aria-label="回合准备">
      <div className="section-heading">
        <div>
          <div className="eyebrow">ROUND PREPARATION / 回合准备</div>
          <h2>
            {turn?.stage === "role-removal"
              ? "移除一张供应设施"
              : turn?.stage === "role-placement"
                ? "盖放本回合角色"
                : "角色已就位"}
          </h2>
        </div>
        <span className="count-tag">第 {turn?.roundNumber} 回合</span>
      </div>
      <p>
        {removal
          ? "选择要移出本局的一张公开供应设施。确认后，服务端补齐供应。"
          : placement
            ? "从自己的可用角色中选择一张盖放。其他玩家看不到你的选择。"
            : turn?.stage === "player-actions"
              ? `当前行动玩家：${turn.actorId?.toUpperCase() ?? "等待中"}。主要行动界面将在下一批接入。`
              : `等待 ${turn?.actorId?.toUpperCase() ?? "当前玩家"} 完成回合准备。`}
      </p>
      {result?.blockedReason && (
        <div className="message" role="status">
          服务端阶段尚待恢复，请同步局面后继续。
        </div>
      )}
      {removal && (
        <div className="preparation-cards">
          {removal.cards.map((card) => (
            <button
              key={card.cardId}
              data-color={card.color}
              className={
                selected === card.cardId
                  ? "preparation-card selected"
                  : "preparation-card"
              }
              disabled={disabled || !card.legal}
              onClick={() => setSelected(card.cardId)}
              aria-pressed={selected === card.cardId}
            >
              <small>
                {colors[card.color]}色设施 · {card.score} 分
              </small>
              <strong>{card.name}</strong>
              <span>{costText(card)}</span>
              <p>{card.effect}</p>
              <small>
                {card.legal
                  ? "选择此牌"
                  : card.blockedBy === "REFILL_UNRESOLVED"
                    ? "当前供应无法补齐"
                    : "当前不可移除"}
              </small>
            </button>
          ))}
        </div>
      )}
      {placement && (
        <>
          <div className="role-recovery">
            {placement.recoversDiscard
              ? "手牌已用尽；确认盖放时，将按原规则收回弃牌。"
              : "本人的可用角色"}
          </div>
          <div className="role-choices">
            {placement.roles.map((role) => (
              <button
                key={role.roleId}
                disabled={disabled || !role.legal}
                aria-pressed={selected === role.roleId}
                className={
                  selected === role.roleId
                    ? "role-choice selected"
                    : "role-choice"
                }
                onClick={() => setSelected(role.roleId)}
              >
                <small>{role.roleId}</small>
                <strong>{role.name}</strong>
                <span>{role.legal ? "选择盖放" : "当前不可用"}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {options && (
        <button
          className="primary"
          disabled={disabled || !choice?.legal}
          onClick={() => {
            if (!choice?.legal) return;
            onCommand(
              removal
                ? { type: "remove-round-supply-card", cardId: selected }
                : { type: "place-round-role", roleId: selected },
            );
          }}
        >
          {removal ? "确认移除所选设施" : "确认盖放所选角色"} →
        </button>
      )}
      <div className="placement-summary">
        {view.public.players.map((player) => (
          <span key={player.playerId}>
            {player.playerId.toUpperCase()}
            {player.playerId === view.private.playerId ? " · 你" : ""}：
            {player.roles?.hasPlacedRole
              ? player.playerId === view.private.playerId
                ? (roleNames[view.private.placedRoleId ?? ""] ?? "已盖放")
                : "已盖放"
              : "未盖放"}
          </span>
        ))}
      </div>
    </section>
  );
}
