import type { facilityCardView } from '@nomad-city-online/server';
export interface PlayerFacilityCatalog { readonly cards: readonly ReturnType<typeof facilityCardView>[]; readonly cells: readonly { readonly id: string; readonly row: number; readonly column: number }[] }
import type { GamePlayerView } from '@nomad-city-online/game-core';
import { assetLabels } from './ChoiceControls.js';
const colors: Record<string, string> = { red: '红', blue: '蓝', yellow: '黄', rainbow: '虹' };
const roles: Record<string, string> = { 'ROLE-01': '雷蛇', 'ROLE-02': '极境', 'ROLE-03': '德克萨斯', 'ROLE-04': '坎诺特', 'ROLE-05': '锡人' };
const roleName = (id: string) => roles[id] ?? id;
/** Read-only public panels; private facedown identities are shown only for the viewing member. */
export function PlayerPanels({ view, catalog }: { readonly view: GamePlayerView; readonly catalog: PlayerFacilityCatalog | null }) {
  return <section id="player-panels" aria-label="玩家城邦与设施"><h2>玩家城邦 · 设施面板</h2><div className="player-summary">
    {view.public.players.map(player => {
      const own = player.playerId === view.private.playerId, panel = view.public.facilities?.panels.find(p => p.playerId === player.playerId);
      const used = view.public.cityPatterns?.exhaustedFacilityIdsByPlayer[player.playerId] ?? [];
      return <section className="card city-panel" key={player.playerId}><h3><span className="color-dot" data-color={player.color} />{player.playerId.toUpperCase()}{own ? ' · 你' : ''}<span>{player.score} 分</span></h3>
        <div className="city-balances">{Object.entries(player.balances).map(([asset, amount]) => <span key={asset}><small>{assetLabels[asset]}</small><strong>{amount}</strong></span>)}</div>
        <p>城市位置：{view.public.board.cityNodeByPlayer[player.playerId] ?? '尚未入场'} · 供应标记：{player.markerSupplyCount}</p>
        {player.roles && <p>角色：{player.roles.usedRole ? `已使用${roleName(player.roles.usedRole.roleId)}` : player.roles.hasPlacedRole ? own && view.private.placedRoleId ? roleName(view.private.placedRoleId) : '已盖放（未公开）' : '尚未盖放'} · 手牌 {player.roles.handCount} 张</p>}
        {!panel ? <p>入场完成后显示设施面板。</p> : !catalog ? <p>正在读取设施目录，请刷新页面后重试。</p> : <div className="city-facilities" aria-label={`${player.playerId.toUpperCase()}四行三列设施面板`}>
          {catalog.cells.map(cell => {
            const placement = panel.placements.find(p => p.cellId === cell.id), card = placement ? catalog.cards.find(c => c.cardId === placement.cardId) : null;
            return <div className={`city-facility ${card ? 'occupied' : 'empty'}`} key={cell.id} data-color={card?.color}
              style={{ gridRow: cell.row + 1, gridColumn: cell.column + 1 }}><small>{cell.id}</small>
              <strong>{card?.name ?? (placement ? placement.cardId : '空格')}</strong>{card && <><span>{colors[card.color]}色 · {card.points} 分</span>
                {used.includes(card.cardId) && <span className="facility-used">本回合已用于宣告</span>}
                <details><summary>查看效果</summary><p>{card.effect}</p><small>{card.cardId}</small></details></>}
            </div>;
          })}
        </div>}
      </section>;
    })}
  </div></section>;
}
