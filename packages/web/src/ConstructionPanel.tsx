import { useEffect, useState } from 'react';
import type { GamePlayerView } from '@nomad-city-online/game-core';
import type { ConstructionOptions, ConstructionDraft, ConstructionPreviewResult } from '@nomad-city-online/server';

import { selectionKey } from './selection-key.js';

type Preview = Extract<ConstructionPreviewResult, { status: 'ready' }>;
type EntryChoice = Extract<Extract<ConstructionDraft, { channel: 'facility-entry' }>['command'], { type: 'resolve-facility-entry' }>['entryChoice'];
const assets: Record<string, string> = { orirock: '源岩', originium: '源石', iron: '异铁',
  'pure-originium': '至纯源石', 'columbia-voucher': '金券' };
const colors: Record<string, string> = { red: '红', blue: '蓝', yellow: '黄', rainbow: '虹' };
const reasons: Record<string, string> = {
  FACILITY_FORMAT: '此存档尚未启用该入场流程，不能直接执行。', WAREHOUSE_FORMAT: '此存档尚未启用仓库入场流程。',
  CANNOT_PAY: '现有资源不足；入场收益不能提前用于付款。', REFILL_RULE_UNRESOLVED: '当前供应无法补齐，暂不能建设。',
  UNIQUE_FACILITY: '本人已拥有此唯一设施。', PLACEMENT_INVALID: '请检查设施来源与空格位。',
  REMOVAL_REQUIRED: '有可移除标记时须完成规定数量的移除。', MOVE_REQUIRED: '请补全放置后的影响力调度。',
  PLACEMENT_TARGET: '请检查影响力放置位置。', MOVE_TARGET: '请选择合法空目标。', MOVE_SOURCE: '请选择本人的影响力。',
  ENTRY_CHOICE: '请补全此设施的入场选择。', VERSION_OVERFLOW: '对局版本已用尽，当前无法提交。',
};
export function ConstructionPanel({ view, options, disabled, preview, onCommand }: {
  readonly view: GamePlayerView; readonly options: ConstructionOptions; readonly disabled: boolean;
  readonly preview: (draft: ConstructionDraft) => Promise<Preview | null>;
  readonly onCommand: (draft: ConstructionDraft) => void;
}) {
  const [cardId, setCard] = useState(''), [cellId, setCell] = useState('');
  const [payment, setPayment] = useState<'' | 'resources' | 'vouchers'>('');
  const [firstSlot, setFirstSlot] = useState(''), [secondSlot, setSecondSlot] = useState(''), [thirdSlot, setThirdSlot] = useState('');
  const [effect, setEffect] = useState<'' | 'remove' | 'replace'>('');
  const [copyId, setCopy] = useState(''), [extensionId, setExtension] = useState(''), [declineExtension, setDecline] = useState(false);
  const [gains, setGains] = useState({ orirock: 0, originium: 0, iron: 0 });
  const [sales, setSales] = useState({ orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 });
  const [result, setResult] = useState<Preview | null>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const entry = options.entry;
  const selected = options.supply.find(c => c.cardId === cardId);
  const resolveEntry = (entryChoice: EntryChoice): ConstructionDraft => entry?.channel === 'warehouse-entry'
    ? { channel: 'warehouse-entry', command: { type: 'choose-warehouse-entry', entryChoice } }
    : { channel: 'facility-entry', command: { type: 'resolve-facility-entry', entryChoice } };
  let draft: ConstructionDraft | null = null;
  if (options.buildChannel && cardId && cellId && payment) {
    const body = { cardId, cellId, paymentMode: payment, entryChoice: { kind: 'deferred-entry' as const } };
    draft = options.buildChannel === 'construction' ? { channel: 'construction', command: { type: 'construct-facility', ...body } }
      : { channel: 'facility-entry', command: { type: 'construct-entry-facility', ...body } };
  } else if (entry?.kind === 'remove-two-influence') draft = resolveEntry({ kind: 'remove-influence', slotIds: [firstSlot, secondSlot].filter(Boolean) });
  else if (entry?.kind === 'replace-or-remove-influence' && effect) draft = resolveEntry({ kind: 'mercenary-influence', effect, ...(firstSlot ? { slotId: firstSlot } : {}) });
  else if (entry?.kind === 'sell-resources') draft = resolveEntry({ kind: 'sell-resources', amounts: sales });
  else if (entry?.kind === 'choose-five-resources' && Object.values(gains).every(n => Number.isInteger(n) && n >= 0 && n <= 5) && Object.values(gains).reduce((sum, n) => sum + n, 0) === 5)
    draft = resolveEntry({ kind: 'resource-allocation', gains });
  else if (entry?.kind === 'warehouse') draft = resolveEntry({ kind: 'warehouse-influence', ...(firstSlot ? { placeSlotId: firstSlot } : {}),
    ...(secondSlot && thirdSlot ? { move: { sourceSlotId: secondSlot, targetSlotId: thirdSlot } } : {}) });
  else if (entry?.kind === 'copy-entry' && copyId) draft = { channel: 'facility-entry', command: { type: 'copy-facility-entry', targetCardId: copyId } };
  else if (entry?.kind === 'logistics' && (declineExtension || (extensionId && cellId))) draft = { channel: 'facility-entry', command: {
    type: 'build-logistics-extension', placement: declineExtension ? null : { cardId: extensionId, cellId } } };
  else if (entry?.routeSlotIds.length && firstSlot) draft = { channel: 'facility-entry', command: { type: 'place-entry-route-influence', slotId: firstSlot } };
  const key = selectionKey(draft);
  useEffect(() => {
    if (!draft) { setResult(null); return; }
    let active = true; setError(false);
    void preview(draft).then(next => { if (active) { setResult(next); setError(!next?.options); } })
      .catch(() => { if (active) { setResult(null); setError(true); } });
    return () => { active = false; };
  }, [key, retry, preview]);
  const checked = result?.options && selectionKey(result.options.draft) === key ? result.options : null;
  const slotSelect = (label: string, value: string, onChange: (id: string) => void, ids = Object.keys(view.public.board.influenceBySlot)) => <label>{label}
    <select disabled={disabled} value={value} onChange={e => { setResult(null); onChange(e.target.value); }}><option value="">请选择／无可执行步骤时留空</option>
      {ids.map(id => <option key={id} value={id}>{id} · {view.public.board.influenceBySlot[id]?.ownerPlayerId.toUpperCase() ?? '空槽'}</option>)}
    </select></label>;
  return <div className="construction-panel">
    <h3>城邦设施 · {options.buildChannel === 'facility-entry' ? '追加建设' : options.status === 'ready' ? '建设' : options.status === 'complete' ? '本次建设已完成' : '入场效果'}</h3>
    <div className="facility-grid" aria-label="本人四行三列设施面板">{options.cells.map(cell => <button key={cell.id}
      style={{ gridRow: cell.row + 1, gridColumn: cell.column + 1 }}
      disabled={disabled || !options.emptyCellIds.includes(cell.id) || (!options.buildChannel && entry?.kind !== 'logistics')}
      className={cellId === cell.id ? 'facility-cell selected' : 'facility-cell'}
      aria-pressed={cellId === cell.id} onClick={() => { setResult(null); setCell(cell.id); }}>
      <small>{cell.id}</small><strong>{cell.card?.name ?? '空格'}</strong>{cell.card && <span>{colors[cell.card.color]}色 · {cell.card.points}分</span>}
    </button>)}</div>
    {options.buildChannel && <>
      <p>选择公开供应设施、付款方式和上方面板空格。确认后支付、补牌、摆放与计分，再继续入场效果。</p>
      <label>供应设施<select disabled={disabled} value={cardId} onChange={e => { setResult(null); setCard(e.target.value); setPayment(''); }}>
        <option value="">请选择设施</option>{options.supply.filter(c => options.buildChoices.some(b => b.cardId === c.cardId)).map(c => <option key={c.cardId} value={c.cardId}>{c.name} · {colors[c.color]}色 · {c.points}分 · {c.cardId}</option>)}
      </select></label>
      {selected && <p>{selected.effect}</p>}
      <label>付款方式<select disabled={disabled} value={payment} onChange={e => { setResult(null); setPayment(e.target.value as '' | 'resources' | 'vouchers'); }}>
        <option value="">请选择付款方式</option>{(['resources', 'vouchers'] as const).filter(mode => options.buildChoices.some(b => b.cardId === cardId && b.paymentMode === mode)).map(mode => <option key={mode} value={mode}>{mode === 'resources' ? '资源组合' : '金券替代'}</option>)}
      </select></label><p>摆放格位：{cellId || '请点击上方空格'}</p>
    </>}
    {entry?.source && <><h4>{entry.source.name} · 入场效果</h4><p>{entry.source.effect}</p></>}
    {entry?.kind === 'remove-two-influence' && <>{slotSelect('第一个移除位置', firstSlot, setFirstSlot)}{slotSelect('第二个移除位置', secondSlot, setSecondSlot)}</>}
    {entry?.kind === 'replace-or-remove-influence' && <><label>效果<select disabled={disabled} value={effect} onChange={e => { setResult(null); setEffect(e.target.value as '' | 'remove' | 'replace'); }}><option value="">请选择</option><option value="replace">替换影响力</option><option value="remove">移除影响力</option></select></label>{slotSelect('效果位置', firstSlot, setFirstSlot)}</>}
    {entry?.kind === 'warehouse' && <>
      <p>可选择先放置一枚再调度一枚影响力；有可执行步骤时须完成。也可选择下方的探索分支。</p>
      {slotSelect('先放置的位置', firstSlot, setFirstSlot)}{slotSelect('随后调度的来源（可选刚放置的标记）', secondSlot, setSecondSlot)}{slotSelect('调度目标', thirdSlot, setThirdSlot)}
      {entry.channel === 'warehouse-entry' && entry.skipExploration?.legal && <button className="secondary" disabled={disabled}
        onClick={() => onCommand({ channel: 'warehouse-entry', command: { type: 'choose-warehouse-entry', entryChoice: { kind: 'warehouse-explore' } } })}>当前无可探索目标，确认完成探索分支</button>}
      {entry.channel === 'facility-entry' && <button className="secondary" disabled={disabled}
        onClick={() => onCommand({ channel: 'facility-entry', command: { type: 'resolve-facility-entry', entryChoice: { kind: 'warehouse-explore' } } })}>选择探索分支 →</button>}
    </>}
    {entry?.kind === 'choose-five-resources' && <><p>分配合计5个基础资源。</p>{(Object.keys(gains) as (keyof typeof gains)[]).map(asset => <label key={asset}>{assets[asset]}<input type="number" min="0" max="5" step="1" disabled={disabled} value={gains[asset]} onChange={e => { setResult(null); setGains({ ...gains, [asset]: Number(e.target.value) }); }} /></label>)}</>}
    {entry?.kind === 'sell-resources' && <><p>选择本次出售数量；可明确确认全部为0。</p>{(Object.keys(sales) as (keyof typeof sales)[]).map(asset => <label key={asset}>{assets[asset]}<input type="number" min="0" step="1" disabled={disabled} value={sales[asset]} onChange={e => { setResult(null); setSales({ ...sales, [asset]: Number(e.target.value) }); }} /></label>)}</>}
    {entry?.kind === 'copy-entry' && <label>复制相邻设施入场<select disabled={disabled} value={copyId} onChange={e => { setResult(null); setCopy(e.target.value); }}><option value="">请选择设施</option>{entry.copyCards.map(c => <option key={c.cardId} value={c.cardId}>{c.name} · {c.cardId}</option>)}</select></label>}
    {entry?.kind === 'logistics' && <><label><input type="checkbox" disabled={disabled} checked={declineExtension} onChange={e => { setResult(null); setDecline(e.target.checked); }} /> 不放置延伸枢纽</label>
      {!declineExtension && <label>延伸枢纽（免费）<select disabled={disabled} value={extensionId} onChange={e => { setResult(null); setExtension(e.target.value); }}><option value="">请选择，再点击上方空格</option>{entry.extensionCards.map(c => <option key={c.cardId} value={c.cardId}>{c.name} · {colors[c.color]}色</option>)}</select></label>}</>}
    {!!entry?.routeSlotIds.length && slotSelect('免费移城后的额外航道影响力', firstSlot, setFirstSlot, [...entry.routeSlotIds])}
    {draft && <>
      {checked?.quote && <p className="construction-quote">建设费用：{checked.quote.costs.length ? checked.quote.costs.map(c => `${assets[c.asset]} ${c.amount}`).join(' + ') : '0'}；印刷分数 {checked.quote.printedPoints}；源岩折扣 {checked.quote.orirockDiscount}</p>}
      {!checked && <p role="status">{error ? '输入尚不完整或预览暂时不可用，请调整选择或重新预览。' : '正在核对当前选择…'}</p>}
      {error && <button className="secondary" disabled={disabled} onClick={() => setRetry(n => n + 1)}>重新预览</button>}
      {checked && !checked.execution.legal && <p role="status">{reasons[checked.execution.blockedBy ?? ''] ?? '当前选择不可执行，请检查资源、格位和影响力选择。'}</p>}
      <button className="primary" disabled={disabled || !checked?.execution.legal} onClick={() => { if (checked?.execution.legal && draft) onCommand(draft); }}>确认{options.buildChannel ? '付款并建设' : '入场选择'} →</button>
    </>}
  </div>;
}
