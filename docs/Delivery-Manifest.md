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


## 2026-10-23 建设窗口与GameState 1.6.0增量

新增可编辑文件（仓库根目录下）：

- `packages/game-core/src/game/construction.ts`：可信单次授予、正式命令、报价与权威快照提交。
- `packages/game-core/src/game/construction-invariants.ts`：跨阶段设施与建设进度校验。
- `packages/game-core/src/game/construction.test.ts`：75项新测试。
- `scripts/check-construction.mjs`：编译包2/3/4人正式建设及跨行动检查。
- `docs/Construction-Window-2026-10-23.md`：1.6.0、接口、初始化、版本与权限边界。
- `docs/testing/construction-window-validation-2026-10-23.md`：真实命令、失败修正、结果与未测范围。

修改 `packages/game-core/src/game/schema.ts`、`state.ts`、`action-window.ts`、`exploration.ts`、`city-move.ts`、`influence-actions.ts`、`harvest.ts`、`index.ts`；另更新 `package.json`（仅新增check:construction脚本）、`README.md`、`docs/Game-State-Foundation-2026-10-17.md`、`docs/Facility-Construction-2026-10-23.md`、`docs/Facility-Supply-2026-10-22.md`、`docs/Player-Panel-2026-10-23.md`、`docs/DevLog.md` 与本清单。

实际verify退出0：strict、1277/1277（16文件）、构建通过，12项编译检查退出0。GameState新1.6.0；旧格式读取保留，静态数据/固定摘要、GameDefinition、依赖锁、项目版本及Accepted ADR不变。完整角色与两轮额度/优惠、复杂设施及服务器持久化提交未实现，无UI、网络、部署或对外发布。


## 2026-10-23 角色盖放与两轮调度增量

新增可编辑文件（仓库根目录下）：

- `packages/game-core/src/game/round-schema.ts`：基础5角色身份、来源及roundFlow Schema。
- `packages/game-core/src/game/round-invariants.ts`：角色守恒、两轮/阶段与当前动作交叉校验。
- `packages/game-core/src/game/round.ts`：新局调度、两人移牌、盖放、主要行动、准备撤回、采集后限定收尾和局部公开投影。
- `packages/game-core/src/game/round.test.ts`：72项新测试及2/3/4人各8回合真实流程。
- `scripts/check-rounds.mjs`：根与/game编译包8回合检查。
- `docs/Round-Flow-2026-10-23.md`：规则页码/范围、1.7.0/API和未实现能力。
- `docs/testing/round-flow-validation-2026-10-23.md`：真实执行、早期类型错误、结果与边界。

修改 `packages/game-core/src/game/schema.ts`、`state.ts`、`action-window.ts`、`construction.ts`、`exploration.ts`、`city-move.ts`、`influence-actions.ts`、`harvest.ts`、`index.ts`；另更新 `package.json`（仅新增check:rounds）、`README.md`、`docs/Game-State-Foundation-2026-10-17.md`、`docs/Construction-Window-2026-10-23.md`、`docs/Harvest-Phase-2026-10-18.md`、`docs/Facility-Supply-2026-10-22.md`、`docs/DevLog.md` 与本清单。

最终真实verify：1349/1349（17文件）、strict和构建通过；13项编译检查退出0。GameState新1.7.0、旧格式保留；GameDefinition/静态原数据/摘要/已确认原文/依赖锁/项目版本/Accepted ADR不变。角色效果/优惠/样式、完整设施及最终分数提交待完成，无UI、联机、部署或对外发布。


## 2026-10-23 首批角色效果增量

新增可编辑文件（仓库根目录下）：

- `packages/game-core/src/game/role-rules.ts`：5模式支持明细与规则来源。
- `packages/game-core/src/game/role-effects.ts`：显式1.8.0升级、角色命令与5模式原子执行。
- `packages/game-core/src/game/role-effects.test.ts`：90项新测试与真实跨回合弃牌/回收。
- `scripts/check-role-effects.mjs`：根与/game编译包、2/3/4人真实使用流程。
- `docs/Base-Role-Effects-2026-10-23.md`：数值、选择格式、能力边界与版本行为。
- `docs/testing/role-effects-validation-2026-10-23.md`：真实命令、编译夹具修正、结果与未测范围。

修改 `packages/game-core/src/game/schema.ts`、`round-schema.ts`、`round-invariants.ts`、`round.ts`、`index.ts`、`construction.ts`、`exploration.ts`、`city-move.ts`、`influence-actions.ts`、`harvest.ts`；另更新 `package.json`（仅增加check:roles）、`README.md`、`docs/Round-Flow-2026-10-23.md`、`docs/Game-State-Foundation-2026-10-17.md`、`docs/DevLog.md`与本清单。

最终实际verify：1439/1439（18文件）、strict/构建通过；14项编译检查最终退出0。4名角色5模式可执行，未实现模式仍拒绝；1.8.0显式升级、旧格式/默认入口保留。原静态JSON/摘要/全文、GameDefinition/Accepted ADR、项目版本/依赖锁不变。其余角色、样式、设施与最终计分待完成，无UI/联机/部署或对外发布。


## 2026-10-23 雷蛇两种模式与收尾增量

新增可编辑文件（仓库根目录下）：

- `packages/game-core/src/game/liskarm-rules.ts`：逐次放置、先移除后同槽放置、真实标记供应及待处理义务辅助函数。
- `packages/game-core/src/game/liskarm.ts`：显式1.9.0升级、开启收尾、目标查询和权威移除命令。
- `packages/game-core/src/game/liskarm.test.ts`：49项新正反向与真实回合测试。
- `scripts/check-liskarm.mjs`：根与/game编译包、2/3/4人入场至收尾的真实流程检查。
- `docs/Liskarm-Effects-2026-10-23.md`：规则页码、API、费用/库存、版本、顺序与能力边界。
- `docs/testing/liskarm-validation-2026-10-23.md`：真实命令、早期类型辅助错误、最终结果与未测范围。

修改 `packages/game-core/src/game/schema.ts`、`round-schema.ts`、`round-invariants.ts`、`round.ts`、`role-rules.ts`、`role-effects.ts`、`role-effects.test.ts`、`index.ts`、`exploration.ts`、`city-move.ts`、`influence-actions.ts`、`harvest.ts`、`construction.ts`；`scripts/check-role-effects.mjs`；`package.json`（仅新增check:liskarm脚本）；`README.md`、`docs/Base-Role-Effects-2026-10-23.md`、`docs/Round-Flow-2026-10-23.md`、`docs/Game-State-Foundation-2026-10-17.md`、`docs/DevLog.md`及本清单。合计6个新增、21个修改文件。

最终实际verify退出0：**1488/1488（19文件）**、strict/构建通过；构建后15项编译检查全部退出0。当前7/10角色模式，雷蛇策略/both必须完成可执行的本人移除后才推进回合，旧格式和默认入口保持兼容。GameDefinition/原静态JSON/摘要/已确认文字/Accepted ADR/项目版本/依赖锁不变。其余三角色计谋、样式、完整设施及最终计分待完成，无UI/联机/部署或对外发布。


## 2026-10-23 三种剩余基础初始角色计谋增量

新增可编辑文件（相对于仓库根目录）：

- packages/game-core/src/game/role-schemes.ts：极境/德克萨斯/坎诺特计谋strict选择与内部原子处理器。
- packages/game-core/src/game/role-schemes.test.ts：70项新增正反向/真实回合回归。
- scripts/check-role-schemes.mjs：根与/game导出、2/3/4人三计谋的真实入场/行动/回合编译检查。
- docs/Remaining-Role-Schemes-2026-10-23.md：规则来源、各效果、API、新格式及边界。
- docs/testing/remaining-role-schemes-validation-2026-10-23.md：实际命令、早期测试错误和最终结果。

修改packages/game-core/src/game下schema.ts、round-schema.ts、round-invariants.ts、round.ts、role-rules.ts、role-effects.ts、role-effects.test.ts、round.test.ts、liskarm.ts、liskarm.test.ts、influence.ts、city-move.ts、exploration.ts、influence-actions.ts、harvest.ts、construction.ts；scripts/check-role-effects.mjs与check-liskarm.mjs更新能力断言；package.json仅增加check:schemes；README.md及docs/Base-Role-Effects-2026-10-23.md、Round-Flow-2026-10-23.md、Game-State-Foundation-2026-10-17.md、Liskarm-Effects-2026-10-23.md、City-Move-Flow-2026-10-18.md、DevLog.md和本清单。共5新增、27修改。

最终实际1558/1558（20文件）、strict/构建通过；16项编译检查全部退出0。新格式1.10.0显式启用10/10基础初始角色模式、保留旧格式限制，行动后角色结清旧进度但不额外授权。旧历史/静态数据/固定摘要/已确认文字/GameDefinition/Accepted ADR/项目版本/依赖锁不变。城市样式、剩余设施、最终计分及联机仍待完成，无UI、部署或对外发布。


## 2026-10-23 三种即时设施入场增量

新增可编辑文件（相对于仓库根目录）：

- packages/game-core/src/facilities/entry-effects.ts：strict选择、护航/佣兵/贸易即时入场和真实变化回执。
- packages/game-core/src/game/resource-sales.ts：内部自选资源3/3/4/15售卖公共算术。
- packages/game-core/src/game/facility-entries.test.ts：71项新增规则/原子性/权限/存档及回合测试。
- scripts/check-facility-entries.mjs：根、/game及/facilities加载，2/3/4人三设施无注入真实回合。
- docs/Facility-Immediate-Entries-2026-10-23.md：规则来源、选择/报价/回执、状态与边界。
- docs/testing/facility-immediate-entries-validation-2026-10-23.md：全部真实命令、结果及未测范围。

修改packages/game-core/src/facilities下construction-spec.ts、construction.ts、construction.test.ts、index.ts；packages/game-core/src/game下influence.ts、liskarm-rules.ts、role-effects.ts；scripts/check-facilities.mjs能力断言；package.json仅新增check:facility-entries；README.md及docs/Facility-Construction-2026-10-23.md、Construction-Window-2026-10-23.md、Facility-Faces-Review-2026-10-22.md、Round-Flow-2026-10-23.md、DevLog.md和本清单。共6新增、16修改。

实际定向156/156（旧85+新71）、全量1629/1629（21文件）、strict/构建及17项编译检查全部退出0。当前10类/23张匹配已拍颜色实体；不新增GameState版本，1.6.0–1.10.0继续兼容，效果不另存账本。原静态JSON/固定摘要/确认文本/GameDefinition/Accepted ADR/项目版本/依赖锁未改。嵌套入场、其余设施/颜色、城市样式和最终计分待完成，无UI/联机/部署或对外发布。


## 2026-10-23 载具仓库完整入场增量

新增仓库规则/API与真实验证文档、可恢复父子行动、共享探索执行引擎、目标费用查询、76项测试和编译包真实2/3/4人两分支检查。完整文件清单在下方按实际差异生成。

最终实际1705/1705（22文件）、strict/构建和18项编译检查全部退出0；显式1.11.0、新分支选择/事件/末尾放置暂停均属于原一次建设，支持11类/26张。原静态数据/摘要/用户全文/GameDefinition/项目版本/依赖锁/Accepted ADR未改。其他设施/样式/最终计分/联机仍待完成，无UI、部署或对外发布。

本增量实际新增7份、修改33份文件：

新增：

- `docs/Warehouse-Entries-2026-10-23.md`
- `docs/testing/warehouse-validation-2026-10-23.md`
- `packages/game-core/src/game/exploration-engine.ts`
- `packages/game-core/src/game/warehouse-rules.ts`
- `packages/game-core/src/game/warehouse.test.ts`
- `packages/game-core/src/game/warehouse.ts`
- `scripts/check-warehouse.mjs`

修改：

- `README.md`
- `docs/Construction-Window-2026-10-23.md`
- `docs/Delivery-Manifest.md`
- `docs/DevLog.md`
- `docs/Exploration-Flow-2026-10-18.md`
- `docs/Facility-Construction-2026-10-23.md`
- `docs/Facility-Faces-Review-2026-10-22.md`
- `docs/Facility-Immediate-Entries-2026-10-23.md`
- `docs/Game-State-Foundation-2026-10-17.md`
- `docs/Round-Flow-2026-10-23.md`
- `package.json`
- `packages/game-core/src/facilities/construction-spec.ts`
- `packages/game-core/src/facilities/construction.test.ts`
- `packages/game-core/src/facilities/construction.ts`
- `packages/game-core/src/facilities/entry-effects.ts`
- `packages/game-core/src/game/city-move.ts`
- `packages/game-core/src/game/construction-invariants.ts`
- `packages/game-core/src/game/construction.test.ts`
- `packages/game-core/src/game/construction.ts`
- `packages/game-core/src/game/exploration-invariants.ts`
- `packages/game-core/src/game/exploration.ts`
- `packages/game-core/src/game/facility-entries.test.ts`
- `packages/game-core/src/game/harvest.ts`
- `packages/game-core/src/game/index.ts`
- `packages/game-core/src/game/influence-actions.ts`
- `packages/game-core/src/game/liskarm.ts`
- `packages/game-core/src/game/role-effects.ts`
- `packages/game-core/src/game/role-rules.ts`
- `packages/game-core/src/game/round-invariants.ts`
- `packages/game-core/src/game/round-schema.ts`
- `packages/game-core/src/game/schema.ts`
- `scripts/check-facilities.mjs`
- `scripts/check-facility-entries.mjs`



## 2026-10-23 · 剩余已拍基础设施批量交付

基准提交62935e9849b97485f417444047bde9e0632dfcf5，保存根目录 `/workspace/scratch/a56cdbc0831a/nomad-city-dev`，远端既有仓库 `zkertone/Nomad-City`。完整规则/API见Remaining-Facilities-2026-10-23.md，实际1794/1794、strict/build与19项编译检查见testing/remaining-facilities-validation-2026-10-23.md。历史文件保留，未改原静态JSON/摘要、依赖锁或Accepted ADR。

本批实际文件清单：

共43份：新增7，修改36，无删除。相对路径均位于上述根目录及同名仓库路径。

- `README.md`（更新）
- `docs/Construction-Window-2026-10-23.md`（更新）
- `docs/Delivery-Manifest.md`（更新）
- `docs/DevLog.md`（更新）
- `docs/Facility-Construction-2026-10-23.md`（更新）
- `docs/Facility-Faces-Review-2026-10-22.md`（更新）
- `docs/Facility-Immediate-Entries-2026-10-23.md`（更新）
- `docs/Game-State-Foundation-2026-10-17.md`（更新）
- `docs/Remaining-Facilities-2026-10-23.md`（新增）
- `docs/Round-Flow-2026-10-23.md`（更新）
- `docs/Warehouse-Entries-2026-10-23.md`（更新）
- `docs/testing/remaining-facilities-validation-2026-10-23.md`（新增）
- `package.json`（更新）
- `packages/game-core/src/facilities/construction-spec.ts`（更新）
- `packages/game-core/src/facilities/construction.test.ts`（更新）
- `packages/game-core/src/facilities/construction.ts`（更新）
- `packages/game-core/src/facilities/entry-effects.ts`（更新）
- `packages/game-core/src/game/city-move-invariants.ts`（更新）
- `packages/game-core/src/game/city-move.ts`（更新）
- `packages/game-core/src/game/construction-invariants.ts`（更新）
- `packages/game-core/src/game/construction.test.ts`（更新）
- `packages/game-core/src/game/construction.ts`（更新）
- `packages/game-core/src/game/exploration.ts`（更新）
- `packages/game-core/src/game/facility-entries.test.ts`（更新）
- `packages/game-core/src/game/facility-entries.ts`（新增）
- `packages/game-core/src/game/facility-entry-invariants.ts`（新增）
- `packages/game-core/src/game/facility-entry-rules.ts`（新增）
- `packages/game-core/src/game/harvest.ts`（更新）
- `packages/game-core/src/game/index.ts`（更新）
- `packages/game-core/src/game/influence-actions.ts`（更新）
- `packages/game-core/src/game/liskarm.ts`（更新）
- `packages/game-core/src/game/remaining-facilities.test.ts`（新增）
- `packages/game-core/src/game/role-effects.ts`（更新）
- `packages/game-core/src/game/role-rules.ts`（更新）
- `packages/game-core/src/game/round-invariants.ts`（更新）
- `packages/game-core/src/game/round-schema.ts`（更新）
- `packages/game-core/src/game/round.ts`（更新）
- `packages/game-core/src/game/schema.ts`（更新）
- `packages/game-core/src/game/warehouse.ts`（更新）
- `scripts/check-facilities.mjs`（更新）
- `scripts/check-facility-entries.mjs`（更新）
- `scripts/check-remaining-facilities.mjs`（新增）
- `scripts/check-warehouse.mjs`（更新）


## 2026-10-24 · 同名设施跨颜色确认批次

普通建设16类41张、延伸3张、设置核心4张，共18类48张；保留实体颜色。规则依据：[Facility-Variants-2026-10-24.md](Facility-Variants-2026-10-24.md)，实际验证：[测试记录](testing/facility-variants-validation-2026-10-24.md)。原照片/数据摘要、状态格式、依赖和Accepted ADR保持不变。

共19份变更，新增2份，其余更新，无删除。

- `README.md`
- `docs/Delivery-Manifest.md`
- `docs/DevLog.md`
- `docs/Facility-Faces-Review-2026-10-22.md`
- `docs/Facility-Variants-2026-10-24.md`
- `docs/Remaining-Facilities-2026-10-23.md`
- `docs/testing/facility-variants-validation-2026-10-24.md`
- `packages/game-core/src/facilities/construction-spec.ts`
- `packages/game-core/src/facilities/construction.test.ts`
- `packages/game-core/src/facilities/construction.ts`
- `packages/game-core/src/game/construction.test.ts`
- `packages/game-core/src/game/facility-entries.test.ts`
- `packages/game-core/src/game/facility-entries.ts`
- `packages/game-core/src/game/facility-entry-rules.ts`
- `packages/game-core/src/game/remaining-facilities.test.ts`
- `scripts/check-facilities.mjs`
- `scripts/check-facility-entries.mjs`
- `scripts/check-remaining-facilities.mjs`
- `scripts/check-warehouse.mjs`

本批最终验证：1810/1810（23文件）、strict/build及19项编译检查全部通过，其中33段新旧真实设施流程覆盖2/3/4人。


## 2026-10-24 · 三档玩法规范与城市样式资料/匹配批次

新增[玩法规范](Gameplay-Versions-2026-10-24.md)、[城市样式说明](City-Patterns-2026-10-24.md)及[实际验证](testing/city-patterns-validation-2026-10-24.md)。15张卡面与风味完整保留；共用旋转/双色/虹色/已用牌匹配和只读宣告预检，未接入权威宣告或特殊行动。正式牌名为复合动力系统，原输入错字只留溯源。

最终1962/1962（25文件）、strict/build及20项编译检查通过。原图/PDF不上传，原游戏数据、固定摘要、GameState、依赖版本/锁及Accepted ADR不改。以下相对于GitHub main 2eb9ed56039e86ae74a558e53efe2ac84b0f0160。

共18份变更，新增12份，无删除。

- `README.md`
- `docs/City-Patterns-2026-10-24.md`
- `docs/Delivery-Manifest.md`
- `docs/DevLog.md`
- `docs/Gameplay-Versions-2026-10-24.md`
- `docs/testing/city-patterns-validation-2026-10-24.md`
- `package.json`
- `packages/game-core/package.json`
- `packages/game-core/src/index.ts`
- `packages/game-core/src/patterns/catalog.json`
- `packages/game-core/src/patterns/catalog.ts`
- `packages/game-core/src/patterns/index.ts`
- `packages/game-core/src/patterns/matching.ts`
- `packages/game-core/src/patterns/patterns.test.ts`
- `packages/game-core/src/patterns/preview.test.ts`
- `packages/game-core/src/patterns/preview.ts`
- `packages/game-core/src/patterns/schema.ts`
- `scripts/check-patterns.mjs`


## 2026-10-24 · 城市样式宣告与首批完整特殊行动

基准main提交813b08e42eb08dc8bac11fd0fe947272d1d55e02；基础版2/3/4人，显式GameState1.13.0接入12种宣告和4种完整特殊行动。规则与能力边界见[实现说明](City-Pattern-Actions-2026-10-24.md)，真实结果见[验证记录](testing/city-pattern-actions-validation-2026-10-24.md)。

实际2024/2024（26文件）、strict/build及21项编译检查全部通过；新脚本12段无注入真实流程。原资料JSON/固定摘要、全部风味、依赖锁、GameDefinition及Accepted ADR不变。没有上传原图/PDF，没有UI、网络、部署或对外发布。

本批共37份变更，新增8份，无删除；路径相对于仓库根目录。

- `README.md`（更新）
- `docs/City-Pattern-Actions-2026-10-24.md`（新增）
- `docs/City-Patterns-2026-10-24.md`（更新）
- `docs/Delivery-Manifest.md`（更新）
- `docs/DevLog.md`（更新）
- `docs/Game-State-Foundation-2026-10-17.md`（更新）
- `docs/Round-Flow-2026-10-23.md`（更新）
- `docs/testing/city-pattern-actions-validation-2026-10-24.md`（新增）
- `package.json`（更新）
- `packages/game-core/src/game/action-window.ts`（更新）
- `packages/game-core/src/game/city-move.ts`（更新）
- `packages/game-core/src/game/city-pattern-actions.test.ts`（新增）
- `packages/game-core/src/game/city-pattern-actions.ts`（新增）
- `packages/game-core/src/game/city-pattern-invariants.ts`（新增）
- `packages/game-core/src/game/city-pattern-rules.ts`（新增）
- `packages/game-core/src/game/city-pattern-schema.ts`（新增）
- `packages/game-core/src/game/construction-invariants.ts`（更新）
- `packages/game-core/src/game/construction.ts`（更新）
- `packages/game-core/src/game/exploration-engine.ts`（更新）
- `packages/game-core/src/game/exploration.ts`（更新）
- `packages/game-core/src/game/facility-entries.ts`（更新）
- `packages/game-core/src/game/facility-entry-invariants.ts`（更新）
- `packages/game-core/src/game/facility-entry-rules.ts`（更新）
- `packages/game-core/src/game/harvest.ts`（更新）
- `packages/game-core/src/game/index.ts`（更新）
- `packages/game-core/src/game/influence-actions.ts`（更新）
- `packages/game-core/src/game/liskarm.ts`（更新）
- `packages/game-core/src/game/role-effects.ts`（更新）
- `packages/game-core/src/game/role-rules.ts`（更新）
- `packages/game-core/src/game/round-invariants.ts`（更新）
- `packages/game-core/src/game/round-schema.ts`（更新）
- `packages/game-core/src/game/round.ts`（更新）
- `packages/game-core/src/game/schema.ts`（更新）
- `packages/game-core/src/game/state.ts`（更新）
- `packages/game-core/src/game/types.ts`（更新）
- `packages/game-core/src/game/warehouse.ts`（更新）
- `scripts/check-pattern-actions.mjs`（新增）


## 2026-10-24 · 四张城市样式批量接入

基准main提交039684da0c79bb34ed96fd8794e2c44983e24fe0。新增新兴建筑群宣告内正常建设，以及城建开拓区/复合动力系统/高效移动管理体系完整特殊行动，基础版2/3/4人共享；当前13种宣告/7种特殊行动。显式GameState1.14.0保留原状态与旧格式边界。

规则/API见[四张样式说明](City-Pattern-Continuations-2026-10-24.md)，实际测试、失败修正及最终结果见[验证记录](testing/city-pattern-continuations-validation-2026-10-24.md)。最终2087/2087（27文件）、strict/build通过，原2024项保留，新增63项。原始JSON/固定摘要、全部风味、GameDefinition、Accepted ADR和依赖锁不变；没有上传卡面/PDF，没有UI、联机或部署。

共36份变更，新增5份，无删除；下列路径相对于仓库根目录。

- `README.md`（更新）
- `docs/City-Pattern-Actions-2026-10-24.md`（更新）
- `docs/City-Pattern-Continuations-2026-10-24.md`（新增）
- `docs/City-Patterns-2026-10-24.md`（更新）
- `docs/Construction-Window-2026-10-23.md`（更新）
- `docs/Delivery-Manifest.md`（更新）
- `docs/DevLog.md`（更新）
- `docs/Game-State-Foundation-2026-10-17.md`（更新）
- `docs/Round-Flow-2026-10-23.md`（更新）
- `docs/testing/city-pattern-continuations-validation-2026-10-24.md`（新增）
- `package.json`（更新）
- `packages/game-core/src/facilities/construction.ts`（更新）
- `packages/game-core/src/facilities/panel-state.ts`（更新）
- `packages/game-core/src/game/action-window.ts`（更新）
- `packages/game-core/src/game/city-move.ts`（更新）
- `packages/game-core/src/game/city-pattern-actions.ts`（更新）
- `packages/game-core/src/game/city-pattern-continuations.test.ts`（新增）
- `packages/game-core/src/game/city-pattern-continuations.ts`（新增）
- `packages/game-core/src/game/city-pattern-invariants.ts`（更新）
- `packages/game-core/src/game/city-pattern-rules.ts`（更新）
- `packages/game-core/src/game/construction-invariants.ts`（更新）
- `packages/game-core/src/game/construction.ts`（更新）
- `packages/game-core/src/game/exploration.ts`（更新）
- `packages/game-core/src/game/facility-entries.ts`（更新）
- `packages/game-core/src/game/facility-entry-invariants.ts`（更新）
- `packages/game-core/src/game/harvest.ts`（更新）
- `packages/game-core/src/game/index.ts`（更新）
- `packages/game-core/src/game/influence-actions.ts`（更新）
- `packages/game-core/src/game/liskarm.ts`（更新）
- `packages/game-core/src/game/role-effects.ts`（更新）
- `packages/game-core/src/game/role-rules.ts`（更新）
- `packages/game-core/src/game/round-invariants.ts`（更新）
- `packages/game-core/src/game/round.ts`（更新）
- `packages/game-core/src/game/schema.ts`（更新）
- `packages/game-core/src/game/warehouse.ts`（更新）
- `scripts/check-pattern-continuations.mjs`（新增）

恢复后最终核验：2087/2087、strict/build通过；全部22项编译检查再次22/22退出0（670.49秒），包括新增12段四张样式真实流程。无删除、无未完成的本批验证。


## 2026-10-24 · 三张样式额外行动与角色例外

基准main提交c790987551f34b5b317aa32e05928ff2b721b576。源石工业中枢、核心商业区、拓荒指挥中枢统一接入，基础版2/3/4人支持全部13种宣告、10种特殊行动。显式GameState1.15.0保留旧数据，新增额外行动调度与同一行动轮双角色模式例外。

实际2145/2145（28文件）、strict/build通过，新增58项、旧2087项保留；新编译脚本9段正式流程全部通过。规则/API见[本批说明](City-Pattern-Major-Actions-2026-10-24.md)，实际命令、早期夹具失败修正与最终编译检查见[验证记录](testing/city-pattern-major-actions-validation-2026-10-24.md)。原始资料、静态摘要、风味、依赖锁和Accepted ADR不变，无卡面/PDF上传、UI、联机或部署。

共36份变更，新增5份，无删除；路径相对于仓库根目录。

- `README.md`（更新）
- `docs/Base-Role-Effects-2026-10-23.md`（更新）
- `docs/City-Pattern-Actions-2026-10-24.md`（更新）
- `docs/City-Pattern-Continuations-2026-10-24.md`（更新）
- `docs/City-Pattern-Major-Actions-2026-10-24.md`（新增）
- `docs/City-Patterns-2026-10-24.md`（更新）
- `docs/Delivery-Manifest.md`（更新）
- `docs/DevLog.md`（更新）
- `docs/Game-State-Foundation-2026-10-17.md`（更新）
- `docs/Round-Flow-2026-10-23.md`（更新）
- `docs/testing/city-pattern-major-actions-validation-2026-10-24.md`（新增）
- `package.json`（更新）
- `packages/game-core/src/game/action-window.ts`（更新）
- `packages/game-core/src/game/city-move.ts`（更新）
- `packages/game-core/src/game/city-pattern-actions.ts`（更新）
- `packages/game-core/src/game/city-pattern-major-actions.test.ts`（新增）
- `packages/game-core/src/game/city-pattern-major-actions.ts`（新增）
- `packages/game-core/src/game/city-pattern-rules.ts`（更新）
- `packages/game-core/src/game/city-pattern-schema.ts`（更新）
- `packages/game-core/src/game/construction-invariants.ts`（更新）
- `packages/game-core/src/game/construction.ts`（更新）
- `packages/game-core/src/game/exploration.ts`（更新）
- `packages/game-core/src/game/facility-entries.ts`（更新）
- `packages/game-core/src/game/facility-entry-invariants.ts`（更新）
- `packages/game-core/src/game/harvest.ts`（更新）
- `packages/game-core/src/game/index.ts`（更新）
- `packages/game-core/src/game/influence-actions.ts`（更新）
- `packages/game-core/src/game/liskarm.ts`（更新）
- `packages/game-core/src/game/role-effects.ts`（更新）
- `packages/game-core/src/game/role-rules.ts`（更新）
- `packages/game-core/src/game/round-invariants.ts`（更新）
- `packages/game-core/src/game/round.ts`（更新）
- `packages/game-core/src/game/schema.ts`（更新）
- `packages/game-core/src/game/state.ts`（更新）
- `packages/game-core/src/game/warehouse.ts`（更新）
- `scripts/check-pattern-major-actions.mjs`（新增）


## 2026-10-25 · 恢复审计增量

恢复37份既有开发变更，无新增玩法逻辑。本轮更新DevLog、本清单和三张样式验证记录；新增testing/recovery-validation-2026-10-25.md及testing/recovery-2026-10-25/中的两份全量验证日志、23份编译检查日志与results.json。远端main仍c790987；恢复提交仅在本地分支，待具体发布授权。


## 2026-10-25 · 临时聚居点批次

基准main f0a976c；新增facilities/temporary-settlement.ts、game/temporary-settlements.ts与38项测试、scripts/check-temporary-settlements.mjs、规则/API和验证文档，保留最终verify及24项编译脚本日志。更新库存引用校验、执行查询、宣告/新兴建筑群证据、1.16.0继承和README/玩法规范/DevLog；原JSON、旧固定摘要、ADR与依赖锁不变。2183/2183、strict/build、24/24脚本及12段真实流程通过。按本轮授权提交main；不含原图/PDF、node_modules、dist或部署。


## 2026-10-25 · 正式终局计分

基准main434bbc9；新增game/final-scoring.ts、44项final-scoring.test.ts、scripts/check-final-scoring.mjs，以及终局规则/API、验证记录和完整执行日志。更新终局1.17.0严格Schema/交叉验证、既有能力继承、终局公开结果及README/DevLog等说明；原静态JSON、摘要、ADR与依赖锁不变。全量2227/2227、strict/build通过；测试夹具优化后44项及strict再次通过，25/25编译检查与12段真实八回合全部通过。源码和文档提交既有main，不含原PDF/检查图、node_modules、dist或部署。


## 2026-10-26 · 整局视图与玩家接口

基准main ec567b8；新增game/views.ts、game/player-api.ts、61项player-api.test.ts；原样式航道命令Schema仅改具名导出并复用，包入口新增视图／协议导出。check-final-scoring.mjs新增--player-api模式，package新增check:player-api；复用原真实整局夹具，未复制另一套规则。新增接口约定、验证说明与testing/player-api-2026-10-26/四份原始日志，更新README、回合／采集、DevLog与本清单。最终2288/2288、strict/build及12场真实整局通过，2000接受／42拒绝／36检查点；原25独立脚本未在本批逐一重跑。数据／摘要、ADR、依赖锁及存档格式不变，不含node_modules、dist、原图或部署。按既有授权提交main。


## 2026-10-26 · 服务端房间与持久化基础

基准main9ab6f8f；新增packages/server完整工作区：package/构建配置、房间模型、队列、服务、SQL适配、Nest模块及index、rooms.test.ts37项、migrations/001-rooms.sql；新增scripts/check-room-service.mjs。根package/lock、类型／Vitest配置接入工作区，原game-core源码与依赖条目不变。新增Server-Room-Persistence说明、testing/rooms-validation及rooms-2026-10-26四份成功原始日志，更新README/DevLog/本清单。实际2325/2325、strict、双包构建和PGlite三场完整八回合／文件数据库重开通过；无dist复验37项通过。原生PostgreSQL专用验收命令已提供但本批未运行；不含用户数据库／服务器配置、node_modules、dist、临时数据目录或部署。


## 2026-10-26 · 会话凭证与Socket.IO网络基础

基准main d8d3871；新增sessions／socket-protocol／room.gateway／socket-application四份服务源码、43项sockets.test及002-sessions.sql，包入口导出新合同。原check-room-service.mjs新增--sockets复用真实流程，根新增check:sockets及显式原生PostgreSQL命令；根／server package、依赖锁及装饰器配置更新。新增Socket-Sessions文档、sockets验证记录与三份成功原始日志，更新README、服务端基础说明、DevLog和本清单。实际2368/2368、strict、双包构建及真实loopback上三场八回合／原会话重开恢复通过（467玩家提交、84可信提交、81成员核对、1556专属推送）。原生PostgreSQL模式未执行；不含凭证原文、用户数据库／服务器配置、node_modules、dist、临时数据库或部署。


## 2026-10-26 · 自动基础局生命周期

基准main fa74634；新增automatic-base-plan、base-room-factory、automatic-lifecycle、32项调度测试及003迁移，扩展RoomSnapshot/SQL适配／RoomService／网关和外层类型，原网络文件新增1项恢复测试。新增独立check-automatic-rooms.mjs及两条检查命令；不修改既有手动编译检查。新增自动生命周期说明、验证记录和四份成功日志，更新README、Socket说明、DevLog与本清单。最终2401/2401、strict、双包构建通过，真实网络3场八回合479玩家提交／105自动写入／1532推送，手动阶段调用0；原生PostgreSQL模式未执行。原依赖锁、规则核心／数据／摘要／ADR和存档版本不变，不含秘密凭证、node_modules、dist、临时数据库或部署。


## 2026-10-27 · 本人房间目录与退出会话

基准main7c1eecd；新增room-directory.ts、17项目录测试及004成员索引迁移；原网络文件新增11项，网关增加session:current／room:list／session:logout，模块／导出／协议和迁移入口接入。原check-automatic-rooms.mjs保留全部整局断言并补15个入口／重启／撤销检查点。新增Room-Entry、entry-validation及entry-2026-10-27三份成功日志，更新README／Socket说明／DevLog及本清单。最终2429/2429、strict、双包构建、三场真实八回合网络复验退出0；退出凭证在再次重启后仍拒绝，对局未改变。原依赖锁、规则核心／数据／摘要／ADR及存档版本不变，不含明文凭证、node_modules、dist、临时数据库或部署；原生PostgreSQL未验收。按既有授权提交main。


## 2026-10-27 · 本地大厅与原子开局

基准mainc3a78bc；新增lobby-state.ts、lobby-service.ts、31项lobbies.test.ts及005-lobbies.sql，原网络测试新增12项；网关／模块／索引／协议类型／迁移接入，原自动编译脚本新增--lobbies模式，根package新增check:lobbies及专用PostgreSQL命令。新增Local-Run、Lobby-Flow、lobbies-validation及本批原始日志，更新README／入口／网关历史提示／DevLog／本清单。最终2472/2472、strict、双包构建和本地真实网络三场大厅到八回合通过（24大厅写入／75推送／3次准备期重启，原479玩家写入／105自动写入／1532游戏推送）。首次测试夹具spy递归失败已修正并保留日志。game-core／数据／摘要／ADR／GameState格式／锁定依赖不变，不含明文邀请／会话、node_modules、dist或临时数据库；原生PostgreSQL和部署未执行。按既有授权保存main。


## 2026-10-27 · 本地React大厅与入场界面

基准main26f18ee；新增packages/web的package／HTML／浏览器tsconfig／React页面／样式／CityClient及11测试，server新增entry-options及2网络项，RoomService／网关／包导出接入，工厂增加可信HTTP初始化回调。新增local-app／dev-local／check-local-web三个开发脚本，根workspaces／scripts／lock及Vitest范围更新，忽略.local测试数据。新增Local-Web／local-web-validation及五份原始日志，更新Local-Run／README／DevLog／本清单。最终2485/2485、strict及三包构建、最终编译本地主机HTTP／身份守卫／3场入场到首回合及重启恢复通过；浏览器安全策略拒绝预览，点击／截图／视觉QA未完成。核心／数据／摘要／ADR／存档版本不变；包含明确前端及关联构建依赖更新，不含凭证／邀请、node_modules、dist、测试数据库、官方图像或部署。按既有授权保存main。


## 2026-10-27 · 双显示架构与回合准备

基准main3c21df5；新增Accepted ADR-0002、renderers/types／Board2D／BoardRenderer及RoundPreparation，提取原概览并新增移供应／盖放面板；server新增round-setup-options及11测试、3网络项，controller新增候选缓存／原round提交及4客户端项。RoomService／网关／索引接入，check-local-web扩展11次真实准备写入与持久化恢复。新增回合准备合同／验证说明及五份原始日志，README／Local-Run／首批页面历史提示／DevLog／本清单更新。2503/2503、strict及三包构建通过；全量后仅补展示阶段门控，最终前端严格检查／构建、3场本地首回合准备与重启再通过。无浏览器点击／视觉证明，2.5D模型及模式切换未实现。原核心／数据／摘要／存档／ADR-0001／依赖不变，不含凭证、node_modules、dist、测试数据库、官方图像或部署。按既有授权保存main。


## 2026-10-27 · 部署与调度界面

基准mainc5e21d4；新增server/action-options及11测试、共享MajorActionPanel，原网关／RoomService／包索引接入，网络新增3项，CityClient新增版本缓存与3项，Board2D／类型／页面／样式及编译脚本扩展。新增Influence-Action-UI、influence-ui-validation及六份原始日志（包括一次测试重连夹具失败）；README、Local-Run、上一批准备文档历史提示及DevLog同步。最终2520/2520、strict与三包构建通过；恢复既有行动阶段角色信息展示后web严格检查／构建再通过，最终三场本地编译恢复通过（19入场／30自动初始化／11准备／45主要行动写入、9部署／5调度）。实际在调度中途重开服务与PGlite文件库，不是本批八回合或人工点击整局。浏览器视觉验收仍受此前策略限制；原规则核心／数据／摘要／存档／ADR／依赖不变，不含凭证、node_modules、dist、临时数据库或部署。按既有授权保存main。
