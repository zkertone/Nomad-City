import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FinalScoringResult, GamePlayerView } from '@nomad-city-online/game-core';
import type { HarvestOptionsResult } from '@nomad-city-online/server';
import { FinalResults } from './FinalResults.js';
import { HarvestPanel } from './HarvestPanel.js';
// Public transport fixtures exercise semantic markup; they are not generated game history or visual QA.
function result(resolvedBy: FinalScoringResult['resolvedBy']): FinalScoringResult {
  const score = { existingPoints: 7, regionPoints: 3, resources: { pointsByAsset: { orirock: 1, originium: 1, iron: 1, 'pure-originium': 2 }, unscoredRemainders: { orirock: 4, originium: 5, iron: 2, 'pure-originium': 0 }, totalPoints: 5 }, totalPoints: 15, remainingVouchers: 12, remainingPureOriginium: 2 };
  const influence = { nodeMarkers: 1, routeMarkers: 0, cityInfluence: 2, total: 3 };
  return { schemaVersion: '1.0.0', gameId: 'results', stateVersion: 120, status: 'finished', completedRounds: 8, sourceStateVersion: 119,
    players: { p1: score, p2: score }, regions: { A: { regionId: 'A', rewardPoints: 3, influenceByPlayer: { p1: influence, p2: influence }, leadingPlayerIds: ['p1', 'p2'], controllerPlayerId: null } },
    winnerPlayerIds: resolvedBy === 'shared' ? ['p2', 'p1'] : ['p2'], resolvedBy, rankingGroups: resolvedBy === 'shared' ? [['p2', 'p1']] : [['p2'], ['p1']] };
}
describe('committed results and harvest semantic presentation', () => {
  it.each(['score', 'columbia-voucher', 'pure-originium', 'shared'] as const)('displays the server %s outcome, ranking groups, awards and ties without a scoring command', basis => {
    const value = result(basis), before = JSON.stringify(value), html = renderToStaticMarkup(createElement(FinalResults, { result: value, selfPlayerId: 'p1' }));
    expect(html).toContain('已完成 8 回合'); expect(html).toContain('最终排名与得分明细'); expect(html).toContain('P1 · 你'); expect(html).toContain('并列，无控制者');
    expect(html).toContain('<strong>15</strong>'); expect(html).toContain('1 / 4'); expect(html).not.toMatch(/<button|<input|NaN|undefined/);
    expect(html.indexOf('<th>P2')).toBeLessThan(html.indexOf('<th>P1')); expect(JSON.stringify(value)).toBe(before);
    if (basis === 'shared') { expect(html).toContain('共同胜利'); expect(html).toContain('1（并列）'); }
  });
  it('restores only the saved own plan and shows explicit submission controls with original route advice', () => {
    const view = { public: { players: [{ playerId: 'p1' }, { playerId: 'p2' }], board: { cityNodeByPlayer: { p1: 'A-01' } }, harvest: { submittedPlayerIds: ['p1'] } }, private: { playerId: 'p1' } } as unknown as GamePlayerView;
    const choices: Extract<HarvestOptionsResult, { status: 'ready' }> = { status: 'ready', roomId: 'room', gameId: 'game', stateVersion: 8, blockedReason: null,
      options: { plan: { nodeIds: ['A-01'], routeIds: ['R-route-01'], tollRecipients: [{ routeId: 'R-route-01', payeePlayerId: 'p2' }] }, nodeChoices: [{ nodeId: 'A-01', resourceKind: 'iron', harvestAmount: 2 }],
        routes: [{ routeId: 'R-route-01', amount: 2, toSupply: false, recipientPlayerIds: ['p2'], incidentNodeIds: ['A-01', 'D-01'] }] } };
    const html = renderToStaticMarkup(createElement(HarvestPanel, { view, result: choices, disabled: false, preview: async () => null, onCommand: () => { throw Error('Must not submit on render'); } }));
    expect(html).toContain('已提交 · 可修改本人方案'); expect(html).toContain('已提交 1 / 2 人'); expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain('<option value="p2" selected="">P2</option>'); expect(html).toContain('确认替换本人方案');
    expect(html).toContain('清空为不采集方案'); expect(html).toContain('异铁 ×2'); expect(html).toMatch(/<button class="primary" disabled=""/);
  });
});
