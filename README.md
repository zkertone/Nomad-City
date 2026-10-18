# Nomad City Online · v0.2.0

《游城拓荒：铸基者》私人非商业线上桌游项目。已实现地图核心、基础事件静态目录、最小对局状态与标记守恒，以及两人至四人的入场流程和全部基础事件选项的独立结算核心。已接入探索行动的付费、揭牌、事件和末尾放置链路。城市移动、完整回合调度、UI 和联机尚未实现。

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

基础事件牌的文本与数值现已由项目负责人确认；最小状态、标记守恒、入场选择与绿色奖励已实现。角色及城市样式等数据尚未齐备，全部基础事件的独立结算核心已完成，探索现已接入黄色/红色事件，后续推进城市移动和完整回合调度。UI、联机与完整回合仍未实现。

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

`context = {gameId, actorId, nodeId, cardId}` 必须与已揭示标记一致。玩家请求仅含 `choiceId`、需要时的 `costDecision` 和 `influenceSlotId`。独立核心不处理身份认证、抽牌、路费、行动末尾放置或防重放；探索已通过后续增量提供可信行动调用方；城市移动仍待完成，不能将独立核心直接开放为网络请求。

事件结算增量验收时：**473/473 测试**（新增结算 94）、strict 类型检查、构建及五项编译包检查通过。运行 `npm run verify` 与 `npm run check:settlement` 可复现；规则映射和信任边界见 [结算说明](docs/Event-Settlement-2026-10-18.md)，真实执行历史见 [验证记录](docs/testing/event-settlement-validation-2026-10-18.md)。项目版本仍为 0.2.0，未发布或部署。


## 探索行动链路增量 · 2026-10-18

已实现一次探索的完整执行：服务器校验实际城市起点、目标和航道路径，支付路费，揭示对应事件并等待玩家选择，结算事件后独立处理目标点末尾影响力。支持实际 2/3/4 人入场后探索黄色/红色及剩余绿色点，JSON 恢复不会重新收费/抽牌/发奖。

新增 `openExplorationWindow`、`applyExplorationCommand`、`getExplorationTollQuote`、`getPendingExplorationChoiceRequirements` 和 `getExplorationFinalSlotIds`，从根包与 `/game` 导出。玩家选择路线、必要的路费收款人、事件选项和合法槽；不能指定回合、身份、牌序或奖励。

`openExplorationWindow` 是可信服务端授予一次探索机会的集成入口；完整回合模块尚未实现，必须由未来调用方负责实际回合、角色阶段和主要行动额度，不能把这个函数开放为玩家请求。探索 complete 不自动跳过快速行动或推进整轮。

进入探索时明确转换到 GameState **1.2.0**，保存进度、剩余牌序及实际入场的顺时针/起始顺序；旧 1.0.0/1.1.0 入场快照仍兼容。隐藏牌序仍不可直接广播。项目版本、地图/事件内容版本与摘要保持不变，没有部署或发布。

最新真实验证：**553/553 测试**（新增探索 80），strict 类型检查、构建及六项编译包检查通过。`npm run check:exploration` 实际完成两人、三人、四人的“入场 → 黄色探索 → 红色探索”，含事件额外放置与末尾放置、JSON 恢复和旧版本重放拒绝。见 [探索说明](docs/Exploration-Flow-2026-10-18.md) 和 [实际验证记录](docs/testing/exploration-validation-2026-10-18.md)。
