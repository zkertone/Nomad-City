# 玩家建造面板与位置校验 · 2026-10-23

## 已核对的面板结构

负责人提供 image(5).png 并明确这是玩家建造面板。照片竖向正放时，建造区为 **3 列 × 4 行，共12格**，核心指挥塔位于从上数第3行、中间列；开局占1格，剩11空格。右侧“企业家”记录格与至纯源石存放处属于其他区域，不计为建设位置。该布局与规则书 p03 的起始位置图对照一致。

| 从上数 | 左列 | 中列 | 右列 |
| --- | --- | --- | --- |
| 第1行 | CP-1-1 | CP-1-2 | CP-1-3 |
| 第2行 | CP-2-1 | CP-2-2 | CP-2-3 |
| 第3行 | CP-3-1 | **CP-3-2 核心指挥塔** | CP-3-3 |
| 第4行 | CP-4-1 | CP-4-2 | CP-4-3 |

CP ID 是项目逻辑格号，不是官方牌号。数据 row/column 使用从0开始的逻辑行列，因此初始核心是 row=2、column=1。这些逻辑行列依据真实面板格位定义，不是图片像素、Three.js 坐标，也不用于大地图航道、路费或移动距离。

规则书 p07：建设时将一张设施牌放到自己城市面板的任意空位。**没有加入“必须连接已有设施”的要求**。格位与一张设施牌的对应来自面板及规则，不由用户曾提供的红3/蓝3等实体数量推导。p07 费用、摆放得分与入场效果为不同步骤，位置可用不等于完整建设合法。p09 的样式宣告另有旋转/不能翻转等约束，本轮不实现样式匹配。

## 来源与规范化摘要

| 来源 | 身份 | SHA-256 |
| --- | --- | --- |
| image(5).png | libfile_18a07e3ee5a08191ac872b03436808ca | fcc7a3d215e414dd06bddeccd969325071e49124906fdc431d0fe656877b8d0f |
| 规则书20230803，印刷p03/p07/p09 | 用户已提供规则书 | 6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42 |

原图已实际读取并计算摘要，没有改写原图或将其用作线上游戏美术。JSON 保存来源身份与摘要，不提交整张原版图片。

`founders-player-panel.json` / `FacilityPanelDefinition` 保存12格、行列、初始核心格和来源。格式1.0.0、协议 `nco-player-panel-c14n-v1`：排除顶层 contentHash；cells 和 sources 按 id 的 JS 字符串顺序排序；对象键递归按 JS 字符串顺序排序；其余数组（如印刷页码）保持原序；无缩进 JSON、UTF-8、SHA-256，无 Unicode/空白/标点规范化。哈希包裹 `{hashProtocol, definition}`，覆盖其余所有字段和来源。

固定摘要 `sha256:138c13fd41068830138c5111c3212b3a9f3bf2fda30dd12835e9166f6bdef904`。除了固定摘要，还检查格号/逻辑位置一致、ID/位置唯一、初始格引用有效、来源ID唯一及严格字段；改数据后重算自报摘要仍拒绝。

## 已实现的状态与交叉校验

`FacilityPanelState` 保存 gameId、playerId、revision、panelRef 和 placements；每项 placement 只有 cellId/cardId。空位、十字邻接、颜色和设施类型通过查询派生，不重复存储。设施供应账本保存实体牌归属，面板只保存该实体牌的位置，两者必须严格对应：

- 面板只能使用该玩家已拥有的实体牌，拒绝未知牌、别人的牌和其他区域的牌。
- 每张归属牌有且只有一个格位；同一格不能有两张牌，同一牌不能占两格。
- 本模块保持核心指挥塔的已知初始位置，没有提供移动核心的操作。
- panelRef、对局ID、玩家存在性和安全整数revision均校验；完整面板集合须恰好覆盖供应账本的所有玩家。

`createInitialFacilityPanels(supply)` 根据2/3/4人初始库存给每人建立面板，将各自核心牌放在 CP-3-2。不接受已经分配额外设施、移牌或推进版本的库存来重置面板。

```ts
import {
  createInitialFacilityPanels, getEmptyFacilityPanelCells,
  previewFacilityPanelPlacement,
} from '@nomad-city-online/game-core/facilities';

// supply 由可信服务器初始化，示例省略现有洗牌/设施供应创建过程。
const panels = createInitialFacilityPanels(supply);
const firstPanel = panels[0]!;
const emptyCells = getEmptyFacilityPanelCells(firstPanel, supply); // 11格
const preview = previewFacilityPanelPlacement(firstPanel, supply, {
  actorId: firstPanel.playerId,
  cardId: supply.supply[0]!, cellId: 'CP-1-1',
  expectedPanelRevision: firstPanel.revision,
  expectedSupplyRevision: supply.revision,
});
```

## 十字相邻与位置预检

`getFacilityPanelOrthogonalNeighbors` / `areFacilityPanelCellsAdjacent` 只返回共享一条边的面板格，排除斜角、自身、跨行绕边与远处位置。初始核心邻格是 CP-2-2、CP-3-1、CP-3-3、CP-4-2。

`getOrthogonallyAdjacentPanelFacilities(panel,supply,cellId)` 返回邻格中的实体牌及从库存派生的颜色/设施ID，可供城市化区域或附属能源设施等后续效果查询；不自行发放金券或触发邻居效果。

`previewFacilityPanelPlacement` 检查当前面板与归属、操作者、面板/供应revision、目标空位及候选牌是否在公开供应区或延伸预留中。结果只有 position-available / position-unavailable，不返回“允许建设”，也不提供变更后的权威状态。预留延伸枢纽的位置可用仍不等于获得物流枢纽的建造授权。

预检没有扣费、拿牌、补牌、加分、改变位置或执行入场效果；不能由未来网络层把结果直接当作建设命令成功。未来完整建设事务要验证费用、唯一限制、牌源授权、行动窗口，并原子更新供应归属与格位，禁止发布两者暂时不一致的中间位置。本轮没有将该独立模块接入 GameState，原存档格式和现有行动规则保持不变。

## 已测试与待完成

真实命令与结果见 [验证记录](testing/player-panel-validation-2026-10-23.md)。测试中的多设施摆放通过直接构造物理账本/面板夹具完成，仅证明位置与归属校验，不当成已实现合法建设。

已设计/已实现：面板定义及摘要、独立状态、初始核心分配、12格边界、归属/位置交叉校验、十字邻接和只读位置预检。待完成：接入权威对局事务、完整建设执行与扣费、唯一设施规则、得分/入场效果、城市样式匹配、两人角色阶段及整局编排。没有 UI、3D、联机、部署或对外发布，也未修改 Accepted ADR 或引入新依赖。


后续已接入 [7类基础建设内部事务](Facility-Construction-2026-10-23.md)：支持范围内的支付、拿牌/补牌、格位/得分和入场按顺序原子返回；该事务并未把本页只读预检改成建设授权，也未完成正式行动窗口或全部设施效果。
