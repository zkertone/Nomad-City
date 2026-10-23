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


## 2026-10-18 城市移动增量

新增 `packages/game-core/src/game/city-move.ts`、`city-move-invariants.ts`、`city-move.test.ts`，以及内部共用的 `action-window.ts`、`action-invariants.ts`。修改同目录 schema.ts、types.ts、state.ts、index.ts、influence.ts、exploration.ts、exploration-rules.ts、exploration-invariants.ts。新增 `scripts/check-city-move.mjs` 和 package.json 命令。

说明：[City-Move-Flow-2026-10-18.md](City-Move-Flow-2026-10-18.md)；实际验证：[city-move-validation-2026-10-18.md](testing/city-move-validation-2026-10-18.md)。README、DevLog 与进度说明已同步。最新 631/631（新增 78）；GameState 1.3.0 支持城市移动和之后的探索，原格式保留。地图/事件数据、已确认文案、ADR、锁文件和项目版本不变，未部署或发布。


## 2026-10-18 部署与调度增量

新增 `packages/game-core/src/game/influence-actions.ts`、`influence-action-invariants.ts`、`influence-actions.test.ts`，以及 `scripts/check-influence.mjs` 和 package.json 命令。修改 schema.ts、types.ts、state.ts、index.ts、influence.ts、action-window.ts、exploration.ts、city-move.ts 以支持 1.4.0 和现有行动衔接。

说明：[Influence-Actions-2026-10-18.md](Influence-Actions-2026-10-18.md)；实际验证：[influence-actions-validation-2026-10-18.md](testing/influence-actions-validation-2026-10-18.md)。README、DevLog 与进度说明已同步。最新 687/687，其中新增 56；原格式保留兼容。未改地图、事件数据/文案、ADR、依赖或项目版本，未部署软件或发布项目。


## 2026-10-18 同时采集增量

新增 game/harvest.ts、harvest-rules.ts、harvest-invariants.ts、harvest.test.ts、route-tolls.ts（均位于 `packages/game-core/src/game/`），新增 `scripts/check-harvest.mjs` 和 package.json 命令。修改 game/schema.ts、types.ts、state.ts、index.ts、action-window.ts、exploration.ts、city-move.ts、influence-actions.ts 以支持同时采集、共用航道计价与 1.5.0。

说明：[Harvest-Phase-2026-10-18.md](Harvest-Phase-2026-10-18.md)；实际验证：[harvest-validation-2026-10-18.md](testing/harvest-validation-2026-10-18.md)。README、DevLog 和部署/调度当前进度同步。最新 **749/749**，其中采集 62；9 项编译检查通过。静态规则数据/文案、Accepted ADR、依赖锁和项目版本不变。完整可编辑文件保存至同一 GitHub 仓库，无部署或发布。


## 2026-10-18 基础计分预览增量

新增 `packages/game-core/src/game/scoring.ts`、`scoring.test.ts`，修改同目录 index.ts 导出；新增 `scripts/check-scoring.mjs` 与 package.json 命令。说明：[Base-Scoring-2026-10-18.md](Base-Scoring-2026-10-18.md)；实际验证：[base-scoring-validation-2026-10-18.md](testing/base-scoring-validation-2026-10-18.md)。更新 README、DevLog、采集后续进度和本清单。

新增 56 项计分测试，总计 **805/805**，十项编译检查通过。仅提供只读派生查询，没有更改 GameState/存档格式、地图/事件数据及摘要、已确认文案、Accepted ADR、依赖锁或项目版本。正式收尾/终局执行、UI 与联机仍待完成。可编辑源文件继续保存在现有 GitHub 仓库，无部署或发布。


## 2026-10-22 设施颜色与实体数量确认增量

新增 `packages/game-core/src/facilities/` 的 founders-color-counts.json、schema.ts、types.ts、hash.ts、catalog.ts、inventory.ts、index.ts、facilities.test.ts，录入本批 20 项用户确认颜色及独立的核心指挥塔 4 张事实。修改根模块导出和 workspace package.json，新增 `/facilities` 子路径；新增 `scripts/check-facilities.mjs` 及 npm 命令。vitest.config.ts 调整共享环境的并发和超时设置，规则断言不变。

清单：[Facility-Colors-2026-10-22.md](Facility-Colors-2026-10-22.md)；图片、去重和延伸枢纽补图：[Card-Image-Intake-2026-10-22.md](Card-Image-Intake-2026-10-22.md)；实际验证：[facility-colors-validation-2026-10-22.md](testing/facility-colors-validation-2026-10-22.md)。README 与 DevLog 同步。

这批内容是静态事实，不代表建设、形状、样式或完整角色效果已经实现。原图未改写；源码不复制整套卡面图片。GameDefinition/GameState、地图/事件数据与摘要、此前已确认文案、Accepted ADR、依赖锁及项目版本保持原值。未部署或发布。

设施增量最终实际验证：853/853（新增 48），strict 检查、构建和四项相关编译包检查通过；超时及中断记录已保留，没有将未完成运行算作通过。


## 2026-10-22 设施数字语义更正

用户明确此前数字是设施个数，AI 的格数解释撤回。原文件路径和用户数值保留，facilities/ 中 Schema、数据、哈希、数量查询与测试改为 copyCountsByColor，静态格式 2.0.0；inventory.ts 增加规则书基准和差额查询。当前报告 57 对规则书 48，普通设施多 9，保持未核对且不可用于牌库开局。更正 README、设施核对、图片接收与验证记录；DevLog 保留错误和修正过程。历史测试通过不作为官方事实准确性的证据。


用户进一步明确清单含企业扩展。已核对 p15/p16 及 E 标企业办事处 3 张；O 标临时聚居点/罗德岛办事处各 3 张单列未确认，剩余基础候选 48。此前“多 9 张”的纯基础版比较已撤回。数量格式显式 scope=mixed-edition-inventory-report，未核对库存不用于开局，不实现企业扩展玩法。


用户最终确认 E=企业扩展、O=DLC《感染者》。此前 O 未定/数量差额结论撤回，数量为基础 48 + 企业 3 + 感染者 6 = 57。新增 getFacilityCopyCountRecords 默认基础版过滤，混合原始报告完整保留；只识别扩展资料，不启用扩展规则。totalsReconciled=true，完整设施执行/实际牌库仍未实现。


## 2026-10-22 基础版设施卡面转录增量

新增可编辑源文件（相对于仓库根目录）：

- `packages/game-core/src/facilities/founders-faces.json`：18 种可见基础版卡面的字段及来源。
- `packages/game-core/src/facilities/faces-schema.ts`：Zod Schema 与只读类型。
- `packages/game-core/src/facilities/faces-hash.ts`：规范化与 SHA-256。
- `packages/game-core/src/facilities/faces.ts`：校验、不可变加载、查询与进度。
- `packages/game-core/src/facilities/faces.test.ts`：新增 47 项测试。
- `docs/Facility-Faces-Review-2026-10-22.md`：逐项分数/成本/效果/风味和缺失字段。
- `docs/testing/facility-faces-validation-2026-10-22.md`：真实命令和结果。

修改 `packages/game-core/src/facilities/index.ts`、`scripts/check-facilities.mjs`、`README.md`、`docs/Card-Image-Intake-2026-10-22.md`、`docs/Facility-Colors-2026-10-22.md`、`docs/DevLog.md` 和本清单。原数量 JSON、Schema 与摘要不变，未复制整套卡面图。

实际最终 verify：strict 类型、**905/905（12 个文件）**、构建通过；四项相关编译包检查退出 0，初次 99/100 的失败与修正已记录。新转录状态为待复核，2 处效果及 17 份风味仍未完整，图片适用范围不推到其他颜色版本；没有设施执行器、UI、联网、部署或发布。


## 2026-10-22 用户全文与行动图标修正增量

修改可编辑文件（仓库相对路径）：

- `packages/game-core/src/facilities/founders-faces.json`：18 份风味与两条完整说明、逐字段来源、规则书图标语义；格式 2.0.0。
- `packages/game-core/src/facilities/faces-schema.ts`：用户/图片来源区分、严格语义词典与来源交叉验证、相关只读类型。
- `packages/game-core/src/facilities/faces-hash.ts`：v2 规范化及全部新增字段的内容摘要。
- `packages/game-core/src/facilities/faces.ts`：固定基准、新图标含义/可读效果查询及当前进度。
- `packages/game-core/src/facilities/faces.test.ts`：更新原 47 项并新增 48 项全文与语义回归测试。
- `scripts/check-facilities.mjs`：编译后的新 API、原文和语义检查。
- `README.md`、`docs/Facility-Faces-Review-2026-10-22.md`、`docs/Card-Image-Intake-2026-10-22.md`、`docs/testing/facility-faces-validation-2026-10-22.md`、`docs/DevLog.md` 和本清单：当前转录、来源、真实验证及历史更正。

最新实际 **148/148（2 个设施文件）**、strict 类型、构建及四项相关编译检查通过；此次未重跑全量游戏测试。效果区/风味均 18/18，缺字 0；不代表建设或设施行动执行完成。没有新依赖、架构变更、部署或对外发布。


## 2026-10-22 设施实体牌库与供应区增量

新增可编辑文件（相对于仓库根目录）：

- `packages/game-core/src/facilities/stock.ts`：48 张实体牌定义、类型、Schema、逐项校验与固定摘要。
- `packages/game-core/src/facilities/supply.ts`：开局分配、注入随机洗牌、运行时守恒、内部补牌和公开视图。
- `packages/game-core/src/facilities/supply.test.ts`：75 项新测试。
- `docs/Facility-Supply-2026-10-22.md`：规则依据、API、状态边界、摘要与服务器调用示例。
- `docs/testing/facility-supply-validation-2026-10-22.md`：初期执行、类型错误修正与最终实际结果。

修改 `packages/game-core/src/facilities/index.ts`、`packages/game-core/src/facilities/inventory.ts`、`scripts/check-facilities.mjs`、`README.md`、`docs/Facility-Colors-2026-10-22.md`、`docs/Facility-Faces-Review-2026-10-22.md`、`docs/DevLog.md` 和本清单。

最终实际 verify：strict 类型、**1028/1028（13 个文件）**、构建通过；四项相关编译检查退出0。库存和设施供应独立实现，尚未接入 GameState/建设执行。原已确认数据/文本/摘要、ADR、依赖及项目版本不变，无 UI、联机、部署或对外发布。


## 2026-10-23 玩家面板与位置预检增量

新增可编辑文件（相对于仓库根目录）：

- `packages/game-core/src/facilities/founders-player-panel.json`：12格、初始核心与来源。
- `packages/game-core/src/facilities/panel-definition.ts`：Schema、类型、固定SHA、逻辑格位和十字邻接。
- `packages/game-core/src/facilities/panel-state.ts`：核心初始化、归属交叉校验、位置预检与邻格查询。
- `packages/game-core/src/facilities/panel.test.ts`：89项新测试。
- `docs/Player-Panel-2026-10-23.md`：格位表、图片身份、规则依据、API及边界。
- `docs/testing/player-panel-validation-2026-10-23.md`：实际执行与结果。

修改 `packages/game-core/src/facilities/index.ts`、`scripts/check-facilities.mjs`、`README.md`、`docs/Facility-Faces-Review-2026-10-22.md`、`docs/Facility-Supply-2026-10-22.md`、`docs/DevLog.md` 和本清单。原图未改写，源码仓库仅保存来源身份/摘要与结构化事实。

最终实际 **1117/1117（14个文件）**，strict类型、构建、四项相关编译检查通过；其中设施312、新增89。只完成逻辑面板与位置预检，未接入完整建设/GameState；原规则数据、存档格式、ADR、依赖及项目版本不变，无部署或对外发布。


## 2026-10-23 基础建设内部事务增量

新增可编辑文件（相对于仓库根目录）：

- `packages/game-core/src/facilities/construction-spec.ts`：执行来源固定基准、7类/15张范围、错误类型与未支持拒绝。
- `packages/game-core/src/facilities/construction.ts`：事务组合校验、费用报价、支付/归属/补牌/摆放/得分与支持入场原子结算。
- `packages/game-core/src/facilities/construction.test.ts`：85项新测试。
- `docs/Facility-Construction-2026-10-23.md`：覆盖表、规则依据、执行顺序及可信调用边界。
- `docs/testing/facility-construction-validation-2026-10-23.md`：初次失败、修正与最终实际结果。

修改 `packages/game-core/src/facilities/index.ts`、`scripts/check-facilities.mjs`、`README.md`、`docs/Player-Panel-2026-10-23.md`、`docs/Facility-Supply-2026-10-22.md`、`docs/Facility-Faces-Review-2026-10-22.md`、`docs/DevLog.md` 和本清单。

最终实际verify：strict类型、**1202/1202（15个文件）**、构建通过，四项相关编译包检查退出0。正式行动窗口/认证/额度、其他效果和颜色仍待完成，不宣称完整建设或网络入口已实现。原规则数据/摘要、存档格式、依赖及Accepted ADR不变，无部署或发布。
