import { assetLabels } from "../ChoiceControls.js";
import type { BoardPresentationProps } from "./types.js";

/** Lightweight resource overview. Coordinates/layout do not establish movement or action legality. */
export function Board2D({
  board,
  view,
  targets,
  selectedNodeId,
  selectedSlotId,
  sourceSlotId,
  disabled,
  onIntent,
}: BoardPresentationProps) {
  return (
    <section className="card board-overview" aria-label="简化2D资源点概览">
      <div className="section-heading">
        <h2>荒野 · 资源点概览</h2>
        <span className="count-tag">
          {view.public.players.length} 人地图 · 2D
        </span>
      </div>
      <p className="muted">按区块列出资源点；请选择服务端提供的可用位置。</p>
      {board && (
        <div className="regions">
          {Object.keys(board.regions).map((region) => (
            <div className="region" key={region}>
              <strong>区块 {region}</strong>
              <div>
                {Object.values(board.resourceNodes)
                  .filter((n) => n.regionId === region)
                  .map((n) => {
                    const occupants = Object.entries(
                      view.public.board.cityNodeByPlayer,
                    ).filter(([, id]) => id === n.id).map(([id]) => id.toUpperCase());
                    const marker = view.public.board.resourceMarkerByNode[n.id];
                    return (
                      <button
                        key={n.id}
                        data-deck={n.eventDeckColor}
                        className={
                          selectedNodeId === n.id ? "node selected" : "node"
                        }
                        aria-pressed={selectedNodeId === n.id}
                        disabled={disabled || !targets.nodeIds.includes(n.id)}
                        onClick={() =>
                          onIntent({ type: "select-node", nodeId: n.id })
                        }
                      >
                        <span>{n.id}</span>
                        <small>
                          {occupants.length
                            ? `${occupants.join("、")} 城邦`
                            : targets.nodeIds.includes(n.id)
                              ? "可选择"
                              : n.eventDeckColor === "red"
                                ? "红色资源点"
                                : "资源点"}
                        </small>
                        <small>{marker ? `${assetLabels[marker.resourceKind]} ×${marker.harvestAmount}` : "尚未揭示资源"}</small>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
      {board && view.public.round && (
        <div className="influence-overview" aria-label="影响力槽位概览">
          <h3>影响力 · 资源点与航道</h3>
          <p className="muted">航道下方列出其连接点；来源与目标以服务端候选为准。</p>
          {Object.entries(board.regions).map(([regionId]) => (
            <div className="region" key={regionId}>
              <strong>区块 {regionId}</strong>
              {[...Object.values(board.resourceNodes).filter(n => n.regionId === regionId).map(n => ({
                id: n.id, label: `资源点 ${n.id}`, slots: n.influenceSlotIds,
              })), ...Object.values(board.routes).filter(r => r.regionId === regionId).map(r => ({
                id: r.id, label: `航道 ${r.id} · ${r.incidentNodeIds.join(' / ')}`, slots: r.influenceSlotIds,
              }))].map(location => <div className="slot-location" key={location.id}>
                <small>{location.label}</small>
                <div className="slot-choices">{location.slots.map(id => {
                  const owner = view.public.board.influenceBySlot[id]?.ownerPlayerId;
                  return <button key={id} disabled={disabled || !targets.slotIds.includes(id)}
                    className={selectedSlotId === id || sourceSlotId === id ? 'slot-choice selected' : 'slot-choice'}
                    aria-pressed={selectedSlotId === id || sourceSlotId === id}
                    onClick={() => onIntent({ type: 'select-slot', slotId: id })}>
                    <span>{id}</span><small>{sourceSlotId === id ? '已选来源' : owner ? `${owner.toUpperCase()} 影响力` : '空槽'}</small>
                  </button>;
                })}</div>
              </div>)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
