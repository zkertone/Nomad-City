import { useEffect, useState } from 'react';
import type { GamePlayerView } from '@nomad-city-online/game-core';
import type { HarvestOptionsResult, HarvestDraft, HarvestPreviewResult } from '@nomad-city-online/server';
import { selectionKey } from './selection-key.js';
import { assetLabels } from './ChoiceControls.js';
export type HarvestPreview = (draft: HarvestDraft) => Promise<Extract<HarvestPreviewResult, { status: 'ready' }> | null>;
const reasons: Record<string, string> = {
  HARVEST_CONNECTION: '所选目标和全部航道须连通到当前城市。', TOLL_RECIPIENT: '请为收费航道选择一个实际对手收款人。',
  HARVEST_TARGET: '只能采集已揭示且有本人城市或影响力的资源点。', INSUFFICIENT_VOUCHERS: '当前金券不足；不能用本次采集的路费收入付款。',
  EMPTY_PLAN: '不采集时请同时清空航道。', DUPLICATE_TARGET: '同一资源点只能采集一次。',
  BALANCE_OVERFLOW: '本次结算将超过余额上限。', VERSION_OVERFLOW: '对局版本已用尽，无法提交。',
};
export function HarvestPanel({ view, result, disabled, preview, onCommand }: {
  readonly view: GamePlayerView; readonly result: Extract<HarvestOptionsResult, { status: 'ready' }> | null;
  readonly disabled: boolean; readonly preview: HarvestPreview; readonly onCommand: (draft: HarvestDraft) => void;
}) {
  const options = result?.options, saved = options?.plan;
  const [nodeIds, setNodes] = useState<string[]>(() => [...saved?.nodeIds ?? []]);
  const [routeIds, setRoutes] = useState<string[]>(() => [...saved?.routeIds ?? []]);
  const [recipients, setRecipients] = useState<Record<string, string>>(() => Object.fromEntries(saved?.tollRecipients?.map(r => [r.routeId, r.payeePlayerId]) ?? []));
  const [checked, setChecked] = useState<Awaited<ReturnType<HarvestPreview>>>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const draft: HarvestDraft = { type: 'set-harvest-plan', plan: { nodeIds, routeIds,
    ...(routeIds.some(id => recipients[id]) ? { tollRecipients: routeIds.filter(id => recipients[id]).map(routeId => ({ routeId, payeePlayerId: recipients[routeId]! })) } : {}) } };
  const key = selectionKey(draft);
  useEffect(() => {
    if (!options) return;
    let active = true; setError(false);
    void preview(draft).then(next => { if (active) { setChecked(next); setError(!next?.options); } })
      .catch(() => { if (active) { setChecked(null); setError(true); } });
    return () => { active = false; };
  }, [key, preview, retry, !!options]);
  const advice = checked?.options && selectionKey(checked.options.draft) === key ? checked.options : null;
  const submitted = view.public.harvest?.submittedPlayerIds ?? [];
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(old => old !== id) : [...ids, id];
  return <section className="card decision harvest-panel" aria-label="采集方案">
    <div className="eyebrow">HARVEST / 同时采集</div><h2>{saved ? '已提交 · 可修改本人方案' : '规划本次采集'}</h2>
    <p>已提交 {submitted.length} / {view.public.players.length} 人：{submitted.map(id => id.toUpperCase()).join('、') || '暂无'}。全员提交后统一结算；本次收入不能垫付路费。</p>
    {!options ? <p role="status">正在读取本人采集选项，请同步局面后重试。</p> : <>
      <p>当前城市 {view.public.board.cityNodeByPlayer[view.private.playerId]}。空方案表示不采集；确认前可修改，已提交方案在全员齐备前也可替换。</p>
      <fieldset disabled={disabled}><legend>选择采集点</legend>
        {options.nodeChoices.map(node => <label className="harvest-choice" key={node.nodeId}><input type="checkbox" checked={nodeIds.includes(node.nodeId)} onChange={() => setNodes(toggle(nodeIds, node.nodeId))} />
          <span>{node.nodeId} · {assetLabels[node.resourceKind]} ×{node.harvestAmount}</span></label>)}
        {options.nodeChoices.length === 0 && <p>当前没有可采集点，可明确提交空方案。</p>}
      </fieldset>
      <fieldset disabled={disabled}><legend>连接航道 · 每条只计一次路费</legend>
        {options.routes.map(route => <div key={route.routeId} className="harvest-route"><label className="harvest-choice"><input type="checkbox" checked={routeIds.includes(route.routeId)} onChange={() => {
          setRoutes(toggle(routeIds, route.routeId)); setRecipients(old => { const next = { ...old }; delete next[route.routeId]; return next; });
        }} /><span>{route.routeId} · {route.incidentNodeIds.join(' / ')} · {route.amount === 0 ? '免费' : route.toSupply ? '2金券给供应' : '2金券给对手'}</span></label>
          {routeIds.includes(route.routeId) && route.recipientPlayerIds.length > 0 && <label>本航道收款人<select value={recipients[route.routeId] ?? ''} onChange={e => setRecipients({ ...recipients, [route.routeId]: e.target.value })}>
            <option value="">{route.recipientPlayerIds.length === 1 ? `默认 ${route.recipientPlayerIds[0]!.toUpperCase()}` : '请选择一位对手'}</option>
            {route.recipientPlayerIds.map(id => <option key={id} value={id}>{id.toUpperCase()}</option>)}
          </select></label>}
        </div>)}
      </fieldset>
      <button className="secondary" disabled={disabled} onClick={() => { setNodes([]); setRoutes([]); setRecipients({}); }}>清空为不采集方案</button>
      {advice?.quote && <div className="harvest-quote"><h3>本次方案预览</h3><p>支付 {advice.quote.total} 金券</p>
        <ul>{advice.quote.payments.map(payment => <li key={payment.routeId}>{payment.routeId}：{payment.amount} 金券{payment.amount === 0 ? '（免费）' : ` → ${payment.payeePlayerId?.toUpperCase() ?? '供应'}`}</li>)}</ul>
        <p>{Object.entries(advice.quote.gains).map(([asset, amount]) => `${assetLabels[asset]} +${amount}`).join(' · ')}</p></div>}
      {!advice && <p role="status">{error ? '预览暂不可用，请重新预览。' : '正在核对采集网络…'}</p>}
      {error && <button className="secondary" disabled={disabled} onClick={() => setRetry(n => n + 1)}>重新预览</button>}
      {advice && !advice.execution.legal && <p role="status">{reasons[advice.execution.blockedBy ?? ''] ?? '当前方案不能执行，请检查目标、连通网络、费用与收款人。'}</p>}
      <button className="primary" disabled={disabled || !advice?.execution.legal} onClick={() => { if (advice?.execution.legal) onCommand(draft); }}>{saved ? '确认替换本人方案' : '确认提交采集方案'} →</button>
    </>}
  </section>;
}
