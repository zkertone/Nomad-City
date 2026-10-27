import type { BoardPresentationProps } from "./types.js";

/** Lightweight resource overview. Coordinates/layout do not establish movement or action legality. */
export function Board2D({
  board,
  view,
  targets,
  selectedNodeId,
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
                    const occupant = Object.entries(
                      view.public.board.cityNodeByPlayer,
                    ).find(([, id]) => id === n.id)?.[0];
                    return (
                      <button
                        key={n.id}
                        data-deck={n.eventDeckColor}
                        className={
                          selectedNodeId === n.id ? "node selected" : "node"
                        }
                        disabled={disabled || !targets.nodeIds.includes(n.id)}
                        onClick={() =>
                          onIntent({ type: "select-node", nodeId: n.id })
                        }
                      >
                        <span>{n.id}</span>
                        <small>
                          {occupant
                            ? `${occupant.toUpperCase()} 城邦`
                            : targets.nodeIds.includes(n.id)
                              ? "可选择"
                              : n.eventDeckColor === "red"
                                ? "红色资源点"
                                : "资源点"}
                        </small>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
