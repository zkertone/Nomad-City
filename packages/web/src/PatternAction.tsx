import { useState } from 'react';
import type { GamePlayerView } from '@nomad-city-online/game-core';
import type { QuickDraft, QuickOptions } from '@nomad-city-online/server';
import { QuickConfirmation } from './QuickConfirmation.js';
import type { QuickPreview } from './QuickConfirmation.js';
import { SlotChoice, assetLabels } from './ChoiceControls.js';
type Pattern = QuickOptions['patterns'][number];
type PatternCommand = Extract<QuickDraft, { channel: 'city-pattern' }>['command'];
type Effect = Extract<PatternCommand, { type: 'use-pattern-special' }>['effect'];
type Tactical = Extract<Effect, { kind: 'security' }>['choices'][number];
const colors: Record<string, string> = { red: '红', blue: '蓝', yellow: '黄', rainbow: '虹' };
function PatternSpecial({ pattern, view, disabled, preview, onCommand }: {
  readonly pattern: Pattern; readonly view: GamePlayerView; readonly disabled: boolean;
  readonly preview: QuickPreview; readonly onCommand: (draft: QuickDraft) => void;
}) {
  const [markerId, setMarker] = useState(''), [slotId, setSlot] = useState(''), [placements, setPlacements] = useState(['', '', '']);
  const [tactics, setTactics] = useState(Array.from({ length: 2 }, () => ({ kind: '' as '' | 'replace' | 'place' | 'remove', decision: '' as '' | 'pay' | 'decline', slot: '' })));
  const [moves, setMoves] = useState<{ sourceSlotId: string; targetSlotId: string }[]>([]);
  const [orirock, setRock] = useState(0), [iron, setIron] = useState(0), [reward, setReward] = useState<'' | 'columbia-voucher' | 'orirock' | 'originium' | 'iron'>('');
  let effect: Effect | undefined;
  if (pattern.id === 'PAT-001') effect = { kind: 'replace', ...(slotId ? { slotId } : {}) };
  if (pattern.id === 'PAT-005') effect = { kind: 'military', slotIds: placements.filter(Boolean) };
  if (pattern.id === 'PAT-009' && tactics.every(t => t.kind && (t.kind !== 'replace' || t.decision))) {
    const choices: Tactical[] = tactics.map(t => t.kind === 'replace'
      ? { kind: 'replace', costDecision: t.decision === 'pay' ? 'pay' : 'decline', ...(t.decision === 'pay' && t.slot ? { slotId: t.slot } : {}) }
      : { kind: t.kind === 'place' ? 'place' : 'remove', ...(t.slot ? { slotId: t.slot } : {}) });
    effect = { kind: 'security', choices };
  }
  if (pattern.id === 'PAT-011' && moves.every(m => m.sourceSlotId && m.targetSlotId)) effect = { kind: 'outpost', slotIds: placements.slice(0, 2).filter(Boolean), moves };
  if (pattern.id === 'PAT-004') effect = { kind: 'composite-move', orirock, iron };
  if (pattern.id === 'PAT-006') effect = { kind: 'double-move' };
  if (pattern.id === 'PAT-012') effect = { kind: 'deck-construction' };
  if (pattern.id === 'PAT-003') effect = { kind: 'industry-actions' };
  if (pattern.id === 'PAT-008' && reward) effect = { kind: 'commercial-action', reward };
  if (pattern.id === 'PAT-010') effect = { kind: 'command-action' };
  const draft: QuickDraft | null = markerId && effect ? { channel: 'city-pattern', command: { type: 'use-pattern-special', patternId: pattern.id, markerId, effect } } : null;
  const slot = (label: string, value: string, onChange: (s: string) => void) => <SlotChoice label={label} value={value} onChange={onChange} view={view} disabled={disabled} />;
  if (!pattern.special) return <p>当前没有可使用的本人样式标记、次数或行动权限。</p>;
  return <>
    <p>剩余次数 {pattern.special.remainingUses} · 本人标记 {pattern.special.markerCount}。此特殊行动替代本轮主要行动。</p>
    <label>使用本人样式标记<select value={markerId} disabled={disabled} onChange={e => setMarker(e.target.value)}><option value="">请选择标记</option>{pattern.special.markerIds.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
    {pattern.id === 'PAT-001' && slot('替换位置', slotId, setSlot)}
    {pattern.id === 'PAT-005' && placements.slice(0, Math.min(3, pattern.special.markerCount)).map((id, i) => <div key={i}>{slot(`第${i + 1}次放置`, id, v => setPlacements(placements.map((old, n) => i === n ? v : old)))}</div>)}
    {pattern.id === 'PAT-009' && tactics.map((t, i) => <div className="quick-row" key={i}><h4>第{i + 1}个战术选择</h4><select value={t.kind} disabled={disabled} onChange={e => setTactics(tactics.map((row, n) => n === i ? { ...row, kind: e.target.value as typeof t.kind } : row))}><option value="">请选择</option><option value="replace">可付2源岩＋1异铁替换</option><option value="place">放置并获得1源石</option><option value="remove">移除并获得2异铁</option></select>
      {t.kind === 'replace' && <select value={t.decision} disabled={disabled} onChange={e => setTactics(tactics.map((row, n) => n === i ? { ...row, decision: e.target.value as typeof t.decision } : row))}><option value="">是否支付</option><option value="pay">支付并替换</option><option value="decline">不支付，不替换</option></select>}
      {t.kind && (t.kind !== 'replace' || t.decision === 'pay') && slot('本步位置', t.slot, v => setTactics(tactics.map((row, n) => n === i ? { ...row, slot: v } : row)))}
    </div>)}
    {pattern.id === 'PAT-011' && <><p>先尽量在城市资源点放置2枚，再按本人样式标记数依序调度。</p>{placements.slice(0, 2).map((id, i) => <div key={i}>{slot(`城市第${i + 1}次放置`, id, v => setPlacements(placements.map((old, n) => i === n ? v : old)))}</div>)}
      {moves.map((m, i) => <div className="quick-row" key={i}>{slot(`第${i + 1}次来源`, m.sourceSlotId, v => setMoves(moves.map((row, n) => n === i ? { ...row, sourceSlotId: v } : row)))}{slot('目标', m.targetSlotId, v => setMoves(moves.map((row, n) => n === i ? { ...row, targetSlotId: v } : row)))}<button className="text-button" disabled={disabled} onClick={() => setMoves(moves.filter((_, n) => n !== i))}>移除此步</button></div>)}
      <button className="secondary" disabled={disabled || moves.length >= Math.min(29, pattern.special.markerCount)} onClick={() => setMoves([...moves, { sourceSlotId: '', targetSlotId: '' }])}>添加一次调度</button>
    </>}
    {pattern.id === 'PAT-004' && <><p>另支付1源石，源岩与异铁合计3个。</p><label>源岩<input type="number" min="0" max="3" step="1" value={orirock} disabled={disabled} onChange={e => setRock(Number(e.target.value))} /></label><label>异铁<input type="number" min="0" max="3" step="1" value={iron} disabled={disabled} onChange={e => setIron(Number(e.target.value))} /></label></>}
    {pattern.id === 'PAT-008' && <label>先获得的奖励<select value={reward} disabled={disabled} onChange={e => setReward(e.target.value as typeof reward)}><option value="">请选择奖励</option>{(['columbia-voucher', 'orirock', 'originium', 'iron'] as const).map(a => <option key={a} value={a}>{assetLabels[a]} {a === 'columbia-voucher' ? 4 : 1}</option>)}</select></label>}
    <QuickConfirmation draft={draft} preview={preview} onCommand={onCommand} disabled={disabled} label="确认特殊行动" />
  </>;
}
export function PatternAction({ quick, view, disabled, preview, onCommand }: {
  readonly quick: QuickOptions; readonly view: GamePlayerView; readonly disabled: boolean;
  readonly preview: QuickPreview; readonly onCommand: (draft: QuickDraft) => void;
}) {
  const [patternId, setPattern] = useState(''), [operation, setOperation] = useState<'' | 'declare' | 'special'>('');
  const [matchId, setMatch] = useState(''), [returnMarkerId, setReturnMarker] = useState(''), [returnTemporary, setReturnTemporary] = useState(false);
  const pattern = quick.patterns.find(p => p.id === patternId), match = matchId === '' ? null : pattern?.matches[Number(matchId)];
  const temporaryIds = match?.facilityCardIds.filter(id => quick.temporaryFacilityIds.includes(id)) ?? [];
  const declaration: QuickDraft | null = pattern && match && pattern.supported && pattern.hasAvailableMarker && (pattern.declarationEffect !== 'exchange-pattern-marker' || returnMarkerId)
    ? { channel: 'city-pattern', command: { type: 'declare-city-pattern', patternId: pattern.id, facilityCardIds: [...match.facilityCardIds],
      ...(pattern.declarationEffect === 'exchange-pattern-marker' ? { returnMarkerId } : {}),
      ...(view.public.snapshotVersion === '1.16.0' && returnTemporary ? { returnTemporaryFacilityIds: [...temporaryIds] } : {}) } } : null;
  return <section className="quick-section"><h3>城市样式</h3>
    <label>本局公开样式<select value={patternId} disabled={disabled} onChange={e => { setPattern(e.target.value); setOperation(''); setMatch(''); setReturnMarker(''); setReturnTemporary(false); }}><option value="">请选择样式</option>{quick.patterns.map(p => <option key={p.id} value={p.id}>{p.name} · {p.level}级 · {p.score}分</option>)}</select></label>
    {pattern && <><p>{pattern.effectText}</p>
      <div className="pattern-shape" aria-label={`${pattern.name}原始图案`}>{Array.from({ length: 9 }, (_, i) => { const cell = pattern.cells.find(c => c.row === Math.floor(i / 3) && c.column === i % 3); return <span className={cell ? 'pattern-square' : 'pattern-square empty'} key={i}>{cell?.colors.map(c => colors[c]).join('/') ?? '·'}</span>; })}</div>
      <p>可旋转匹配；请选择已核验的本人设施组合。</p>
      <div className="action-choices"><button className="secondary" disabled={disabled} onClick={() => setOperation('declare')}>宣告样式</button><button className="secondary" disabled={disabled || !pattern.special} onClick={() => setOperation('special')}>使用特殊行动</button></div>
      {operation === 'declare' && <>
        <label>可宣告的设施组合<select value={matchId} disabled={disabled} onChange={e => { setMatch(e.target.value); setReturnTemporary(false); }}><option value="">请选择组合</option>{pattern.matches.map((m, i) => <option key={i} value={i}>{m.rotation}° · {m.assignments.map(a => a.cellId).join(' / ')}</option>)}</select></label>
        {!pattern.matches.length && <p>当前没有未使用且匹配的设施组合。</p>}
        {match && <ul>{match.assignments.map(a => <li key={a.cardId}>{a.cellId} · {quick.facilities.find(f => f.cardId === a.cardId)?.name ?? a.cardId} · {colors[a.actualColor]}</li>)}</ul>}
        {pattern.declarationEffect === 'exchange-pattern-marker' && <label>返还本人一级样式标记<select value={returnMarkerId} disabled={disabled} onChange={e => setReturnMarker(e.target.value)}><option value="">请选择标记</option>{quick.exchangeMarkerIds.map(id => <option key={id} value={id}>{id === view.private.markerSupplyIds[0] ? '本次新放置的一级标记' : id}</option>)}</select></label>}
        {temporaryIds.length > 0 && view.public.snapshotVersion === '1.16.0' && <label><input type="checkbox" checked={returnTemporary} disabled={disabled} onChange={e => setReturnTemporary(e.target.checked)} /> 将本次使用的临时聚居点放回盒中并获得12金券</label>}
        <QuickConfirmation draft={declaration} preview={preview} onCommand={onCommand} disabled={disabled} label="确认宣告" />
      </>}
      {operation === 'special' && <PatternSpecial key={pattern.id} pattern={pattern} view={view} disabled={disabled} preview={preview} onCommand={onCommand} />}
    </>}
  </section>;
}
