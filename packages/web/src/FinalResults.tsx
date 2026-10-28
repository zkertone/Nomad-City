import type { FinalScoringResult } from '@nomad-city-online/game-core';
import { assetLabels } from './ChoiceControls.js';
const basis = { score: '总分', 'columbia-voucher': '剩余金券', 'pure-originium': '剩余至纯源石', shared: '全部比较项相同，共同胜利' };
/** Display the committed public result only; no client scoring or finalization command. */
export function FinalResults({ result, selfPlayerId }: { readonly result: FinalScoringResult; readonly selfPlayerId: string }) {
  const assets = ['orirock', 'originium', 'iron', 'pure-originium'] as const;
  return <section className="card final-results" aria-label="正式终局结果"><div className="eyebrow">EXPEDITION COMPLETE / 拓荒完成</div>
    <h2>{result.winnerPlayerIds.map(id => id.toUpperCase()).join('、')}{result.winnerPlayerIds.length > 1 ? ' · 共同胜利' : ' · 获胜'}</h2>
    <p>已完成 {result.completedRounds} 回合 · 比较依据：{basis[result.resolvedBy]}。以下为已保存的正式结果，重新连接不会重复加分。</p>
    <div className="results-table"><table><caption>最终排名与得分明细</caption><thead><tr><th>名次</th><th>城邦</th><th>已有分</th><th>区块分</th><th>资源分</th><th>总分</th><th>剩余金券</th><th>剩余至纯源石</th></tr></thead>
      <tbody>{result.rankingGroups.flatMap((group, index) => group.map(id => { const score = result.players[id]!;
        return <tr key={id} className={id === selfPlayerId ? 'self-result' : ''}><td>{1 + result.rankingGroups.slice(0, index).reduce((n, ids) => n + ids.length, 0)}{group.length > 1 ? '（并列）' : ''}</td><th>{id.toUpperCase()}{id === selfPlayerId ? ' · 你' : ''}</th>
          <td>{score.existingPoints}</td><td>{score.regionPoints}</td><td>{score.resources.totalPoints}</td><td><strong>{score.totalPoints}</strong></td><td>{score.remainingVouchers}</td><td>{score.remainingPureOriginium}</td></tr>;
      }))}</tbody></table></div>
    <details><summary>查看资源换分及余数</summary><div className="results-table"><table><thead><tr><th>城邦</th>{assets.map(a => <th key={a}>{assetLabels[a]}分／余数</th>)}</tr></thead><tbody>{Object.entries(result.players).map(([id, score]) => <tr key={id}><th>{id.toUpperCase()}</th>{assets.map(a => <td key={a}>{score.resources.pointsByAsset[a]} / {score.resources.unscoredRemainders[a]}</td>)}</tr>)}</tbody></table></div></details>
    <details><summary>查看区块控制与影响力</summary><div className="results-table"><table><thead><tr><th>区块</th><th>控制分</th><th>控制者</th>{Object.keys(result.players).map(id => <th key={id}>{id.toUpperCase()}（点／航道／城市）</th>)}</tr></thead><tbody>{Object.values(result.regions).map(region => <tr key={region.regionId}><th>{region.regionId}</th><td>{region.rewardPoints}</td><td>{region.controllerPlayerId?.toUpperCase() ?? (region.leadingPlayerIds.length > 1 ? '并列，无控制者' : '无控制者')}</td>{Object.keys(result.players).map(id => { const n = region.influenceByPlayer[id]!; return <td key={id}>{n.total}（{n.nodeMarkers}/{n.routeMarkers}/{n.cityInfluence}）</td>; })}</tr>)}</tbody></table></div></details>
  </section>;
}
