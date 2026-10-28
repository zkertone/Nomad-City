import type { GamePlayerView, ExplorationPathStep } from '@nomad-city-online/game-core';
import type { ActionOptionsResult, ExplorationRouteResult, ConstructionDraft, ConstructionPreviewResult, QuickDraft } from '@nomad-city-online/server';
import { QuickActions } from './QuickActions.js';
import type { QuickPreview } from './QuickConfirmation.js';
import { ConstructionPanel } from './ConstructionPanel.js';
import { TravelAction } from './TravelAction.js';
import type { InfluenceCommand, MajorActionCommand, ExplorationCommand, CityMoveCommand } from './client.js';

export function MajorActionPanel({ view, result, selectedSlotId, sourceSlotId, disabled, onRound, onInfluence, onResetSource, onExplore, onMove, preview, onConstruction, previewConstruction, onQuick, previewQuick }: {
  readonly view: GamePlayerView;
  readonly result: Extract<ActionOptionsResult, { status: 'ready' }> | null;
  readonly selectedSlotId: string;
  readonly sourceSlotId: string;
  readonly disabled: boolean;
  readonly onQuick: (draft: QuickDraft) => void;
  readonly previewQuick: QuickPreview;
  readonly onConstruction: (draft: ConstructionDraft) => void;
  readonly previewConstruction: (draft: ConstructionDraft) => Promise<Extract<ConstructionPreviewResult, { status: 'ready' }> | null>;
  readonly onRound: (command: MajorActionCommand) => void;
  readonly onInfluence: (command: InfluenceCommand) => void;
  readonly onExplore: (command: ExplorationCommand) => void;
  readonly onMove: (command: CityMoveCommand) => void;
  readonly preview: (path: readonly ExplorationPathStep[]) => Promise<Extract<ExplorationRouteResult, { status: 'ready' }> | null>;
  readonly onResetSource: () => void;
}) {
  const options = result?.options, turn = view.public.round, influence = options?.influence;
  const targetIds = influence?.kind === 'deploy' ? influence.deploymentSlotIds
    : influence?.dispatches.find(row => row.sourceSlotId === sourceSlotId)?.targetSlotIds ?? [];
  const selectedLegal = targetIds?.includes(selectedSlotId);
  return <section className="card decision" aria-label="主要行动">
    <div className="eyebrow">YOUR ACTION / 主要行动</div>
    <h2>{turn?.stage === 'cleanup' ? '回合收尾选择' : !options ? '等待当前玩家' : influence?.status === 'ready'
      ? influence.kind === 'deploy' ? '部署一枚影响力' : '调度影响力'
      : turn?.majorActionStatus === 'complete' ? '主要行动已完成' : options.travel ? '路径与事件选择' : '选择主要行动'}</h2>
    <p>第 {turn?.cycle} 轮 · 当前玩家 {turn?.actorId?.toUpperCase() ?? '—'}</p>
    {!result && <p className="muted">正在同步行动选项…</p>}
    {result?.blockedReason && <p role="status">服务端阶段尚待恢复，请同步局面后继续。</p>}
    {options && <>
      <div className="action-choices">
        {options.actions.map(choice => <button key={choice.action} className="secondary"
          disabled={disabled || !choice.legal}
          onClick={() => onRound({ type: 'choose-major-action', action: choice.action })}>
          {{ deploy: '部署', dispatch: '调度', explore: '探索', 'city-move': '移城', construct: '建设' }[choice.action]}
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
      {options.travel && <TravelAction key={`travel:${view.public.gameId}:${view.public.stateVersion}`}
        travel={options.travel} disabled={disabled} preview={preview} onExplore={command => {
          if (options.travel?.channel === 'facility-entry') onConstruction({ channel: 'facility-entry', command });
          else if (options.travel?.channel === 'warehouse-entry') onConstruction({ channel: 'warehouse-entry', command: command.type === 'explore'
            ? { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' }, warehouseExploration: { nodeId: command.nodeId, path: command.path } } : command });
          else onExplore(command);
        }} onMove={command => {
          if (options.travel?.channel === 'facility-entry') onConstruction({ channel: 'facility-entry', command });
          else onMove(command);
        }} />}
      {options.construction && <ConstructionPanel key={`construction:${view.public.gameId}:${view.public.stateVersion}`}
        view={view} options={options.construction} disabled={disabled} preview={previewConstruction} onCommand={onConstruction} />}
      <QuickActions key={`quick:${view.public.gameId}:${view.public.stateVersion}`} quick={options.quick} view={view} disabled={disabled} preview={previewQuick} onCommand={onQuick} />
      {options.finishPattern.legal && <button className="primary" disabled={disabled} onClick={() => onRound({ type: 'finish-pattern-action' })}>确认完成当前样式子行动 →</button>}
      {options.cancelPreparation.legal && <button className="secondary" disabled={disabled}
        onClick={() => onRound({ type: 'cancel-major-preparation' })}>取消尚未执行的行动准备</button>}
      {options.finishDispatch.legal && <button className="secondary" disabled={disabled}
        onClick={() => onInfluence({ type: 'finish-dispatch' })}>不再移动，结束本次调度</button>}
      {options.finishTurn.legal && <>
        <p>确认后将轮到下一位玩家。请先完成你希望使用的角色或城市样式操作。</p>
        <button className="primary" disabled={disabled}
          onClick={() => onRound({ type: 'finish-player-turn' })}>确认结束我的行动轮 →</button>
      </>}
      {turn?.majorActionStatus === 'pending' && !influence && !options.travel && !options.construction && <p>当前行动的后续界面尚待接入。</p>}
    </>}
    <small className="muted">角色、宣告和特殊行动均须明确确认；额外行动也需逐项完成。</small>
  </section>;
}
