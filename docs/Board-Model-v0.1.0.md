# BoardDefinition / BoardState 设计

日期：2026-10-13；阶段：v0.1.0。状态：设计草案，未编写生产 TypeScript、规则引擎、数据库迁移或前端。

规则事实、完整两面连接表及来源见同目录 `Map-Analysis-v0.1.0.md`。本文的类型片段用于审阅字段含义，不是已实现接口。字段名称和技术处理均为工程设计，不能视为官方规则。

## 1. 职责划分

| 对象 | 职责 | 不包含 |
| --- | --- | --- |
| BoardDefinition | 单张地图面的不可变资源点、航道、槽位、区块及来源 | 城市当前位置、玩家影响力、当前回合、镜头坐标 |
| BoardState | 对局内地图上的指示物、槽位占用及城市位置 | 钱/资源余额、牌堆顺序、角色手牌、回合/行动阶段 |
| RuleSet / GameState | 人数变体、当前回合、阶段、行动次数、余额、标记供应、待结算事件 | Three.js 对象、模型尺寸 |
| BoardPresentation | 按地图面 ID 关联的点位坐标、航道曲线、槽位锚点、点击区域、模型资产 | 合法性决策和权威状态 |
| RuleEngine | 验证指令，按官方规则形成结算过程，修改服务器 GameState 中的 BoardState | 客户端直接写状态 |

不变定义按地图面区分 `founders-map-4` / `founders-map-3`。两人共用三人地图几何，但使用独立两人规则档案。`mapSide` 与 `playerCount` 不应混成同一个字段。

## 2. BoardDefinition 字段契约

| 字段 | 含义与约束 |
| --- | --- |
| definitionId | 独立地图面 ID；三人/四人分开 |
| schemaVersion / definitionVersion | 类型格式版本 / 地图转录内容版本，分别管理 |
| contentHash | 发布后冻结配置内容摘要，保证存档引用同一版本；目前不伪造生产配置摘要 |
| mapSide | `three-player` 或 `four-player` |
| sourceRefs | 指向规则书与对应照片的证据 ID；证据登记记录文件摘要/Library 身份/书面页码 |
| regions | 区块 ID、中文标签、控制奖分；用 ID 表示规则归属，UI 颜色另存 |
| resourceNodes | 官方编号、区块 ID、事件牌颜色、是否红区受限、影响力槽 ID、是否初始点 |
| routes | 唯一航道 ID、区块 ID、连接的资源点 ID 列表、影响力槽 ID |
| influenceSlots | 唯一槽 ID、所属对象引用；容量从槽列表长度得出，不再同时维护容易冲突的 capacity |

建议类型形状如下。完整接口应在正式编码阶段使用品牌类型或运行时 schema 保证 ID 分类及引用有效，不能仅靠 TypeScript `string` 检查。

```typescript
type RegionId = string;
type ResourceNodeId = string;
type RouteId = string;
type SlotId = string;
type PlayerId = string;
type MarkerId = string;
type EvidenceId = string;

type SlotLocation =
  | { readonly kind: 'resource-node'; readonly nodeId: ResourceNodeId }
  | { readonly kind: 'route'; readonly routeId: RouteId };

interface ResourceNodeDefinition {
  readonly id: ResourceNodeId;         // 例如 B-01，属于某一地图面
  readonly regionId: RegionId;
  readonly eventDeckColor: 'green' | 'yellow' | 'red';
  readonly redRestricted: boolean;
  readonly initialCityEligible: boolean;
  readonly influenceSlotIds: readonly SlotId[];
  readonly sourceRefs: readonly EvidenceId[];
}

interface RouteDefinition {
  readonly id: RouteId;                // 项目 ID，并非官方序号
  readonly regionId: RegionId;
  readonly incidentNodeIds: readonly ResourceNodeId[]; // 至少 2，允许 3/4
  readonly influenceSlotIds: readonly SlotId[];
  readonly sourceRefs: readonly EvidenceId[];
}

interface BoardDefinition {
  readonly definitionId: string;
  readonly schemaVersion: string;
  readonly definitionVersion: string;
  readonly contentHash: string;
  readonly mapSide: 'three-player' | 'four-player';
  readonly regions: Readonly<Record<RegionId, {
    readonly label: string;
    readonly controlRewardPoints: number;
  }>>;
  readonly resourceNodes: Readonly<Record<ResourceNodeId, ResourceNodeDefinition>>;
  readonly routes: Readonly<Record<RouteId, RouteDefinition>>;
  readonly influenceSlots: Readonly<Record<SlotId, SlotLocation>>;
  readonly sourceRefs: readonly EvidenceId[];
}
```

版本冻结采用完整 definitionRef，而非只存 `B-01` 这种跨地图不唯一的编号。槽 ID 可采用 `node:B-01:slot:1`、`route:C-route-02:slot:1`；两图分别拥有自己的命名空间。槽号是工程标识，不意味着有槽间移动距离。

初始点 B-01 的额外资源奖励、红区第几回合开放及行动费用属于 RuleSet，不放进图形坐标或临时 BoardState。`redRestricted` 标记受规则限制的节点；开放回合用 4/5/6 的人数规则分别确定，不能把整条红色航道设为封锁。

## 3. BoardState 字段契约

```typescript
type ResourceKind = 'orirock' | 'originium' | 'iron';

interface RevealedResourceMarker {
  readonly markerDefinitionId: string; // 固定指示物定义，决定种类及采集量
  readonly resourceKind: ResourceKind;
  readonly harvestAmount: 1 | 2;
}

interface BoardState {
  readonly definitionRef: {
    readonly definitionId: string;
    readonly definitionVersion: string;
    readonly contentHash: string;
  };
  readonly resourceMarkerByNode: Readonly<Record<
    ResourceNodeId, RevealedResourceMarker | null
  >>;
  readonly influenceBySlot: Readonly<Record<SlotId, {
    readonly ownerPlayerId: PlayerId;
    readonly markerId: MarkerId; // 与全局 30 个标记账本关联
  } | null>>;
  readonly cityNodeByPlayer: Readonly<Record<PlayerId, ResourceNodeId | null>>;
}
```

- 未探索 = 该节点指示物为 `null`；不再单独保存可能不一致的 `explored: boolean`。
- 初始入场之前城市可为 `null`；进入正式行动阶段每个参与玩家必须恰好有一个有效位置。
- 城市位置只保存 `cityNodeByPlayer`，反向 `cityAtNode` 由服务器派生，避免双份位置相互矛盾。
- 指示物的种类和采集量由可信 markerDefinition 决定；冗余字段用于快照阅读时，服务器校验必须保证完全匹配，客户端不能创建任意采集量。
- 玩家标记同时用于棋盘、计分、城市样式等。markerId 是设计建议，供应数量由全局账本维护，BoardState 不独自假设玩家尚有 30 个标记可用。
- 回合、行动阶段及权威 `stateVersion` 放在 GameState；不要额外维护另一套会与对局版本不同步的棋盘回合或修订号。
- 不存区块控制者、城市占用表、节点邻接表、可选动作或路费缓存为权威事实，它们由定义和状态计算。

## 4. 两种连接检查

**城市移动：** 源节点和目标节点共同属于某个 `RouteDefinition.incidentNodeIds` 时，几何连接条件成立。指令必须指明所选 routeId；如果多个航道可连接同一对节点，不能替玩家猜选哪条，因为清除影响力的范围不同。其余资源费用、红区开放、城市占用、事件及末尾放置仍单独验证。

**探索/采集：** 从城市节点出发，在“节点—航道”关联图中寻找合法连接。连接中每个航道仅一个身份，不能将四端航道展开成六条分别收费的普通边。采集指令指定一组目标和连接航道集合；服务器验证所有目标在选定连接中可达，并按唯一 routeId 去重路费。节点是否已探索不会被自动当成通行障碍；对经过未探索节点等有疑义的案例应对照规则解释确认，不能添加未见禁令。

**部署/调度：** 无路径字段。部署选目标槽；调度选自己的源槽和目标槽，至多 2 次，逐次按当时状态验证。不根据上一步移动记录扩大或缩小地图距离。

客户端应展示路线及各笔收款人供玩家选择。客户端可给建议，最终路费和合法性必须由服务器重新计算。不能用通用 `ignoreRules` / `force` 绕过未实现规则。

## 5. 动态约束和结算次序

| 指令 | 地图前置检查 | 官方次序及影响 |
| --- | --- | --- |
| 部署 | 空槽；资源点已探索且无其他城市；自己供应有标记 | 从供应转移一个标记到槽 |
| 调度 | 源为自己的影响力；目标空；目标资源点已探索且无其他城市 | 逐次移动标记，至多两次；总量不变 |
| 探索 | 目标未探索且红区已开放；连接及路费有效；阶段和行动可用 | 支付路费 → 揭示对应事件/指示物 → 玩家选择并结算事件 → 放置影响力 |
| 城市移动 | 支付源石 3；源≠目标；所选单航道连接双方；目标无其他城市；红区开放 | 支付 → 移动城市及移除经过航道/目标点全部对手影响力 → 必要时揭示并结算事件 → 放置影响力；无路费 |
| 采集 | 目标有自己影响力或城市；连接正确；行动前余额能支付所选路费 | 按整次连接去重付费 → 各目标采集一次，按指示物采集量 |

事件可能包含尚未作出的选择，整个行动不能假装一步自动完成。设计建议：GameState 保存 PendingResolution（行动者、行动类型、阶段、已完成步骤、事件及允许的选择）；服务器逐步只接收当前阶段的合法选择。一个网络命令内部的状态更新保持原子性，多阶段行动则保存合法中间状态。事件结果无法继续末尾放置时的官方处理要按 p13 及规则解释核实，不能凭技术事务概念撤销已发生的官方步骤。

标记不足的具体判定时机属于规则审查阻塞项；清除影响力和事件奖励可能改变供应量，不能一概以整个行动开始前的供应量替代末尾实际可用量。

## 6. 区块统计

对每个玩家及每个区块：

`controlInfluence = 该区块全部资源点槽和航道槽中的玩家标记数 + 2 × 停在该区块资源点的该玩家城市数`。

拥有唯一最多影响力者获得该区块奖分；并列最多者均不得分。空区块没有获奖者。E/F 各 4，其余 3。R 只包含灰色航道，没有资源点，故城市不会落在 R 区。计算结果只在结算使用，不能作为“禁止其他玩家进入区块”的权限。

## 7. 数据和状态检查要求

正式编码时至少覆盖以下有效性检查；本轮只有文档清单检查，没有实现下列校验器。

1. 点/航道/槽 ID 唯一，引用存在且对象类型正确；每槽恰属一个对象；航道连接至少两个不同有效节点。
2. 两面点/槽/航道数及逐项连接应与地图分析一致；不只检查总数。地图关联图连通。
3. 初始点集合为绿色点；红区节点与照片及规则一致；区块分值逐项相符。
4. 状态覆盖定义的全部节点和槽，不含陌生键；指示物与可信定义匹配。
5. 一枚标记只能在一个位置；owner 与标记账本一致；所有用途的玩家标记合计守恒于 30。
6. 城市不得在航道或不存在的节点；正式行动中不同玩家不能同停一个点。
7. 普通放置不能在未探索点或其他城市处新增影响力；特殊效果逐项审查，禁止通用绕过开关。
8. 输入版本与服务器版本不符时不执行旧指令；重复 commandId 不重复扣费、抽事件或发奖。commandId/stateVersion 是联机工程约束而非官方规则。

建议后续行为测试：红区开放的前后回合；航道在红区关闭期间仍可用；自己的/对手/空航道路费；采集共用航道仅付一次；城市移动清除全部对手并归还标记；三端与四端航道移动；控制并列与城市 +2；调度远距离合法槽；事件中断后的续行。

## 8. 实现边界与下一步

已完成两面人工地图核验与模型设计。下一步建议审阅 ADR，随后将已核验地图逐项转为不可变数据和运行时 schema，并实现静态数据验证。正式行动引擎还需基础事件、角色及城市样式的可信定义和规则解释覆盖。未经确认不进行重大架构调整、部署或发布。
