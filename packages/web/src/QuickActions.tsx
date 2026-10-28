import { useState } from 'react';
import type { GamePlayerView } from '@nomad-city-online/game-core';
import type { QuickOptions, QuickDraft } from '@nomad-city-online/server';
import { RoleAction } from './RoleAction.js';
import { PatternAction } from './PatternAction.js';
import { QuickConfirmation } from './QuickConfirmation.js';
import type { QuickPreview } from './QuickConfirmation.js';
import { SlotChoice } from './ChoiceControls.js';
export function QuickActions({ quick, view, disabled, preview, onCommand }: {
  readonly quick: QuickOptions; readonly view: GamePlayerView; readonly disabled: boolean;
  readonly preview: QuickPreview; readonly onCommand: (draft: QuickDraft) => void;
}) {
  const [cleanup, setCleanup] = useState(''), [route, setRoute] = useState('');
  return <div className="quick-actions">
    {quick.extraActions.map(frame => <p key={frame.patternId}>{frame.name}：当前序列尚待完成 {frame.remainingActions} 个行动（含当前）。</p>)}
    {quick.window && <>{quick.role ? <RoleAction role={quick.role} quick={quick} view={view} disabled={disabled} preview={preview} onCommand={onCommand} /> : <p>本回合角色已使用或当前没有可使用的盖放角色。</p>}
      {quick.patterns.length > 0 && <PatternAction quick={quick} view={view} disabled={disabled} preview={preview} onCommand={onCommand} />}</>}
    {quick.cleanupSlotIds.length > 0 && <section className="quick-section"><h3>雷蛇 · 回合收尾移除</h3><SlotChoice label="移除本人影响力" value={cleanup} onChange={setCleanup} view={view} disabled={disabled} ids={quick.cleanupSlotIds} />
      <QuickConfirmation draft={cleanup ? { channel: 'role-cleanup', command: { type: 'resolve-role-cleanup', slotId: cleanup } } : null} preview={preview} onCommand={onCommand} disabled={disabled} label="确认收尾移除" /></section>}
    {quick.patternRouteSlotIds.length > 0 && <section className="quick-section"><h3>样式移城 · 额外航道影响力</h3><SlotChoice label="放置到实际经过的航道" value={route} onChange={setRoute} view={view} disabled={disabled} ids={quick.patternRouteSlotIds} />
      <QuickConfirmation draft={route ? { channel: 'pattern-continuation', command: { type: 'place-pattern-route-influence', slotId: route } } : null} preview={preview} onCommand={onCommand} disabled={disabled} label="确认航道放置" /></section>}
  </div>;
}
