import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as core from '@nomad-city-online/game-core';
import { facilityCardView } from '../../server/src/construction-options.js';
import { PlayerPanels } from './PlayerPanels.js';
const catalog = { cells: core.FOUNDERS_FACILITY_PANEL.cells, cards: core.PROJECT_BASE_FACILITY_STOCK.cards.map(c => facilityCardView(c.id)) };
function view() {
  const ordinary = core.PROJECT_BASE_FACILITY_STOCK.cards.find(c => c.facilityId === 'FAC-010')!;
  return { public: { players: ['p1', 'p2'].map(playerId => ({ playerId, color: 'red', score: 3, markerSupplyCount: 29,
    balances: { iron: 4, originium: 2, orirock: 1, 'pure-originium': 0, 'columbia-voucher': 8 }, roles: { hasPlacedRole: true, usedRole: null, handCount: 4, discardedRoleIds: [] } })),
    board: { cityNodeByPlayer: { p1: 'A-01', p2: 'A-02' } }, facilities: { panels: [{ playerId: 'p1', placements: [{ cellId: 'CP-1-1', cardId: ordinary.id }] }, { playerId: 'p2', placements: [] }] },
    cityPatterns: { exhaustedFacilityIdsByPlayer: { p1: [ordinary.id], p2: [] } } }, private: { playerId: 'p1', placedRoleId: 'ROLE-03' } } as unknown as core.GamePlayerView;
}
describe('persistent read-only public facility panels', () => {
  it('shows both logical grids, real cards/effects/exhaustion and only the viewing member facedown identity', () => {
    const model = view(), before = JSON.stringify(model), html = renderToStaticMarkup(createElement(PlayerPanels, { view: model, catalog }));
    expect(html).toContain('德克萨斯'); expect(html).toContain('已盖放（未公开）'); expect(html).not.toContain('极境');
    expect(html).toContain('异铁冶炼厂'); expect(html).toContain('本回合已用于宣告'); expect(html).toContain('id="player-panels"');
    expect(html.match(/class="city-facility /g)).toHaveLength(24); expect(html).toContain('CP-4-3'); expect(html).toContain('查看效果');
    expect(html).not.toMatch(/<button|undefined|NaN/); expect(JSON.stringify(model)).toBe(before);
  });
  it('keeps entry and missing-catalog states readable instead of inventing facilities', () => {
    const model = view(), pending = { ...model, public: { ...model.public, facilities: null } };
    expect(renderToStaticMarkup(createElement(PlayerPanels, { view: pending, catalog }))).toContain('入场完成后显示设施面板');
    expect(renderToStaticMarkup(createElement(PlayerPanels, { view: model, catalog: null }))).toContain('正在读取设施目录');
  });
});
