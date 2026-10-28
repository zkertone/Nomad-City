import type { ClientSnapshot } from './client.js';
type Input = Pick<ClientSnapshot, 'game' | 'roomId' | 'connected' | 'busy' | 'entry' | 'roundSetup' | 'actionOptions' | 'harvestOptions'>;
export interface PlayGuide { readonly stage: string; readonly title: string; readonly detail: string; readonly tone: 'you' | 'waiting' | 'sync' | 'done' }
/** Presentation advice only. Current server options remain the sole source of executable choices. */
export function getPlayGuide(state: Input): PlayGuide {
  const view = state.game, turn = view?.public.round, own = view?.private.playerId;
  const stage = view?.public.finalResult ? '正式终局' : view?.public.entry && view.public.entry.status !== 'complete' ? '初始入场'
    : turn?.stage === 'harvest' ? '同时采集' : turn?.stage === 'cleanup' ? '回合清理'
    : turn?.stage === 'player-actions' ? `第 ${turn.roundNumber} 回合 · 第 ${turn.cycle} 轮行动`
    : turn ? `第 ${turn.roundNumber} 回合 · 回合准备` : '对局同步';
  const show = (title: string, detail: string, tone: PlayGuide['tone'] = 'you') => ({ stage, title, detail, tone });
  if (!state.connected) return show('连接尚未恢复', '等待重新连接后同步已保存局面，再继续操作；未收到确认的操作请先核对结果。', 'sync');
  if (!view) return show('选择一场对局', '从大厅进入已开始或已保存的对局。', 'waiting');
  if (state.busy) return show('正在处理请求', '请等待服务器确认或同步完成，当前无需重复点击。', 'sync');
  if (view.public.finalResult) return show('本局已完成', '查看正式排名、得分及区块明细；这些结果已保存，可以返回大厅。', 'done');
  const current = <T extends { readonly roomId: string; readonly gameId: string; readonly stateVersion: number }>(result: T | null) =>
    result?.roomId === state.roomId && result.gameId === view.public.gameId && result.stateVersion === view.public.stateVersion ? result : null;
  const actions = current(state.actionOptions), entry = current(state.entry), prep = current(state.roundSetup), harvest = current(state.harvestOptions);
  const sync = () => show('正在同步当前选择', '当前选项尚未就绪；请稍候，或使用“同步局面”重新读取。', 'sync');
  if (view.public.phase === 'harvest' && view.public.harvest?.status === 'planning') {
    if (!harvest?.options) return sync();
    return view.public.harvest.submittedPlayerIds.includes(own!)
      ? show('你的采集方案已保存', '等待其余玩家提交；全员齐备前仍可修改本人方案，全部齐备后由服务器统一结算。', 'waiting')
      : show('现在所有玩家同时规划采集', '选择本人资源点、连接航道和必要收款人，核对费用与收益后提交；不采集也须明确提交空方案。');
  }
  const actor = view.public.entry && view.public.entry.status !== 'complete' ? view.public.entry.actorId : turn?.actorId;
  if (actor && actor !== own) return show(`等待 ${actor.toUpperCase()} 操作`, '请等待当前玩家确认选择；局面会自动同步，你的操作入口在轮到本人时显示。', 'waiting');
  if (view.public.entry && view.public.entry.status !== 'complete') {
    if (!entry?.options) return sync();
    if (entry.options.status === 'selecting-node') return show('轮到你选择起点', '先在资源点概览选择可用起点，再在操作区确认；B-01的额外奖励须明确选择。');
    if (entry.options.status === 'resolving-event') return show('轮到你选择入场事件', '阅读已揭示的绿色事件，明确选择一个选项；后续如有影响力奖励再单独选择。');
    if (entry.options.status === 'bonus-influence') return show('确认入场影响力奖励', '选择一个可用位置并确认放置，或明确放弃本次奖励。');
  }
  if (turn?.stage === 'role-removal' || turn?.stage === 'role-placement') {
    if (!prep?.options || prep.blockedReason) return sync();
    return turn.stage === 'role-removal' ? show('轮到你移除供应设施', '选择一张可移除的公开设施，再确认；保存后由服务器补牌并交给下一位。')
      : show('轮到你盖放角色', '从本人可用角色中选择一张并确认盖放；其他玩家只看到盖放进度。');
  }
  if (!actor || !actions?.options || actions.blockedReason) return sync();
  const options = actions.options, travel = options.travel, construction = options.construction;
  if (turn?.stage === 'cleanup') return show('轮到你完成回合清理', '在雷蛇收尾选择中移除一枚本人影响力，再明确确认；此步骤完成后服务器才会继续收尾。');
  if (options.quick.patternRouteSlotIds.length) return show('移城后还需放置航道影响力', '在样式移城的额外航道选择中指定位置并确认，完成当前样式续接。');
  if (travel && travel.status !== 'complete') {
    const parent = travel.channel === 'facility-entry' || travel.channel === 'warehouse-entry' ? '设施入场 · ' : view.public.patternContinuation ? '样式续接 · ' : '';
    if (travel.status === 'event-choice') return show(`${parent}处理已揭事件`, '阅读事件并选择选项；有支付前提或事件内影响力时，补齐选择后确认。');
    if (travel.status === 'final-influence') return show(`${parent}完成末尾影响力放置`, '事件已经处理，仍需在末尾放置面板选择可用槽位并确认。');
    return travel.kind === 'explore' ? show(`${parent}规划探索路径`, '逐段选择航道和到达点，明确收费航道的收款人；预览通过后确认路径与费用。')
      : show(`${parent}选择移城航道与目标`, `本次${travel.cityMoveCost === 0 ? '免费移城' : '支付3源石'}；确认后按实际事件和末尾放置继续，不会直接结束整个行动。`);
  }
  if (construction?.buildChannel) return show(construction.buildChannel === 'facility-entry' ? '还需完成追加建设' : construction.source === 'authorized-deck-search' ? '从本次允许检索的设施中建设' : '选择设施、付款与摆放格位',
    '选择设施、付款方式及本人空格，核对报价后确认；建设保存后继续完成实际入场效果。');
  if (construction?.status === 'entry-pending') {
    if (construction.entry?.routeSlotIds.length) return show('设施入场还需额外航道放置', '选择额外航道影响力位置并确认，父建设要等这一步完成。');
    const detail: Record<string, string> = { warehouse: '选择仓库的影响力或探索分支，补齐该分支的选择；子步骤结束后才完成建设。',
      logistics: '选择延伸设施和空格，或明确放弃摆放；此选择仍属于本次入场。', 'copy-entry': '选择一个实际可复制的相邻设施，再继续其入场选择。' };
    return show('建设已保存，继续设施入场', detail[construction.entry?.kind ?? ''] ?? '在设施入场面板补齐资源、出售或影响力选择，预览通过后确认。');
  }
  if (options.influence?.status === 'ready') return options.influence.kind === 'deploy'
    ? show('选择部署目标', '在影响力槽位概览选择可用空槽，再点击确认部署。')
    : show(`继续调度 · 已完成 ${options.influence.operationsCompleted} / 2 次`, '先选本人影响力来源，再选空目标；如不再移动，请明确结束本次调度。');
  if (options.finishPattern.legal) return show('当前子行动已完成，还需确认样式进度', '点击“确认完成当前样式子行动”；若还有额外行动，继续下一项，不要提前结束行动轮。');
  if (options.finishTurn.legal) return show('主要行动已完成，等待你结束行动轮', '检查下方仍可用的角色／样式操作，再点击“确认结束我的行动轮”交给下一位。');
  if (turn?.majorActionStatus === 'not-started') return show('轮到你选择主要行动', '从下方可用的主要行动或样式特殊行动中选择；角色与宣告按实际可用窗口另行确认。');
  return sync();
}
