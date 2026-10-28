import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GamePlayerView } from '@nomad-city-online/game-core';
import type { ActionOptions, TravelOptions, ConstructionOptions } from '@nomad-city-online/server';
import { emptyClient } from './client.js';
import type { ClientSnapshot } from './client.js';
import { getPlayGuide } from './play-guide.js';
import { PlayGuide } from './PlayGuide.js';
import { Board2D } from './renderers/Board2D.js';
import { loadFoundersBoard } from '@nomad-city-online/game-core';
// Transport fixtures check presentation, not authoritative game history or browser layout.
const game = (changes: Partial<GamePlayerView['public']> = {}): GamePlayerView => ({
  public: { gameId: 'guide-game', stateVersion: 7, phase: 'round-control', entry: null, finalResult: null,
    players: [{ playerId: 'p1' }, { playerId: 'p2' }], board: { cityNodeByPlayer: { p1: 'A-01', p2: 'A-02' }, resourceMarkerByNode: {}, influenceBySlot: {} },
    round: { roundNumber: 1, cycle: 1, actorId: 'p1', stage: 'player-actions', majorActionStatus: 'not-started' }, ...changes },
  private: { playerId: 'p1', placedRoleId: 'ROLE-03' },
}) as unknown as GamePlayerView;
const no = { legal: false, blockedBy: 'PENDING' }, yes = { legal: true, blockedBy: null };
function actions(changes: Partial<ActionOptions> = {}): ActionOptions {
  return { actorId: 'p1', actions: [{ action: 'dispatch', ...yes }], influence: null, travel: null, construction: null,
    quick: { window: true, role: null, patterns: [], extraActions: [], supplyCards: [], facilities: [], temporaryFacilityIds: [], exchangeMarkerIds: [], cleanupSlotIds: [], patternRouteSlotIds: [] },
    finishPattern: no, cancelPreparation: no, finishDispatch: no, finishTurn: no, ...changes };
}
function fixture(view = game(), options = actions()): ClientSnapshot {
  return { ...emptyClient(), connected: true, roomId: 'guide-room', game: view,
    actionOptions: { status: 'ready', roomId: 'guide-room', gameId: 'guide-game', stateVersion: 7, blockedReason: null, options } };
}
const round = (stage: NonNullable<GamePlayerView['public']['round']>['stage'], actorId: string | null = 'p1') => ({ ...game().public.round!, stage, actorId }) as NonNullable<GamePlayerView['public']['round']>;
function travel(status: TravelOptions['status'], changes: Partial<TravelOptions> = {}): TravelOptions {
  return { kind: 'explore', channel: 'exploration', cityMoveCost: 3, remainingMoves: null, status, targetNodeId: null, moves: [], finalSlotIds: [], event: null, ...changes };
}
function construction(changes: Partial<ConstructionOptions> = {}): ConstructionOptions {
  return { source: 'supply', status: 'ready', cells: [], emptyCellIds: [], supply: [], buildChannel: 'construction', buildChoices: [], entry: null, ...changes };
}
describe('current-player guidance without executable authority', () => {
  it('distinguishes offline, busy, waiting and the self actor without private-role text', () => {
    const state = fixture(); expect(getPlayGuide({ ...state, connected: false }).tone).toBe('sync');
    expect(getPlayGuide({ ...state, busy: true }).title).toBe('正在处理请求'); expect(getPlayGuide(state).title).toBe('轮到你选择主要行动');
    const waiting = fixture(game({ round: round('player-actions', 'p2') }), actions({ construction: construction({ source: 'authorized-deck-search' }) }));
    expect(getPlayGuide(waiting)).toMatchObject({ tone: 'waiting', title: '等待 P2 操作' }); expect(getPlayGuide(waiting).detail).not.toMatch(/检索|德克萨斯|ROLE-/);
  });
  it.each([{ roomId: 'other' }, { gameId: 'other' }, { stateVersion: 6 }])('ignores stale or mismatched action options %j', changes => {
    const state = fixture(game(), actions({ finishTurn: yes })); state.actionOptions = { ...state.actionOptions!, ...changes };
    expect(getPlayGuide(state).tone).toBe('sync'); expect(getPlayGuide(state).detail).not.toContain('结束我的行动轮');
  });
  it.each(['selecting-node', 'resolving-event', 'bonus-influence'] as const)('guides the original %s entry step and gives observers a waiting state', status => {
    const view = game({ entry: { status, actorId: 'p1', completedPlayerCount: 0, pendingEvent: null } });
    const state = fixture(view); state.entry = { status: 'ready', roomId: 'guide-room', gameId: 'guide-game', stateVersion: 7,
      options: { actorId: 'p1', status, nodeIds: [], event: null, influenceSlotIds: [], canDeclineInfluence: status === 'bonus-influence' } };
    const expected = { 'selecting-node': '轮到你选择起点', 'resolving-event': '轮到你选择入场事件', 'bonus-influence': '确认入场影响力奖励' };
    expect(getPlayGuide(state).title).toBe(expected[status]);
    state.game = game({ entry: { ...view.public.entry!, actorId: 'p2' } }); expect(getPlayGuide(state).tone).toBe('waiting');
  });
  it.each(['role-removal', 'role-placement'] as const)('links %s preparation to its actual own choices', stage => {
    const state = fixture(game({ round: round(stage) }));
    state.roundSetup = { status: 'ready', roomId: 'guide-room', gameId: 'guide-game', stateVersion: 7, blockedReason: null,
      options: stage === 'role-removal' ? { stage, actorId: 'p1', cards: [] } : { stage, actorId: 'p1', roles: [], recoversDiscard: false } };
    expect(getPlayGuide(state).title).toBe(stage === 'role-removal' ? '轮到你移除供应设施' : '轮到你盖放角色');
    const html = renderToStaticMarkup(createElement(PlayGuide, { state })); expect(html).toContain('href="#round-decision"');
  });
  it.each([
    [travel('ready'), '规划探索路径'], [travel('event-choice'), '处理已揭事件'], [travel('final-influence'), '完成末尾影响力放置'],
    [travel('ready', { kind: 'city-move', channel: 'facility-entry', cityMoveCost: 0 }), '设施入场 · 选择移城航道与目标'],
  ] as const)('guides each travel owner and real child status', (value, title) => {
    const guide = getPlayGuide(fixture(game(), actions({ travel: value }))); expect(guide.title).toBe(title);
    if (value.cityMoveCost === 0) expect(guide.detail).toContain('免费移城');
  });
  it.each([
    [construction(), '选择设施、付款与摆放格位'],
    [construction({ source: 'authorized-deck-search' }), '从本次允许检索的设施中建设'],
    [construction({ buildChannel: 'facility-entry' }), '还需完成追加建设'],
    [construction({ status: 'entry-pending', buildChannel: null }), '建设已保存，继续设施入场'],
  ] as const)('keeps construction continuations ahead of any finish-turn hint', (value, title) => {
    expect(getPlayGuide(fixture(game(), actions({ construction: value, finishTurn: yes }))).title).toBe(title);
  });
  it('separates required route placement, dispatch, pattern completion and ending a player turn', () => {
    const base = actions(), state = fixture(game(), { ...base, quick: { ...base.quick, patternRouteSlotIds: ['slot'] }, finishTurn: yes });
    expect(getPlayGuide(state).title).toContain('还需放置航道');
    expect(getPlayGuide(fixture(game(), actions({ influence: { kind: 'dispatch', status: 'ready', operationsCompleted: 1, deploymentSlotIds: [], dispatches: [] }, finishDispatch: yes }))).detail).toContain('明确结束本次调度');
    expect(getPlayGuide(fixture(game(), actions({ finishPattern: yes, finishTurn: yes }))).title).toContain('确认样式进度');
    expect(getPlayGuide(fixture(game(), actions({ finishTurn: yes }))).title).toContain('等待你结束行动轮');
  });
  it('lets every harvest member act or revise their submitted plan, independent of a turn actor', () => {
    const state = fixture(game({ phase: 'harvest', round: round('harvest', null), harvest: { roundNumber: 1, status: 'planning', submittedPlayerIds: [] } }));
    state.harvestOptions = { status: 'ready', roomId: 'guide-room', gameId: 'guide-game', stateVersion: 7, blockedReason: null, options: { nodeChoices: [], routes: [], plan: null } };
    expect(getPlayGuide(state).title).toBe('现在所有玩家同时规划采集');
    state.game = game({ ...state.game!.public, harvest: { ...state.game!.public.harvest!, submittedPlayerIds: ['p1'] } });
    expect(getPlayGuide(state)).toMatchObject({ title: '你的采集方案已保存', tone: 'waiting' }); expect(getPlayGuide(state).detail).toContain('仍可修改');
    state.harvestOptions = { ...state.harvestOptions!, stateVersion: 6 }; expect(getPlayGuide(state).tone).toBe('sync');
  });
  it('requires original cleanup choices and displays only an actual committed final result as done', () => {
    const state = fixture(game({ round: round('cleanup') })); expect(getPlayGuide(state).title).toBe('轮到你完成回合清理');
    const partial = fixture(game({ round: round('finished', null) })); expect(getPlayGuide(partial).tone).toBe('sync');
    const final = { status: 'finished' } as NonNullable<GamePlayerView['public']['finalResult']>;
    expect(getPlayGuide(fixture(game({ finalResult: final })))).toMatchObject({ title: '本局已完成', tone: 'done' });
  });
  it('renders a read-only live guide with a jump link and no mutation control', () => {
    const state = fixture(), before = JSON.stringify(state), html = renderToStaticMarkup(createElement(PlayGuide, { state }));
    expect(html).toContain('aria-live="polite"'); expect(html).toContain('href="#current-decision"'); expect(html).not.toContain('<button'); expect(JSON.stringify(state)).toBe(before);
  });
  it('shows actual revealed resource quantities and all co-located cities without changing board targets', () => {
    const board = loadFoundersBoard('three-player'), view = game();
    const shown = game({ board: { ...view.public.board, cityNodeByPlayer: { p1: 'A-01', p2: 'A-01' }, resourceMarkerByNode: { 'A-01': { markerDefinitionId: 'R05', resourceKind: 'orirock', harvestAmount: 2 } } } });
    const html = renderToStaticMarkup(createElement(Board2D, { board, view: shown, targets: { nodeIds: [], routeIds: [], slotIds: [] }, selectedNodeId: null, disabled: false, onIntent: () => { throw Error('No intent on render'); } }));
    expect(html).toContain('P1、P2 城邦'); expect(html).toContain('源岩 ×2'); expect(html).toContain('尚未揭示资源'); expect(html).toContain('disabled=""');
  });
});
