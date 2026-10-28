import { useState } from 'react';
import type { GamePlayerView } from '@nomad-city-online/game-core';
import type { QuickDraft, QuickOptions } from '@nomad-city-online/server';
import { QuickConfirmation } from './QuickConfirmation.js';
import type { QuickPreview } from './QuickConfirmation.js';
import { SlotChoice, AssetChoice, assetLabels } from './ChoiceControls.js';
type Role = NonNullable<QuickOptions['role']>;
type Command = Extract<QuickDraft, { channel: 'role' }>['command'];
type Strategy = NonNullable<Command['strategyChoice']>;
type Scheme = NonNullable<Command['schemeChoice']>;
type Reward = Extract<Scheme, { kind: 'recover-roles' }>['rewards'][number];
const instructions: Record<string, readonly [string, string]> = {
  'ROLE-01': ['尽量依序放置2枚影响力，回合收尾须移除1枚本人影响力。', '可支付3金券，移除并尝试在同槽放置本人的影响力。'],
  'ROLE-02': ['选择当前数量最少的一种基础资源，获得4个。', '可支付3异铁，沿指定航道免费移到符合条件的已探索相邻点，并完成末尾放置。'],
  'ROLE-03': ['将选定的公开供应设施移至牌堆底、补牌，获得12金券。', '可支付3金券，依次替换、调度、移除影响力。'],
  'ROLE-04': ['选择数量，按原价格出售资源。', '所有玩家（含自己）将选定基础资源全部按每个2金券出售，本人获得1分。'],
  'ROLE-05': ['获得1分，或按12／15金券分别购买至纯源石。', '收回此前弃牌；每张选择获得5金券或调度一枚本人影响力，不包含当前锡人。'],
};
export function RoleAction({ role, quick, view, disabled, preview, onCommand }: {
  readonly role: Role; readonly quick: QuickOptions; readonly view: GamePlayerView; readonly disabled: boolean;
  readonly preview: QuickPreview; readonly onCommand: (draft: QuickDraft) => void;
}) {
  const [mode, setMode] = useState<'' | 'strategy' | 'scheme' | 'both'>('');
  const [slots, setSlots] = useState(['', '']); const [asset, setAsset] = useState<'' | 'orirock' | 'originium' | 'iron'>('');
  const [cycle, setCycle] = useState(''), [tin, setTin] = useState<'' | 'point' | 'purchases'>('');
  const [payFirst, setFirst] = useState(false), [paySecond, setSecond] = useState(false);
  const [sales, setSales] = useState({ orirock: 0, originium: 0, iron: 0, 'pure-originium': 0 });
  const [decision, setDecision] = useState<'' | 'pay' | 'decline'>('');
  const [replace, setReplace] = useState(''), [source, setSource] = useState(''), [target, setTarget] = useState(''), [remove, setRemove] = useState('');
  const [moveKey, setMove] = useState(''), [finalSlot, setFinal] = useState('');
  const [saleAsset, setSaleAsset] = useState<'' | 'orirock' | 'originium' | 'iron'>('');
  const [recovery, setRecovery] = useState(role.discardedRoleIds.map(roleId => ({ roleId, kind: '' as '' | 'vouchers' | 'move-influence', source: '', target: '' })));
  const usesStrategy = mode === 'strategy' || mode === 'both', usesScheme = mode === 'scheme' || mode === 'both';
  let strategy: Strategy | undefined, scheme: Scheme | undefined;
  if (role.roleId === 'ROLE-01') strategy = { kind: 'liskarm-place', slotIds: slots.filter(Boolean) };
  if (role.roleId === 'ROLE-02' && asset) strategy = { kind: 'minimum-resource', asset };
  if (role.roleId === 'ROLE-03' && cycle) strategy = { kind: 'cycle-facility', cardId: cycle };
  if (role.roleId === 'ROLE-04') strategy = { kind: 'sell-resources', amounts: sales };
  if (role.roleId === 'ROLE-05' && tin) strategy = tin === 'point' ? { kind: 'tin-point' } : { kind: 'tin-purchases', payFirst, paySecond };
  if (role.roleId === 'ROLE-01' && decision) scheme = { kind: 'liskarm-replace', costDecision: decision, ...(decision === 'pay' && replace ? { slotId: replace } : {}) };
  if (role.roleId === 'ROLE-02' && decision) {
    const move = role.elysiumMoves.find(m => `${m.routeId}|${m.nodeId}` === moveKey);
    scheme = { kind: 'elysium-city-move', costDecision: decision, ...(decision === 'pay' && move ? move : {}), ...(decision === 'pay' && finalSlot ? { finalSlotId: finalSlot } : {}) };
  }
  if (role.roleId === 'ROLE-03' && decision) scheme = { kind: 'texas-influence', costDecision: decision,
    ...(decision === 'pay' ? { ...(replace ? { replaceSlotId: replace } : {}), ...(source && target ? { move: { sourceSlotId: source, targetSlotId: target } } : {}), ...(remove ? { removeSlotId: remove } : {}) } : {}) };
  if (role.roleId === 'ROLE-04' && saleAsset) scheme = { kind: 'forced-sale', asset: saleAsset };
  if (role.roleId === 'ROLE-05' && recovery.every(r => r.kind === 'vouchers' || (r.kind === 'move-influence' && r.source && r.target))) {
    const rewards: Reward[] = recovery.map(r => r.kind === 'vouchers' ? { kind: 'vouchers', roleId: r.roleId }
      : { kind: 'move-influence', roleId: r.roleId, sourceSlotId: r.source, targetSlotId: r.target });
    scheme = { kind: 'recover-roles', rewards };
  }
  const draft: QuickDraft | null = mode && (!usesStrategy || strategy) && (!usesScheme || scheme)
    ? { channel: 'role', command: { type: 'use-base-role', roleId: role.roleId, mode, ...(usesStrategy && strategy ? { strategyChoice: strategy } : {}), ...(usesScheme && scheme ? { schemeChoice: scheme } : {}) } } : null;
  const slot = (label: string, value: string, onChange: (s: string) => void) => <SlotChoice label={label} value={value} onChange={onChange} disabled={disabled} view={view} />;
  return <section className="quick-section"><h3>{role.name} · 本回合角色</h3>
    <p>策略：{instructions[role.roleId]?.[0]}</p><p>计谋：{instructions[role.roleId]?.[1]}</p>
    <label>使用方式<select value={mode} disabled={disabled} onChange={e => setMode(e.target.value as typeof mode)}><option value="">请选择模式</option>{role.modes.map(m => <option key={m} value={m}>{m === 'strategy' ? '策略' : m === 'scheme' ? '计谋' : '策略后计谋（需双模式权限）'}</option>)}</select></label>
    {usesStrategy && <div>
      {role.roleId === 'ROLE-01' && slots.map((s, i) => <div key={i}>{slot(`策略第${i + 1}次放置`, s, v => setSlots(slots.map((old, index) => index === i ? v : old)))}</div>)}
      {role.roleId === 'ROLE-02' && <AssetChoice label="最少资源" value={asset} onChange={setAsset} disabled={disabled} />}
      {role.roleId === 'ROLE-03' && <label>移至牌堆底的供应设施<select value={cycle} disabled={disabled} onChange={e => setCycle(e.target.value)}><option value="">请选择设施</option>{quick.supplyCards.map(c => <option key={c.cardId} value={c.cardId}>{c.name} · {c.cardId}</option>)}</select></label>}
      {role.roleId === 'ROLE-04' && Object.keys(sales).map(key => <label key={key}>{assetLabels[key]}出售数量<input type="number" min="0" step="1" value={sales[key as keyof typeof sales]} disabled={disabled} onChange={e => setSales({ ...sales, [key]: Number(e.target.value) })} /></label>)}
      {role.roleId === 'ROLE-05' && <><label>策略选择<select value={tin} disabled={disabled} onChange={e => setTin(e.target.value as typeof tin)}><option value="">请选择效果</option><option value="point">获得1分</option><option value="purchases">选择购买至纯源石</option></select></label>{tin === 'purchases' && <><label><input type="checkbox" checked={payFirst} disabled={disabled} onChange={e => setFirst(e.target.checked)} />支付12金券购买1个</label><label><input type="checkbox" checked={paySecond} disabled={disabled} onChange={e => setSecond(e.target.checked)} />支付15金券购买1个</label></>}</>}
    </div>}
    {usesScheme && <div>
      {['ROLE-01', 'ROLE-02', 'ROLE-03'].includes(role.roleId) && <label>是否支付计谋前提<select value={decision} disabled={disabled} onChange={e => setDecision(e.target.value as typeof decision)}><option value="">请明确选择</option><option value="pay">支付并执行</option><option value="decline">不支付，不执行此计谋效果</option></select></label>}
      {decision === 'pay' && role.roleId === 'ROLE-01' && slot('替换位置', replace, setReplace)}
      {decision === 'pay' && role.roleId === 'ROLE-02' && <><label>相邻目标与航道<select value={moveKey} disabled={disabled} onChange={e => setMove(e.target.value)}><option value="">无可执行目标时留空</option>{role.elysiumMoves.map(m => <option key={`${m.routeId}|${m.nodeId}`} value={`${m.routeId}|${m.nodeId}`}>{m.routeId} → {m.nodeId}</option>)}</select></label>{slot('移城末尾放置', finalSlot, setFinal)}</>}
      {decision === 'pay' && role.roleId === 'ROLE-03' && <>{slot('先替换', replace, setReplace)}{slot('随后调度来源', source, setSource)}{slot('调度目标', target, setTarget)}{slot('最后移除', remove, setRemove)}</>}
      {role.roleId === 'ROLE-04' && <AssetChoice label="所有人强制出售的资源" value={saleAsset} onChange={setSaleAsset} disabled={disabled} />}
      {role.roleId === 'ROLE-05' && <><p>按列表顺序执行回收奖励，可调整顺序。</p>{recovery.length === 0 && <p>此前没有弃牌，仍可确认使用计谋。</p>}{recovery.map((r, i) => <div className="quick-row" key={r.roleId}><strong>{r.roleId}</strong><select value={r.kind} disabled={disabled} onChange={e => setRecovery(recovery.map((row, n) => n === i ? { ...row, kind: e.target.value as typeof r.kind } : row))}><option value="">请选择奖励</option><option value="vouchers">获得5金券</option><option value="move-influence">调度本人影响力</option></select>
        {r.kind === 'move-influence' && <>{slot('来源', r.source, v => setRecovery(recovery.map((row, n) => n === i ? { ...row, source: v } : row)))}{slot('目标', r.target, v => setRecovery(recovery.map((row, n) => n === i ? { ...row, target: v } : row)))}</>}
        {i > 0 && <button className="text-button" disabled={disabled} onClick={() => { const next = [...recovery]; [next[i - 1], next[i]] = [next[i]!, next[i - 1]!]; setRecovery(next); }}>上移此奖励</button>}
      </div>)}</>}
    </div>}
    <p>确认后本回合角色进入弃牌，不能重复使用；双模式按策略→计谋一次结算。</p>
    <QuickConfirmation draft={draft} preview={preview} onCommand={onCommand} disabled={disabled} label="确认使用角色" />
  </section>;
}
