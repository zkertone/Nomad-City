import { useEffect, useState } from 'react';
import type { QuickDraft, QuickPreviewResult } from '@nomad-city-online/server';
import { selectionKey } from './selection-key.js';
export type QuickPreview = (draft: QuickDraft) => Promise<Extract<QuickPreviewResult, { status: 'ready' }> | null>;
const reasons: Record<string, string> = {
  STARTING_PLAYER_ONLY: '双模式仅限起始玩家或本行动轮获得对应授权的玩家。', ACTION_PENDING: '须先完成当前行动的所有步骤。',
  ROLE_CONFLICT: '本行动轮的样式和角色使用存在冲突。', ROLE_ALREADY_USED: '本回合角色已使用。',
  CANNOT_PAY: '现有资源不足以支付完整费用。', MINIMUM_RESOURCE: '请选择当前数量最少的一种基础资源。',
  PLACEMENT_REQUIRED: '请补全所有可执行的影响力放置。', PLACEMENT_TARGET: '请检查影响力放置目标。',
  MOVE_REQUIRED: '请补全所有可执行的移动。', MOVE_TARGET: '请检查空目标位置。',
  REMOVAL_REQUIRED: '请补全可执行的移除。', RECOVERY_CHOICES: '每张原弃牌均须选择一种回收奖励。',
  PATTERN_ALREADY_USED: '本回合已使用过此样式。', PATTERN_LAYOUT: '设施组合与当前可用图案不匹配。',
  NO_AVAILABLE_MARKER: '当前供应没有可用标记。', PATTERN_MARKER_TARGET: '请选择本人实际的一级样式标记。',
  VERSION_OVERFLOW: '对局版本已用尽。', ROLE_FORMAT: '当前存档尚未启用此角色模式。',
};
export function QuickConfirmation({ draft, preview, onCommand, disabled, label = '确认执行' }: {
  readonly draft: QuickDraft | null; readonly preview: QuickPreview;
  readonly onCommand: (draft: QuickDraft) => void; readonly disabled: boolean; readonly label?: string;
}) {
  const [result, setResult] = useState<Awaited<ReturnType<QuickPreview>>>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const key = selectionKey(draft);
  useEffect(() => {
    if (!draft) { setResult(null); return; }
    let active = true; setError(false);
    void preview(draft).then(next => { if (active) { setResult(next); setError(!next?.options); } })
      .catch(() => { if (active) { setResult(null); setError(true); } });
    return () => { active = false; };
  }, [key, retry, preview]);
  const checked = result?.options && selectionKey(result.options.draft) === key ? result.options.execution : null;
  return <>
    {draft && !checked && <p role="status">{error ? '选择尚不完整或预览暂时不可用。' : '正在核对当前选择…'}</p>}
    {error && draft && <button className="secondary" disabled={disabled} onClick={() => setRetry(n => n + 1)}>重新预览</button>}
    {checked && !checked.legal && <p role="status">{reasons[checked.blockedBy ?? ''] ?? '当前选择不可执行，请检查费用、目标与操作顺序。'}</p>}
    <button className="primary" disabled={disabled || !checked?.legal} onClick={() => { if (draft && checked?.legal) onCommand(draft); }}>{label} →</button>
  </>;
}
