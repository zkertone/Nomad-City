# Nomad City Online · v0.2.0

《游城拓荒：铸基者》私人非商业线上桌游项目。当前为独立的TypeScript规则核心：已实现地图、全部基础事件选项、入场、主要行动、采集、受管回合、5张初始角色的10种模式，以及全部18类基础设施的设置/建设/入场处理。按负责人确认的同名卡仅颜色不同，普通建设支持16类/41张，另支持3色延伸枢纽和4张核心，共48/48张。区块/计分可只读预览，完整桌游、UI及联机仍待完成。

最新一批见 [剩余基础设施](docs/Remaining-Facilities-2026-10-23.md)：物流/延伸、免费完整移城及航道标记、复制入场、额外付费建设、理事处本回合最后生效与保存恢复。显式升级GameState1.12.0后使用；已有旧格式路径继续兼容。

```bash
npm run verify
npm run check:remaining-facilities
```

## 安装与复现

Node.js >= 22.12.0，npm >= 10。已锁定依赖版本。可以克隆仓库后进入项目根目录：

```bash
git clone https://github.com/zkertone/Nomad-City.git
cd Nomad-City
```

也可以解压 v0.2.0 源码归档。然后在包含 `package.json` 的项目根目录运行：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check:maps
npm run check:events
npm run check:game
npm run check:entry
npm run check:settlement
npm run check:exploration
npm run check:city-move
npm run check:influence
npm run check:harvest
npm run check:scoring
npm run check:facilities
```

`npm run verify` 合并类型检查、Vitest 和构建。`npm run test:watch` 进入测试监视模式。核心不依赖 React、Three.js、NestJS 或数据库。依赖分别为 Zod 4.6.7、Vitest 5.0.4、TypeScript 5.9.3；`package-lock.json` 固定实际依赖树。

本轮实际运行环境：Node 24.19.0 / npm 11.9.0。完整执行结果和首次失败修复记录见 `docs/testing/v0.2.0-validation.md`。npm 环境出现 `http-proxy` 配置弃用提醒，未影响本轮安装与验证；源码未写入代理设置。

## 模块使用

构建后，npm workspace 包可直接由 Node.js 加载：

```javascript
import {
  loadFoundersBoard,
  getRoutesForNode,
  getNodesForRoute,
  areNodesDirectlyConnected,
  validateBoardDefinition,
  createEmptyBoardState,
} from '@nomad-city-online/game-core/board';

const board = loadFoundersBoard('three-player');
const result = validateBoardDefinition(board);
console.log(result.success); // true
console.log(getRoutesForNode(board, 'E-01').map(route => route.id));
console.log(getNodesForRoute(board, 'R-route-04').map(node => node.id));
console.log(areNodesDirectlyConnected(board, 'F-03', 'F-02', 'R-route-04'));

// 两人仅复用三人几何，人数玩法规则不写入地图。
const emptyState = createEmptyBoardState(board, ['player-1', 'player-2']);
```

查询不存在的节点/航道会抛出 `RangeError`；布尔连接判断遇到不存在 ID 或源=目标时返回 false。返回的是拓扑关系，绝不表示行动合法。加载及完整验证结果深度冻结；验证器解析副本，不修改调用者输入。

## 地图及验证

| 项目 | 三人面 | 四人面 |
| --- | ---: | ---: |
| 资源点 / 航道 / 区块 | 18 / 20 / 7 | 22 / 22 / 8 |
| 资源点槽 / 航道槽 / 总槽 | 36 / 30 / 66 | 44 / 33 / 77 |
| 控制分总和 | 23 | 26 |

E/F 各 4 分，其他区块各 3 分。全部条目依据 `docs/Map-Analysis-v0.1.0.md` REVIEW-02；三人面独立配置，不由四人面删点生成。航道的 `incidentNodeIds` 支持两端、三端和四端，共用一个航道身份及槽位。

验证分三层：

1. `boardDefinitionSchema`：Zod 严格结构及 ID 分类，不接受额外字段。
2. `validateBoardDefinition`：ID/键匹配、引用、槽唯一归属、连通性、版本、源证据、全部节点/航道事实及精确容量，最后核对摘要。`parseBoardDefinition` 是抛错版本。
3. Vitest 从保留的 Markdown 原始表独立读取所有节点与航道，与生产配置逐项比较；不能只凭总数通过。

`verification/verified-catalog.json` 是从批准清单独立转录的基准，不从生产配置派生，也不会在测试中自动更新。修改连接、容量或数据版本时必须有项目负责人确认的依据；不要为让测试通过而重写基准或黄金摘要。

Record 的键天然唯一；对象中的重复 ID、键/ID 不一致、槽列表重复和跨对象槽重用都会被拒绝。已被 JavaScript 对象或 `JSON.parse` 覆盖掉的重复 JSON 键无法事后恢复，因此不要把未经专门重复键检查的手工 JSON 文本视为可靠输入。本轮配置使用 TypeScript 显式条目，构建辅助器在转成 Record 前检测重复点/航道/区块行。

## SHA-256 契约

协议 `nco-board-c14n-v1`。`canonicalBoardContent` 生成如下封装的规范 JSON：

```json
{"hashProtocol":"nco-board-c14n-v1","definition":{}}
```

其中 definition 是完整 BoardDefinition 去掉 **仅一个** `contentHash` 字段。包含 definitionId、schemaVersion、definitionVersion、mapSide、区块标签与分值、所有节点/航道属性、所有槽位及 sourceRefs。不会包含文件路径、代码缩进、生成时间或动态 BoardState。

- 对象键使用 JavaScript 默认 `.sort()` 的 UTF-16 字典序排序，不用受系统语言影响的 `localeCompare`。
- 本 schema 的全部数组均为无序 ID 集合：sourceRefs、incidentNodeIds、influenceSlotIds。递归规范化每项后排序；重复项不合并，完整性检查会拒绝重复。
- 保留字符串原值，不作 Unicode NFC、大小写或空格转换。数字按 JSON 序列化；Schema 要求整数，拒绝 NaN/Infinity。
- JSON 无缩进、无末尾换行；UTF-8 编码送入 Node `createHash('sha256')`；结果为 `sha256:` 加 64 位小写十六进制。
- 如果未来加入顺序有意义的数组，必须升级 hashProtocol/schema，不可继续按集合排序。

| 定义 | 数据版本 | 内容摘要 |
| --- | --- | --- |
| founders-map-3 | 1.0.0 | `sha256:dbe7945c709d50f435c320ad2d09ca98660400762aaedc93a65f73260b1aab92` |
| founders-map-4 | 1.0.0 | `sha256:f6e4455cf20f20efbd2bf56768051ac9d86ee459e3325687fb69598b057a41bc` |

项目版本 0.2.0 与地图数据/Schema 版本 1.0.0 分开。`DefinitionRef` 需同时匹配 ID、数据版本和摘要。哈希提供内容一致性而非签名认证；完整验证还会逐项核对固定基准，因此任意修改连接后重新计算摘要仍不能通过。

## 文件结构与边界

主结构按任务建议保留。另有 `hash.ts`（规范化与摘要）、`state.ts`（空状态及结构引用检查）、`definitions/build.ts`（机械组装）、`verification/verified-catalog.json`（独立基准）、包导出入口、编译加载检查和可选归档脚本。这些补充用于避免循环依赖及分离数据、校验和构建。

`BoardState` 保存城市位置、指示物和影响力槽占用。`validateBoardState` 本身只检查结构、定义引用、ID 覆盖、城市引用、重复城市/标记及已登记玩家。事件指示物目录匹配及标记库存守恒由后续 game 模块校验；两者均**不能替代完整行动合法性验证**。没有任何客户端权威写状态入口。

原 v0.1.0 文档按历史稿原样保留；当前实现状态以 DevLog 的 v0.2.0 条目、Accepted ADR、源码和真实测试为准。原文中的设计片段不能当作实现依据，当前事件结算进度见后续增量章节。

## 文件交付与后续

本仓库保存源码、锁文件、测试及文档，后续代码开发以仓库为准；逐文件位置见 [交付清单](docs/Delivery-Manifest.md)。ZIP 作为阶段备份，省略可用 `npm ci`/build 重建的 node_modules 和 dist，不含实体图片或官方 PDF。

可选重新打包需 Python 3 标准库：`npm run archive`；Windows 也可运行 `python scripts/archive.py`。Python 只用于 ZIP 包装，不是地图核心依赖。

基础事件牌的文本与数值现已由项目负责人确认；最小状态、标记守恒、入场选择与绿色奖励已实现。角色及城市样式等数据尚未齐备，全部基础事件的独立结算核心已完成，探索现已接入黄色/红色事件，城市移动已随后完成，后续推进其他行动和完整回合调度。UI、联机与完整回合仍未实现。

## 事件静态目录增量 · 2026-10-17

目录保留 22 张基础牌、49 个选项的完整描述与对白、资源指示物、四人标识、费用和效果；两张 E 企业扩展牌未混入。项目版本继续保留 0.2.0；事件 Schema/数据版本为 1.0.0，这次没有发布新版本。

```javascript
import {
  FOUNDERS_EVENT_CATALOG,
  getFoundersEventCard,
  getFoundersEventCards,
  validateFoundersEventCatalog,
} from '@nomad-city-online/game-core/events';

console.log(validateFoundersEventCatalog(FOUNDERS_EVENT_CATALOG).success); // true
console.log(getFoundersEventCards('green').length); // 6
const event = getFoundersEventCard('Y05');
console.log(event.description);
console.log(event.choices[0].narration);
console.log(event.choices[0].cost); // { asset: 'columbia-voucher', amount: 4 }
```

返回值嵌套只读且冻结；解析器验证副本，不冻结或改写调用者输入。按颜色查询不替代人数规则/牌堆准备；本模块不会支付费用、发放奖励或改变地图。完整验证还要求固定批准摘要匹配，单独 Schema 通过不等于内容与已确认版本一致。

事件摘要协议 `nco-events-c14n-v1` 按对象键排序，保留所有数组顺序，并包含文案与来源文件摘要；不能复用地图的无序 ID 集合协议。具体字段、结算边界和下一步案例见 [事件说明](docs/Event-Resolution-Boundaries-2026-10-17.md)。

真实验证：strict 类型检查、225/225 Vitest 测试（地图 88、事件 137）、构建与两个编译包加载检查通过。包含从已确认 Markdown 独立读取逐牌、逐选项比对；不把文档或静态数据测试当作事件执行验证。命令及中间失败记录见 [本次验证记录](docs/testing/event-catalog-validation-2026-10-17.md)。

## 最小对局状态增量 · 2026-10-17

```javascript
import {
  createPreEntryGame, getMarkerLedger, validateGameState,
} from '@nomad-city-online/game-core/game';

const { definition, state } = createPreEntryGame('private-game', [
  { id: 'alice', color: 'red' },
  { id: 'bob', color: 'blue' },
]);
console.log(definition.rulesetId); // founders-base-2p
console.log(definition.boardDefinitionRef.definitionId); // founders-map-3
console.log(state.markerSupplyByPlayer.alice.length); // 29：另 1 枚在 0 分处
console.log(Object.keys(getMarkerLedger(state, definition)).length); // 60
console.log(validateGameState(state, definition).success); // true
```

构造器位于决定先手、初始城市/事件和初始资金之前，余额从 0 开始。账本从供应堆、计分标记引用和原有棋盘槽占用推导，不另存第二套标记位置；城市样式用途尚未实现。两人/三人复用同一地图定义，人数规则 ID 分开。

GameDefinition 由服务器持有；快照校验不是允许客户端提交任意余额的接口，也不验证完整行动过程。当前没有网络写入口。模块返回深度冻结副本，费用查询不修改资源余额。

最小状态增量验收时：**311/311 测试**（地图 88、事件 137、对局状态 86）、strict 类型检查及构建通过；`check:game` 和原地图/事件编译包检查通过。说明见 [对局状态基础](docs/Game-State-Foundation-2026-10-17.md) 和 [实际测试记录](docs/testing/game-state-validation-2026-10-17.md)。

## 入场与绿色事件执行增量 · 2026-10-18

```javascript
import { createPreEntryGame, beginEntry, applyEntryCommand } from '@nomad-city-online/game-core/game';

const game = createPreEntryGame('demo', [
  { id: 'alice', color: 'red' }, { id: 'bob', color: 'blue' }, { id: 'carol', color: 'green' },
]);
// 可信服务端传入实际顺时针座位和玩家选定的先手；绿色牌自动洗牌。
let state = beginEntry(game.state, game.definition, {
  startingPlayerId: 'alice', clockwisePlayerIds: ['alice', 'bob', 'carol'], expectedVersion: 0,
});
state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: 'alice' }, {
  gameId: 'demo', expectedVersion: state.stateVersion, type: 'select-initial-node', nodeId: 'A-01',
});
// 示例玩家选择选项 1；实际产品由玩家作出选择，服务器校验并执行。
const choiceId = `${state.entry.pendingEvent.cardId}:1`;
state = applyEntryCommand(state, game.definition, { authenticatedPlayerId: 'alice' }, {
  gameId: 'demo', expectedVersion: state.stateVersion, type: 'choose-green-event', choiceId,
});
```

玩家请求不能指定身份、抽牌或奖励。B-01 需要明确选择 claim/decline；两人禁选 B-01，后手额外影响力可选择放置或跳过。初始资金和两人后手 3 分只在对应流程完成后发放一次。

旧 1.0.0 入场前快照可兼容；启动入场后使用 1.1.0 格式保存顺序、剩余绿色牌堆和待选事件。权威快照含隐藏牌序，不能直接作为未来客户端广播数据；公开状态投影与网络服务尚未实现。

入场增量验收时：**379/379 测试**（地图 88、事件静态目录 137、原状态 86、入场 68）、strict 类型检查、构建及四项编译包检查通过。见 [入场说明](docs/Entry-Flow-2026-10-18.md) 与 [真实测试记录](docs/testing/entry-validation-2026-10-18.md)。项目没有发布新版本或部署；入场 complete 也不代表完整回合已经实现。


## 基础事件结算增量 · 2026-10-18

`settleEventChoice` 已实现全部 49 个基础选项，处理费用决定、资源/金券/分数、每名对手奖励和三种影响力放置范围。Y05:1 允许明确放弃费用；支付后无法放置不退款。R06:3 无法放置仍保留先前金券；有可执行的放置时必须由玩家选择合法目标。红牌 ×2 不翻倍即时奖励。

`GamePosition` 是既有棋盘、玩家、供应字段的工作视图，共用原守恒/引用校验；不另存第二份局面。绿色入场奖励已复用结算核心，GameState 1.0.0/1.1.0 格式保持兼容。

核心调用接口（均从 `/game` 或根包导出）：

```typescript
// position 和 context 均由可信行动调用方准备，不能取自客户端整份状态。
const requirements = getEventChoiceRequirements(position, definition, context, selectedChoiceId);
const result = settleEventChoice(position, definition, context, playerChoice);
// 行动调用方验证 pending/version 后，只应用一次 result.position 并继续行动。
```

`context = {gameId, actorId, nodeId, cardId}` 必须与已揭示标记一致。玩家请求仅含 `choiceId`、需要时的 `costDecision` 和 `influenceSlotId`。独立核心不处理身份认证、抽牌、路费、行动末尾放置或防重放；探索已通过后续增量提供可信行动调用方；城市移动也已接入，不能将独立核心直接开放为网络请求。

事件结算增量验收时：**473/473 测试**（新增结算 94）、strict 类型检查、构建及五项编译包检查通过。运行 `npm run verify` 与 `npm run check:settlement` 可复现；规则映射和信任边界见 [结算说明](docs/Event-Settlement-2026-10-18.md)，真实执行历史见 [验证记录](docs/testing/event-settlement-validation-2026-10-18.md)。项目版本仍为 0.2.0，未发布或部署。


## 探索行动链路增量 · 2026-10-18

已实现一次探索的完整执行：服务器校验实际城市起点、目标和航道路径，支付路费，揭示对应事件并等待玩家选择，结算事件后独立处理目标点末尾影响力。支持实际 2/3/4 人入场后探索黄色/红色及剩余绿色点，JSON 恢复不会重新收费/抽牌/发奖。

新增 `openExplorationWindow`、`applyExplorationCommand`、`getExplorationTollQuote`、`getPendingExplorationChoiceRequirements` 和 `getExplorationFinalSlotIds`，从根包与 `/game` 导出。玩家选择路线、必要的路费收款人、事件选项和合法槽；不能指定回合、身份、牌序或奖励。

`openExplorationWindow` 是可信服务端授予一次探索机会的集成入口；完整回合模块尚未实现，必须由未来调用方负责实际回合、角色阶段和主要行动额度，不能把这个函数开放为玩家请求。探索 complete 不自动跳过快速行动或推进整轮。

进入探索时明确转换到 GameState **1.2.0**，保存进度、剩余牌序及实际入场的顺时针/起始顺序；旧 1.0.0/1.1.0 入场快照仍兼容。隐藏牌序仍不可直接广播。项目版本、地图/事件内容版本与摘要保持不变，没有部署或发布。

探索增量验收时：**553/553 测试**（新增探索 80），strict 类型检查、构建及六项编译包检查通过。`npm run check:exploration` 实际完成两人、三人、四人的“入场 → 黄色探索 → 红色探索”，含事件额外放置与末尾放置、JSON 恢复和旧版本重放拒绝。见 [探索说明](docs/Exploration-Flow-2026-10-18.md) 和 [实际验证记录](docs/testing/exploration-validation-2026-10-18.md)。


## 城市移动增量 · 2026-10-18

`openCityMoveWindow` / `applyCityMoveCommand` 已实现城市移动完整链路：先支付 3 源石、不收路费，沿玩家指定的单航道移动，清除该航道和目标点全部对手影响力并归还；目标未探索才揭牌/结算事件，最后独立放置影响力。保留本人、源点及分叉其他端点上的影响力；已探索目标不重复触发原事件。

新增只读查询 `getCityMoveOptions`、`getPendingCityMoveChoiceRequirements`、`getCityMoveFinalSlotIds`。一次可信授权、身份/对局/版本/阶段检查继续执行。玩家不能指定源点、费用、清除清单、牌号或奖励。

GameState **1.3.0** 支持城市移动及之后的探索，行动间保留同一牌堆、实际玩家顺序和全局版本，不降回旧格式；1.0.0/1.1.0/1.2.0 原有行为保留。完整回合/角色/主要行动额度仍需未来可信调用方校验，授予机会的函数不能作为玩家请求开放。项目版本仍为 0.2.0，没有部署或发布。

城市移动增量验收时：**631/631 测试**（新增城市移动 78），strict 类型检查、构建及七项编译包检查通过。`npm run check:city-move` 实际执行 2/3/4 人“入场 → 未探索点城市移动 → 探索 → 已探索点城市移动”，验证费用、恢复、重放拒绝与库存守恒。规则、格式及边界见 [城市移动说明](docs/City-Move-Flow-2026-10-18.md)，实际失败/修复和最终结果见 [验证记录](docs/testing/city-move-validation-2026-10-18.md)。


## 部署与调度增量 · 2026-10-18

已实现 `openDeploymentWindow` / `openDispatchWindow` / `applyInfluenceCommand`，以及部署槽、调度源/目标的只读查询。部署从本人供应放 1 枚现存标记；调度逐次移动自己的棋盘标记至多 2 次，可零次/一次后结束，可连续移动同一枚标记。移动保留 ID 和所有者，供应为零仍能调度。

目标只检查空槽、资源点已探索和无对手城市，不添加距离限制或路费。每步验证最新状态、当前玩家和预期版本，支持第一次移动后 JSON 恢复。没有可执行操作时自动结束；调度不能替换未完成的其他行动。

新增状态格式 **1.4.0**，在部署/调度后继续探索、城市移动时保持该格式，同一牌堆、玩家顺序、棋盘与库存不重置。旧 1.0.0–1.3.0 仍兼容；项目版本、地图/事件数据和摘要不变。完整回合授权仍由未来可信调用方负责，当前没有网络或数据库事务。

最新实际验证：**687/687 测试**（新增部署/调度 56），strict 类型检查、构建及八项编译检查通过。`npm run check:influence` 真实执行 2/3/4 人的入场、远处部署、同一标记两次调度、免费探索及已探索点城市移动，验证恢复、重放拒绝与逐枚库存守恒。见 [部署与调度说明](docs/Influence-Actions-2026-10-18.md) 和 [真实测试记录](docs/testing/influence-actions-validation-2026-10-18.md)。

## 同时采集增量

已实现全员采集方案、本人城市/影响力点查询、连接网络校验、共用独立航道去重收费与原子批量支付/收益。每点按实际标记采集一次；不以颜色推导数量。最后一人提交前不修改任何余额，所有人先扣路费再统一获益，不依赖同阶段收入支付费用。

GameState 1.5.0 保留旧格式兼容；采集 complete 后拒绝重放和同轮重开，下一轮已实现行动保留唯一棋盘、牌堆和玩家顺序。可信调用方仍负责确认两轮行动已完成，完整回合编排、收尾/计分与建设尚未实现。

说明：[同时采集](docs/Harvest-Phase-2026-10-18.md)；实际验证：[749 项测试与编译包记录](docs/testing/harvest-validation-2026-10-18.md)。`npm run check:harvest` 可复现 2/3/4 人行动 → 全员采集 → 下轮行动及 JSON 恢复。

## 区块控制与基础计分预览 · 2026-10-18

新增 `getRegionControl`、`getResourceScoreBreakdown` 和 `getBaseScoringPreview`。按区块统计真实资源点/航道标记及城市 +2，并列无控制分；剩余资源按各自完整组计分。基础总分依次比较分数、金券、至纯源石，仍相同则保留并列领先者。预览不改余额、分数、回合或游戏状态，不能代替尚未实现的角色/城市样式收尾与正式终局。

最新实际验证：**805/805 测试**（新增计分 56），strict 类型检查、构建及十项编译包检查通过。`npm run check:scoring` 验证 2/3/4 人真实入场/行动/采集后的只读预览；两人例中正确保留非起始玩家初始 3 分并以金券解开同分。规则依据、API 与边界见 [基础计分说明](docs/Base-Scoring-2026-10-18.md)，实际结果见 [验证记录](docs/testing/base-scoring-validation-2026-10-18.md)。当前仍为核心逻辑阶段，没有游戏 UI、3D 模型或联机。

## 设施颜色与数量 · 2026-10-22 更正

用户明确“红3”等数字表示对应颜色的设施个数；先前格数解释已经撤回。现用 copyCountsByColor 保存数量。E=企业扩展，O=DLC《感染者》，数量已核对为基础版 **48**、企业 **3**、感染者 **6**，混合库存 **57**。

getFacilityCopyCountRecords() 默认仅返回基础版 18 种设施、48 个实体数量，排除 E 标企业办事处、O 标临时聚居点和罗德岛办事处。核心指挥塔为虹色 4 张。原始混合报告不删减，扩展仅记录版别和数量，当前不执行扩展玩法。

设施静态格式 2.0.0 拒绝旧 colorCellCounts 字段；数量/版别已确认，totalsReconciled=true。新增卡面转录模块已记录照片中 18 种基础设施的分数、16 种普通设施的两套费用及可读效果；效果说明/风味全文已由用户补齐；跨颜色版本核对和摆放定义仍待完成。readyForPhysicalSupplySetup=true，已生成独立实体牌库与供应区；完整可玩流程 readyForDeckSetup=false。游戏状态、地图、事件格式及依赖不变。

[逐项数量和版别](docs/Facility-Colors-2026-10-22.md)、[卡面接收](docs/Card-Image-Intake-2026-10-22.md)、[实际验证](docs/testing/facility-colors-validation-2026-10-22.md)。历史测试通过不代表先前错误格数解释正确。`npm run check:facilities` 验证修正后的数量和版本过滤。


## 基础设施卡面转录 · 2026-10-22

`FOUNDERS_FACILITY_FACES` / `getFoundersFacilityFace(id)` 提供图片中可见卡面的分数、费用、入场/唯一标识、文字及图标序列；与实体数量目录分离。目录状态为 `mixed-source-transcription`，18 份风味和两处补充说明单独标记用户来源；图标另附规则书术语与页码。照片转录的适用范围仍为 `pictured-face-only`；运行规则另记录2026-10-24负责人确认：同名卡仅颜色不同，费用、分数和效果按设施类型共用，实体颜色独立保留。

`getFacilityFaceTranscriptionProgress()` 明确报告 18 个分数、16 套资源组合/金券替代费用、2 张未印普通费用；效果区及风味全文均为 18/18，缺字已由用户原文补齐；分数/费用仍保留图片转录状态。未印费用不等于免费建设。模块只提供静态转录和校验，`executionReady=false`；没有接入建设、计分或入场效果执行。

可用 `npm test -- packages/game-core/src/facilities` 运行数量和卡面测试；`npm run check:facilities` 构建后检查根/子路径导出、基准摘要、版别过滤和缺失字段状态。完整回归运行 `npm run verify`。

[逐项分数、费用、效果、风味及缺失字段](docs/Facility-Faces-Review-2026-10-22.md)；[实际验证](docs/testing/facility-faces-validation-2026-10-22.md)。SHA-256 覆盖全部数据与来源，以独立固定基准验证；它证明转录内容一致，不替代规则事实核对。


图标现在可用 `getFacilityIconMeaning(icon)` 和 `getFacilityEffectText(id)` 查询规则含义。佣兵指挥部更正为“替换1个影响力或移除1个影响力”；单个蓝色箭头为移动1个影响力，不能误作完整调度（两次移动）。格式 2.0.0 及 SHA 协议 v2 将用户原文、逐字段来源和图标含义一并纳入固定基准；历史格式不会静默迁移为用户确认。详见上方逐项表和验证记录。


## 设施实体牌库与供应区 · 2026-10-22

新增 `FOUNDERS_FACILITY_STOCK`：按已确认数量生成 48 张独立实体牌，普通41/核心4/延伸3，不从不同颜色张数推断格数、费用或效果。`shuffleFoundersFacilityDeck(randomBelow)` 由服务器注入随机源；`createFoundersFacilitySupply` 接收服务器完整牌序，创建 2/3/4 人开局：供应区6、暗牌堆35、延伸预留3、每人1核心，未用核心另存。

`validateFacilitySupplyState` 验证逐张守恒与正确分区；`replenishFacilitySupply` 是内部补牌原语，支持版本冲突检查，牌堆不足返回明确结果，不自行发明耗尽规则；`getFacilitySupplyPublicView` 仅公开暗牌数量，隐藏牌序。牌归属和补牌通过不代表某次建设已合法或入场效果已执行。该状态尚未接入 GameState，原对局/存档格式不变。

`npm test -- packages/game-core/src/facilities` 运行全部设施测试；`npm run check:facilities` 构建并检查新模块导入；`npm run verify` 执行全量回归、strict 类型及构建。[模块说明与服务器随机源示例](docs/Facility-Supply-2026-10-22.md)，[实际验证](docs/testing/facility-supply-validation-2026-10-22.md)。建设/摆放/费用和入场执行、两人角色阶段选择移牌、整局编排仍待完成。


## 玩家建造面板与位置预检 · 2026-10-23

根据新提供的玩家面板照片，记录 **3列×4行、12格**，核心指挥塔在第3行中列 `CP-3-2`，开局空位11。右侧记录/资源区域不计为建设格。规则书允许在任意空位建设，没有加设相邻已有建筑的要求。

`FOUNDERS_FACILITY_PANEL` / `createInitialFacilityPanels` 提供带来源摘要的格位定义及2/3/4人起始面板。`validateFacilityPanelState` / `validateFacilityPanelSet` 将实体牌归属与格位交叉核对；空位和十字邻接从逻辑格派生，不依赖显示坐标。`previewFacilityPanelPlacement` 校验空位、候选牌来源、操作者和版本，返回只读位置预检结果；不拿牌、扣费或授权建设。

面板模块与原 GameState 分开，完整建设和入场执行仍待接入。[格位表、来源、API与边界](docs/Player-Panel-2026-10-23.md)，[实际测试](docs/testing/player-panel-validation-2026-10-23.md)。使用现有 `npm test -- packages/game-core/src/facilities`、`npm run verify` 和 `npm run check:facilities` 验证。


## 基础建设内部事务 · 2026-10-23

`settleFacilityConstruction` 已将支付、拿牌/立即补牌、摆放、计分和支持的入场效果接成纯函数原子结算；失败不返回任何扣费或拿牌后的中间状态。`getFacilityConstructionQuote` 计算费用及支付能力，玩家不能上传金额/折扣/得分。支持城市化区域、开采电铲、城邦工业区、红色异铁冶炼厂、蓝色源石精炼厂、黄色固源岩提纯厂、城邦行政区，合计7种/15张已拍颜色实体。

合计5资源由玩家选择；城市化区域在摆放后统计核心邻格；工业区按支付前已有的不同非虹色仅减少自身源岩；唯一限制按玩家自己的同名设施校验。未拍颜色、复杂入场、延伸普通建设、暗牌不足和非法请求明确拒绝，不跳过未实现效果。

沿用事件结算器的内部GamePosition模式，没有改变GameState或另存余额。正式阶段、身份/额度、额外角色修正和外层GameState版本提交仍由后续行动层完成；此函数不能直接用作客户端端点。[支持清单、规则与边界](docs/Facility-Construction-2026-10-23.md)，[实际验证](docs/testing/facility-construction-validation-2026-10-23.md)。全量检查继续使用 `npm run verify` 与 `npm run check:facilities`。


## 建设行动窗口与权威快照 · 2026-10-23

`openConstructionWindow` / `getConstructionQuote` / `applyConstructionCommand` 将已有7类、15张匹配已拍颜色实体牌的建设接入 GameState。可信调用方授予一次普通原价建设；玩家只给牌、空格、支付方式与必要资源分配。服务器校验身份、对局和全局版本，成功同时提交扣费/补牌/位置/得分/入场与额度；失败保留原状态和窗口，重复执行明确拒绝。

新增快照 **1.6.0**：设施供应/面板各存一份，原余额不复制；切换探索、移动、部署、调度、采集时保留。1.0.0–1.5.0继续读取，不推断旧存档缺失的设施历史；首次初始化必须由可信方显式提供服务器牌序，之后禁止重置。完整角色/回合顺序、两轮主要行动及优惠仍待实现。

运行 `npm run verify` 和 `npm run check:construction`。本轮实际 **1277/1277（16文件）**、strict和构建通过，12项编译检查退出0。[接口、初始化示例与边界](docs/Construction-Window-2026-10-23.md)，[真实验证及失败修正](docs/testing/construction-window-validation-2026-10-23.md)。未来服务器仍须串行比较/提交版本，含暗牌的GameState不能直接广播；本轮无网络、数据库、UI或部署。


## 角色盖放与两轮主要行动调度 · 2026-10-23

`beginRoundFlow` / `applyRoundCommand` / `getRoundTurn` / `finishManagedRound` 提供 **GameState 1.7.0**：基础版每人5角色的盖放/库存、每回合顺时针两轮各一次主要行动、完成后采集/限定收尾、未用角色回手、起始玩家轮转，8回合后停止。两人每回合盖放前各移除一张供应设施并立即补至6张。现有建设、部署、调度、探索和城市移动全部接入，旧窗口API同样受调度限制。

`cancel-major-preparation` 仅允许撤回尚无任何实际步骤的行动准备，不退款、不撤回事件信息、不撤销已移动一步或已完成的动作；玩家仍须完成一次主要行动。`getRoundPublicView` 只公开本人手牌/盖放身份、对手牌数和公开弃牌及供应投影，不泄露对手盖放牌或暗牌序。

**角色策略/计谋、优惠、样式与特殊行动仍未实现**，不存在“已执行”占位结果。受管回合只接受当前支持的已建设施，避免略过未实现的收尾效果；角色弃牌产生过程尚未实现，回收仅实现库存规则。旧1.0.0–1.6.0仍读，1.7.0必须从已完成入场的新局显式开始，不推断旧局进度。

本轮 `npm run verify` 实际 **1349/1349（17文件）**，strict/构建和13项编译检查通过；新增编译流程真实验证2/3/4人各8回合、32/48/64次主要行动及两人16张移牌。运行 `npm run check:rounds`。[规则逐项来源与API](docs/Round-Flow-2026-10-23.md)，[真实验证](docs/testing/round-flow-validation-2026-10-23.md)。最终分数提交、完整设施与角色/样式效果、认证/联机/持久化仍待完成，无部署或发布。


## 首批基础角色效果 · 2026-10-23

已接入**4名角色的5种完整模式**：极境/德克萨斯/坎诺特策略、锡人策略和计谋。`getBaseRoleEffectSupport`给出逐模式能力；未实现模式及包含缺失模式的both会在执行任何效果前拒绝。全部角色效果标志仍为false，不把部分实现称为全角色完成。

用 `enableBaseRoleEffects(state,definition,{expectedVersion})` 显式将已验证1.7.0升级至 **1.8.0**（原状态/进度保留），再通过 `applyBaseRoleCommand` 使用自己本回合盖放的角色。只允许当前玩家在主要行动前或完整结束后使用，同回合只能使用一次；起始玩家both按策略→计谋原子结算，当前锡人不计入自身回收数量。成功才进入弃牌并记录used，不额外授予主要行动；失败不扣费、不回收、不移动、不弃牌。

角色使用与弃牌历史会跨回合保持，收尾只让未用角色回手。新格式随原动作保留，旧1.0.0–1.7.0和默认beginRoundFlow入口兼容。运行 `npm run verify`、`npm run check:roles`；本轮实际 **1439/1439（18文件）**、strict/构建和14项编译检查通过。[数值、选择格式与边界](docs/Base-Role-Effects-2026-10-23.md)，[真实验证及编译夹具修正](docs/testing/role-effects-validation-2026-10-23.md)。雷蛇两模式和其余三名角色计谋、样式与完整设施仍待实现，无UI/联机或部署。


## 雷蛇两种模式与收尾选择 · 2026-10-23

雷蛇策略按顺序尽量放置两次真实影响力，并登记本回合收尾移除1枚本人影响力；计谋可选择支付3金券，先移除指定影响力，再尝试在同槽放置本人影响力。对手城市上的标记可以移除，但不能在那里放置自己的标记。费用、库存、放置、弃牌与使用记录原子提交。

通过 `enableLiskarmEffects` 显式升级1.8.0→**1.9.0**，保留已有角色使用和弃牌历史。全员采集后用 `openManagedCleanup` 开启选择，当前待结算玩家通过 `applyRoleCleanupCommand` 移除任意本人现存棋盘影响力；未结算不能推进回合，没有本人影响力才自动跳过。所有主要行动和采集继续保持新格式。

当前基础角色支持 **7/10模式**（五名角色的策略、雷蛇与锡人计谋）；先前章节的五模式/雷蛇待完成为历史记录。极境、德克萨斯、坎诺特计谋仍待实现，全角色完成标志仍false。运行 `npm run verify`、`npm run check:liskarm`；本次实际 **1488/1488（19文件）**、strict/构建及15项编译检查通过。[API、规则与边界](docs/Liskarm-Effects-2026-10-23.md)，[真实验证记录](docs/testing/liskarm-validation-2026-10-23.md)。


## 基础初始角色十种模式齐备 · 2026-10-23

极境、德克萨斯、坎诺特三种计谋已接入：3异铁换免费相邻移城（目标至少1本人影响力且无对手）、3金券按替换→移动→移除顺序结算、全体强制将一种基础资源按2金券全部出售并由本人得1分。起始玩家both策略先于计谋，费用/市场/标记/全体余额/分数/弃牌仍原子提交。

`enableRemainingBaseRoleEffects` 显式升级1.9.0→**1.10.0**，保留旧使用历史和雷蛇义务；新增completedMajorAction记录角色使用前已经完成的主要行动，结清旧动作进度，支持主要行动后免费移城且不授予额外行动。旧1.0.0–1.9.0、默认入口及旧格式能力限制保留。

当前**5张基础初始角色的策略/计谋10/10**，能力完成标志为true；先前五模式/七模式及三计谋待完成章节保留为历史。城市样式、剩余设施、最终计分提交和联机仍待完成。运行 `npm run verify`、`npm run check:schemes`；本轮实际 **1558/1558（20文件）**、strict/构建及16项编译检查通过。[规则、API与格式](docs/Remaining-Role-Schemes-2026-10-23.md)，[真实验证和早期错误](docs/testing/remaining-role-schemes-validation-2026-10-23.md)。


## 三种即时设施入场效果 · 2026-10-23

护航调度中心、佣兵指挥部、贸易街区已完整接入内部事务和正式建设命令，当前支持 **10类/23张匹配已拍颜色实体牌**。依次移除2枚、替换或移除1枚、自选数量按3/3/4/15出售，均在支付→拿牌补牌→摆放→印刷分数之后原子结算。佣兵替换不收角色费用，贸易不能卖掉刚支付的资源或用未来收入垫付造价。

新增facilityEntryChoiceSchema和报价entryChoiceKind；回执记录实际影响力变化及出售明细，GameState不添加第二份账本或新格式。已支持1.6.0–1.10.0的设施状态继续读写；其余嵌套入场和未拍颜色仍明确拒绝，allFacilitiesImplemented=false。

运行 `npm run verify`、`npm run check:facility-entries`；本轮真实 **1629/1629（21文件）**、strict/构建及17项编译检查全部通过，新增71项测试。新编译流程实际2/3/4人从入场、部署、雷蛇标记及德克萨斯收入完成三设施建设至下一回合。[规则与API](docs/Facility-Immediate-Entries-2026-10-23.md)，[实际验证](docs/testing/facility-immediate-entries-validation-2026-10-23.md)。下一步为载具仓库等嵌套入场行动，城市样式、剩余设施和最终计分仍待完成。


## 载具仓库完整入场与恢复 · 2026-10-23

载具仓库两分支已接入：放置1个再移动1个影响力，或正常付路费探索/事件/末尾放置。建设支持现为 **11类/26张匹配已拍颜色实体**。推荐entryChoice={kind:'warehouse-entry'}先完成建设和公开补牌，再通过choose-warehouse-entry决定分支与路径；也保留玩家自愿预选全部选择的一次提交方式。

`enableWarehouseEntries` 显式1.10.0→**1.11.0**；branch-choice、event-choice、final-influence都可保存恢复，子进度只在父construction内，不增加主要行动、重复收费或抽牌。入场未完成时角色、轮次结束、旧行动窗口、采集及收尾均不能越过。旧格式继续读取，不补造仓库历史。

运行 `npm run verify`、`npm run check:warehouse`；最终实际 **1705/1705（22文件）**、strict/构建及18项编译检查全部通过，新增76项测试。真实2/3/4人两分支均从原收入走到第2回合。[规则/API及1.11.0](docs/Warehouse-Entries-2026-10-23.md)，[真实验证与首轮断言修正](docs/testing/warehouse-validation-2026-10-23.md)。后续继续高性能动力系统免费移城与航道放置，其他设施/样式/最终计分仍待完成。


### 2026-10-24 · 同名设施跨颜色规则确认

负责人确认“同名卡数据是一样的，只有颜色有区别”。已统一解除蓝色异铁冶炼厂、黄色源石精炼厂、红色固源岩提纯厂及红/蓝延伸枢纽的颜色限制，覆盖普通16类41张、延伸3张和设置核心4张，共18类48张。`getFacilityConstructionSupport()` 的 `unconfirmedPhysicalCardIds=[]`、`allFacilitiesImplemented=true` 描述这些基础设施类型和颜色处理；普通牌堆耗尽规则、城市样式、最终计分提交及联机仍待完成，完整游戏 `readyForDeckSetup` 不变。

颜色仍取实体牌的 `color`，参与工业区折扣、能源复制条件与后续颜色规则；`observedColor` 只表示原照片颜色。原照片JSON、摘要、实体数量及GameState 1.12.0格式不改，无需迁移既有存档。规则依据与接口：[同名跨颜色确认](docs/Facility-Variants-2026-10-24.md)，实际验证：[验证记录](docs/testing/facility-variants-validation-2026-10-24.md)。此前各阶段的38/43张及未确认说明属于历史，当前以上述范围为准。
