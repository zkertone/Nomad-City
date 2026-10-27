import type { GamePlayerView } from '@nomad-city-online/game-core';
import type { ActionOptionsResult } from '@nomad-city-online/server';
import type { InfluenceCommand, MajorActionCommand } from './client.js';

export function MajorActionPanel({ view, result, selectedSlotId, sourceSlotId, disabled, onRound, onInfluence, onResetSource }: {
  readonly view: GamePlayerView;
  readonly result: Extract<ActionOptionsResult, { status: 'ready' }> | null;
  readonly selectedSlotId: string;
  readonly sourceSlotId: string;
  readonly disabled: boolean;
  readonly onRound: (command: MajorActionCommand) => void;
  readonly onInfluence: (command: InfluenceCommand) => void;
  readonly onResetSource: () => void;
}) {
  const options = result?.options, turn = view.public.round, influence = options?.influence;
  const targetIds = influence?.kind === 'deploy' ? influence.deploymentSlotIds
    : influence?.dispatches.find(row => row.sourceSlotId === sourceSlotId)?.targetSlotIds ?? [];
  const selectedLegal = targetIds?.includes(selectedSlotId);
  return <section className="card decision" aria-label="主要行动">
    <div className="eyebrow">YOUR ACTION / 主要行动</div>
    <h2>{!options ? '等待当前玩家' : influence?.status === 'ready'
      ? influence.kind === 'deploy' ? '部署一枚影响力' : '调度影响力'
      : turn?.majorActionStatus === 'complete' ? '主要行动已完成' : '选择主要行动'}</h2>
    <p>第 {turn?.cycle} 轮 · 当前玩家 {turn?.actorId?.toUpperCase() ?? '—'}</p>
    {!result && <p className="muted">正在同步行动选项…</p>}
    {result?.blockedReason && <p role="status">服务端阶段尚待恢复，请同步局面后继续。</p>}
    {options && <>
      <div className="action-choices">
        {options.actions.map(choice => <button key={choice.action} className="secondary"
          disabled={disabled || !choice.legal}
          onClick={() => onRound({ type: 'choose-major-action', action: choice.action })}>
          {choice.action === 'deploy' ? '部署' : '调度'}
        </button>)}
      </div>
      {influence?.status === 'ready' && <>
        <p>{influence.kind === 'deploy' ? '在左侧选择合法空槽位，确认后从供应放置一枚影响力。'
          : `本次已调度 ${influence.operationsCompleted} / 2 次。先选自己的影响力，再选目标空槽位。`}</p>
        {influence.kind === 'dispatch' && <p>
          当前来源：{sourceSlotId || '尚未选择'}
          {sourceSlotId && <button className="text-button" disabled={disabled} onClick={onResetSource}>重新选择来源</button>}
        </p>}
        <p>目标：{selectedSlotId || '尚未选择'}</p>
        <button className="primary" disabled={disabled || !selectedLegal}
          onClick={() => {
            if (!selectedLegal) return;
            onInfluence(influence.kind === 'deploy'
              ? { type: 'deploy-influence', slotId: selectedSlotId }
              : { type: 'dispatch-influence', sourceSlotId, targetSlotId: selectedSlotId });
          }}>确认{influence.kind === 'deploy' ? '部署' : '调度'} →</button>
      </>}
      {options.cancelPreparation.legal && <button className="secondary" disabled={disabled}
        onClick={() => onRound({ type: 'cancel-major-preparation' })}>取消尚未执行的行动准备</button>}
      {options.finishDispatch.legal && <button className="secondary" disabled={disabled}
        onClick={() => onInfluence({ type: 'finish-dispatch' })}>不再移动，结束本次调度</button>}
      {options.finishTurn.legal && <>
        <p>确认后将轮到下一位玩家。角色与城市样式入口尚待接入；结束此轮会放弃此时可选的操作机会。</p>
        <button className="primary" disabled={disabled}
          onClick={() => onRound({ type: 'finish-player-turn' })}>确认结束我的行动轮 →</button>
      </>}
      {turn?.majorActionStatus === 'pending' && !influence && <p>当前行动的后续界面尚待接入。</p>}
    </>}
    <small className="muted">本批已接通部署与调度；探索、移城、建设、角色和城市样式操作继续接入中。</small>
  </section>;
}
