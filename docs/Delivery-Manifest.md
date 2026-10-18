# v0.2.0 项目文件清单

仓库：[zkertone/Nomad-City](https://github.com/zkertone/Nomad-City)。以下位置均相对于仓库根目录；链接适用于 GitHub 页面和本地检出。

历史地图分析与 Board 设计稿保持原样，ADR 为 Accepted，DevLog 保留完整历史。

| 相对位置 | 文件链接 |
| --- | --- |
| `.gitignore` | [.gitignore](../.gitignore) |
| `README.md` | [README.md](../README.md) |
| `docs/Board-Model-v0.1.0.md` | [Board-Model-v0.1.0.md](Board-Model-v0.1.0.md) |
| `docs/Delivery-Manifest.md` | [Delivery-Manifest.md](Delivery-Manifest.md) |
| `docs/DevLog.md` | [DevLog.md](DevLog.md) |
| `docs/Map-Analysis-v0.1.0.md` | [Map-Analysis-v0.1.0.md](Map-Analysis-v0.1.0.md) |
| `docs/adr/ADR-0001-Board-Representation.md` | [ADR-0001-Board-Representation.md](adr/ADR-0001-Board-Representation.md) |
| `docs/testing/v0.2.0-validation.md` | [v0.2.0-validation.md](testing/v0.2.0-validation.md) |
| `package-lock.json` | [package-lock.json](../package-lock.json) |
| `package.json` | [package.json](../package.json) |
| `packages/game-core/package.json` | [package.json](../packages/game-core/package.json) |
| `packages/game-core/src/board/board.test.ts` | [board.test.ts](../packages/game-core/src/board/board.test.ts) |
| `packages/game-core/src/board/definitions/build.ts` | [build.ts](../packages/game-core/src/board/definitions/build.ts) |
| `packages/game-core/src/board/definitions/founders-3.ts` | [founders-3.ts](../packages/game-core/src/board/definitions/founders-3.ts) |
| `packages/game-core/src/board/definitions/founders-4.ts` | [founders-4.ts](../packages/game-core/src/board/definitions/founders-4.ts) |
| `packages/game-core/src/board/hash.ts` | [hash.ts](../packages/game-core/src/board/hash.ts) |
| `packages/game-core/src/board/index.ts` | [index.ts](../packages/game-core/src/board/index.ts) |
| `packages/game-core/src/board/schema.ts` | [schema.ts](../packages/game-core/src/board/schema.ts) |
| `packages/game-core/src/board/state.ts` | [state.ts](../packages/game-core/src/board/state.ts) |
| `packages/game-core/src/board/topology.ts` | [topology.ts](../packages/game-core/src/board/topology.ts) |
| `packages/game-core/src/board/types.ts` | [types.ts](../packages/game-core/src/board/types.ts) |
| `packages/game-core/src/board/validate.ts` | [validate.ts](../packages/game-core/src/board/validate.ts) |
| `packages/game-core/src/board/verification/verified-catalog.json` | [verified-catalog.json](../packages/game-core/src/board/verification/verified-catalog.json) |
| `packages/game-core/src/index.ts` | [index.ts](../packages/game-core/src/index.ts) |
| `scripts/archive.py` | [archive.py](../scripts/archive.py) |
| `scripts/check-maps.mjs` | [check-maps.mjs](../scripts/check-maps.mjs) |
| `tsconfig.build.json` | [tsconfig.build.json](../tsconfig.build.json) |
| `tsconfig.json` | [tsconfig.json](../tsconfig.json) |
| `vitest.config.ts` | [vitest.config.ts](../vitest.config.ts) |

共 29 个项目文件。依赖目录 node_modules、构建目录 dist 和 ZIP 归档不纳入 Git 源码提交；按 README 可重建。

原 v0.2.0 归档导入时只调整 README/本清单的链接及追加 DevLog；地图数据、Schema、测试及依赖锁文件不变。
# 2026-10-17 增量交付说明

本次新增事件静态目录，不重写原有 v0.2.0 交付历史。源码位于 `packages/game-core/src/events/`（types.ts、schema.ts、hash.ts、catalog.ts、index.ts、founders-base.json、events.test.ts），编译加载脚本为 `scripts/check-events.mjs`。根包导出、workspace 包导出、根 package.json 与 README 已更新。

同日后续新增最小对局状态：`packages/game-core/src/game/`（types.ts、schema.ts、resources.ts、state.ts、index.ts、game.test.ts）、`scripts/check-game.mjs`、`docs/Game-State-Foundation-2026-10-17.md`、`docs/testing/game-state-validation-2026-10-17.md`；BoardState 资源种类与 Schema 追加已确认的至纯源石。当前最新测试总数为 311。以上均可在仓库继续编辑，尚未包含完整对局执行。

2026-10-18 再追加可执行入场流程：`packages/game-core/src/game/entry.ts`、`entry-rules.ts`、`entry-invariants.ts`、`entry.test.ts`，以及 `scripts/check-entry.mjs`、`docs/Entry-Flow-2026-10-18.md`、`docs/testing/entry-validation-2026-10-18.md`。状态 Schema/类型/校验和 game 导出已更新，兼容旧快照并支持入场进度格式 1.1.0；最新测试为 379。黄色/红色事件和完整回合仍未实现。

已确认的事件文案与效果表位于 `docs/Event-Card-Text-2026-10-17.md`、`docs/Event-Cards-Review-2026-10-17.md`；规则核对见 `docs/Event-Resolution-Boundaries-2026-10-17.md`；真实测试结果见 `docs/testing/event-catalog-validation-2026-10-17.md`。本轮新增/修改的实际状态以 Git 提交及 DevLog 最新条目为准。



## 2026-10-18 事件结算核心增量

新增可编辑源码 `packages/game-core/src/game/settlement.ts`、`settlement.test.ts`、`influence.ts`；修改同目录 schema.ts、types.ts、state.ts、entry-rules.ts、entry.ts、index.ts 以共用局面校验与绿色结算。新增 `scripts/check-settlement.mjs` 和对应 package.json 命令，README 与进度文档同步更新。

说明：[Event-Settlement-2026-10-18.md](Event-Settlement-2026-10-18.md)；实际测试：[event-settlement-validation-2026-10-18.md](testing/event-settlement-validation-2026-10-18.md)。当前最新测试 473/473，其中新增结算 94。全部 49 个基础选项可独立执行，黄色/红色的待结算行动调用方仍待完成。GameState 持久化格式、原地图/事件数据、用户确认文档、ADR 和依赖锁未改动。


## 2026-10-18 探索行动增量

新增源码 `packages/game-core/src/game/exploration.ts`、`exploration-rules.ts`、`exploration-invariants.ts`、`exploration.test.ts`，新增 `scripts/check-exploration.mjs` 和 package.json 运行命令；修改 game 的 schema.ts、types.ts、state.ts、entry-invariants.ts、index.ts。

说明：[Exploration-Flow-2026-10-18.md](Exploration-Flow-2026-10-18.md)；实际测试：[exploration-validation-2026-10-18.md](testing/exploration-validation-2026-10-18.md)。README、DevLog 和相关进度说明已同步。当前最新 553/553，其中新增探索 80；状态格式 1.2.0 支持明确的探索进度，兼容原入场格式；不改变 GameDefinition、地图/事件定义、已确认文案、ADR 或依赖。源码继续保存到仓库，无部署或发布。
