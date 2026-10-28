import { useEffect, useState } from 'react';
import type { EventEffect, ExplorationPathStep } from '@nomad-city-online/game-core';
import type { ExplorationRouteResult, TravelOptions } from '@nomad-city-online/server';
import type { CityMoveCommand, ExplorationCommand } from './client.js';

type Preview = Extract<ExplorationRouteResult, { status: 'ready' }>;
const assets: Record<string, string> = { orirock: '源岩', originium: '源石', iron: '异铁',
  'columbia-voucher': '金券', 'pure-originium': '至纯源石', point: '分数' };
function effectsText(effects: readonly EventEffect[]) {
  return effects.map(e => e.kind === 'gain'
    ? `${e.recipient === 'actor' ? '你' : '每位对手'}获得 ${e.amount} ${assets[e.asset]}`
    : `放置一枚影响力（${e.scope === 'standard' ? '普通合法位置' : e.scope === 'incident-route' ? '事件点相连航道' : '事件点或相连航道'}）`).join('；');
}
const reasons: Record<string, string> = {
  PATH_REQUIRED: '请先添加一段航道。', EXPLORATION_TARGET: '当前位置已探索，可继续添加路径前往未探索资源点。',
  RED_CLOSED: '该红区资源点本回合尚未开放。', CANNOT_PAY: '现有资源不足以支付；不能预支事件奖励。',
  TOLL_RECIPIENT: '请选择各收费航道的影响力收款人。', BALANCE_OVERFLOW: '收款后余额超出可处理范围，请调整选择。',
  EVENT_DECK: '该颜色没有可抽事件。', VERSION_OVERFLOW: '对局版本已用尽，当前无法提交。',
};
export function TravelAction({ travel, disabled, preview, onExplore, onMove }: {
  readonly travel: TravelOptions;
  readonly disabled: boolean;
  readonly preview: (path: readonly ExplorationPathStep[]) => Promise<Preview | null>;
  readonly onExplore: (command: ExplorationCommand) => void;
  readonly onMove: (command: CityMoveCommand) => void;
}) {
  const [path, setPath] = useState<ExplorationPathStep[]>([]);
  const [routeResult, setRouteResult] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState(false), [retry, setRetry] = useState(0);
  const [moveId, setMoveId] = useState(''), [stepId, setStepId] = useState('');
  const [choiceId, setChoiceId] = useState(''), [decision, setDecision] = useState<'' | 'pay' | 'decline'>('');
  const [eventSlot, setEventSlot] = useState(''), [finalSlot, setFinalSlot] = useState('');
  const pathKey = JSON.stringify(path);
  useEffect(() => {
    if (travel.kind !== 'explore' || travel.status !== 'ready') return;
    let active = true;
    setPreviewError(false);
    void preview(path).then(result => { if (active) { setRouteResult(result); setPreviewError(!result?.options); } })
      .catch(() => { if (active) { setRouteResult(null); setPreviewError(true); } });
    return () => { active = false; };
  }, [pathKey, retry, travel.kind, travel.status, preview]);
  // A response for a previous draft must never enable confirmation for the edited path.
  const route = routeResult?.options && JSON.stringify(routeResult.options.path) === pathKey ? routeResult.options : null;
  const editPath = (next: ExplorationPathStep[]) => { setPath(next); setRouteResult(null); setStepId(''); };
  const choice = travel.event?.choices.find(c => c.id === choiceId);
  const variants = choice?.variants.filter(v => v.choice.costDecision === (choice.cost ? decision : undefined)) ?? [];
  const placements = variants.filter(v => v.choice.influenceSlotId !== undefined);
  const variant = variants.find(v => v.choice.influenceSlotId ? v.choice.influenceSlotId === eventSlot : true);
  const move = travel.moves.find(m => `${m.routeId}|${m.nodeId}` === moveId);
  return <div className="travel-action">
    <h3>{travel.kind === 'explore' ? '探索' : '城市移动'}{travel.targetNodeId ? ` · ${travel.targetNodeId}` : ''}</h3>
    {travel.status === 'ready' && travel.kind === 'explore' && <>
      <p>逐段选择航道及到达点，最后停在未探索资源点；重复经过同一航道仅收费一次。</p>
      <ol className="travel-path">{path.map((step, i) => <li key={i}>{step.routeId} → {step.toNodeId}</li>)}</ol>
      {route && <>
        <p>当前路径终点：{route.currentNodeId}</p>
        <label>下一段航道与到达点<select disabled={disabled} value={stepId} onChange={e => setStepId(e.target.value)}>
          <option value="">请选择下一段</option>
          {route.nextSteps.map(step => <option key={`${step.routeId}|${step.toNodeId}`} value={`${step.routeId}|${step.toNodeId}`}>
            {step.routeId} → {step.toNodeId}</option>)}
        </select></label>
        <button className="secondary" disabled={disabled || !route.nextSteps.some(s => `${s.routeId}|${s.toNodeId}` === stepId)}
          onClick={() => { const step = route.nextSteps.find(s => `${s.routeId}|${s.toNodeId}` === stepId); if (step) editPath([...path, step]); }}>添加这一段</button>
      </>}
      {path.length > 0 && <button className="text-button" disabled={disabled} onClick={() => editPath(path.slice(0, -1))}>撤回最后一段路径</button>}
      {!route && <p role="status">{previewError ? '路径预览暂时不可用。' : '正在同步路径预览…'}</p>}
      {previewError && <button className="secondary" disabled={disabled} onClick={() => setRetry(n => n + 1)}>重新预览</button>}
      {route?.quote && <div className="toll-preview">
        <strong>本次路费：{route.quote.total} 金券</strong>
        {route.quote.legs.map(leg => <div key={leg.routeId}>
          <p>{leg.routeId}：{leg.amount} 金券 · {leg.amount === 0 ? '本人影响力免付' : leg.toSupply ? '交回供应' : '交给影响力持有人'}</p>
          {!leg.toSupply && leg.amount > 0 && <label>收款人<select disabled={disabled}
            value={path.find(p => p.routeId === leg.routeId)?.payeePlayerId ?? (leg.recipientPlayerIds.length === 1 ? leg.recipientPlayerIds[0] : '')}
            onChange={e => editPath(path.map(step => step.routeId !== leg.routeId ? step :
              e.target.value ? { ...step, payeePlayerId: e.target.value } : { routeId: step.routeId, toNodeId: step.toNodeId }))}>
            <option value="">请选择收款人</option>
            {leg.recipientPlayerIds.map(id => <option key={id} value={id}>{id.toUpperCase()}</option>)}
          </select></label>}
        </div>)}
      </div>}
      {route && !route.execution.legal && <p role="status">{reasons[route.execution.blockedBy ?? ''] ?? '当前路径尚不可执行，请调整选择。'}</p>}
      <button className="primary" disabled={disabled || !route?.execution.legal}
        onClick={() => { if (route?.execution.legal) onExplore({ type: 'explore', nodeId: route.currentNodeId, path }); }}>确认路径、支付路费并探索 →</button>
    </>}
    {travel.status === 'ready' && travel.kind === 'city-move' && <>
      <p>{travel.cityMoveCost === 0 ? '本次免费' : '支付 3 源石'}，沿一条航道移动城邦；按原规则清除选定航道及目标点的对手影响力。</p>
      <label>航道与目标点<select disabled={disabled} value={moveId} onChange={e => setMoveId(e.target.value)}>
        <option value="">请选择航道和目标</option>
        {travel.moves.map(m => <option key={`${m.routeId}|${m.nodeId}`} value={`${m.routeId}|${m.nodeId}`} disabled={!m.legal}>
          {m.routeId} → {m.nodeId}{m.legal ? '' : '（当前不可执行）'}</option>)}
      </select></label>
      {!travel.moves.length && <p>目前没有可执行目标；请检查资源，或取消尚未执行的准备。</p>}
      <button className="primary" disabled={disabled || !move?.legal}
        onClick={() => { if (move?.legal) onMove({ type: 'move-city', nodeId: move.nodeId, routeId: move.routeId }); }}>{travel.cityMoveCost === 0 ? '确认免费移城' : '确认支付并移城'} →</button>
    </>}
    {travel.event && <>
      <h3>{travel.event.title}</h3><p className="event-story">{travel.event.description}</p>
      <div className="event-choices">{travel.event.choices.map(c => <button className={choiceId === c.id ? 'secondary selected' : 'secondary'}
        key={c.id} disabled={disabled} aria-pressed={choiceId === c.id}
        onClick={() => { setChoiceId(c.id); setDecision(''); setEventSlot(''); }}>
        <strong>{c.narration}</strong><span>{effectsText(c.effects)}</span>
        {c.cost && <small>支付前提：{c.cost.amount} 金券</small>}
      </button>)}</div>
      {choice?.cost && <label>是否支付该选项前提<select disabled={disabled} value={decision} onChange={e => { setDecision(e.target.value as '' | 'pay' | 'decline'); setEventSlot(''); }}>
        <option value="">请明确选择</option><option value="pay">支付 {choice.cost.amount} 金券并执行效果</option><option value="decline">不支付，此选项效果不执行</option>
      </select></label>}
      {placements.length > 0 && <label>事件效果的影响力槽位<select disabled={disabled} value={eventSlot} onChange={e => setEventSlot(e.target.value)}>
        <option value="">请选择事件内放置位置</option>{placements.map(v => <option key={v.choice.influenceSlotId} value={v.choice.influenceSlotId!} disabled={!v.legal}>{v.choice.influenceSlotId}</option>)}
      </select></label>}
      {variant && !variant.legal && <p>当前资源或状态不允许此选项，请调整选择。</p>}
      <button className="primary" disabled={disabled || !variant?.legal} onClick={() => {
        if (!variant?.legal) return;
        if (travel.kind === 'explore') onExplore({ type: 'choose-exploration-event', choice: variant.choice });
        else onMove({ type: 'choose-city-move-event', choice: variant.choice });
      }}>确认事件选择 →</button>
    </>}
    {travel.status === 'final-influence' && <>
      <p>事件结算已完成，请完成行动末尾在目标资源点的影响力放置。</p>
      <label>目标点槽位<select disabled={disabled} value={finalSlot} onChange={e => setFinalSlot(e.target.value)}>
        <option value="">请选择末尾放置位置</option>{travel.finalSlotIds.map(id => <option key={id} value={id}>{id}</option>)}
      </select></label>
      <button className="primary" disabled={disabled || !travel.finalSlotIds.includes(finalSlot)} onClick={() => {
        if (!travel.finalSlotIds.includes(finalSlot)) return;
        if (travel.kind === 'explore') onExplore({ type: 'place-exploration-influence', slotId: finalSlot });
        else onMove({ type: 'place-city-move-influence', slotId: finalSlot });
      }}>确认末尾放置 →</button>
    </>}
    {travel.status === 'complete' && <p>本次{travel.kind === 'explore' ? '探索' : '移城'}已完成。</p>}
  </div>;
}
