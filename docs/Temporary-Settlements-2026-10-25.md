# 临时聚居点：项目基础版设施

本批沿用负责人2026-10-24确认的玩法依赖归类：临时聚居点属于项目基础版，实体发行来源仍为《感染者》O。已在基础2/3/4人中实现完整建设、用于宣告样式、可选退回、保存恢复与后续建设；不启用其他企业或企业家内容。

## 原始依据

原卡面：`image(1).png`，Library身份`libfile_35a1fb9b4b208191be898939b83995df`，SHA-256 `5a9566cc41f0db71732dbbe5bccfa7808502a26415cde78643ae8359197dca84`，第一排第二张。本轮再次读取原图及效果区放大，未将照片或临时检查图上传仓库。

| 字段 | 核对结果 |
| --- | --- |
| 身份、颜色、数量 | FAC-017、虹色、3张；数量沿用原混合清单 |
| 印刷分数 | 0分 |
| 资源造价 | 1源石＋2异铁 |
| 替代造价 | 11金券，与资源方案二选一 |
| 标识 | 唯一，无入场效果 |
| 宣告后效果 | 使用该设施宣告城市样式后，可将此牌从城市面板放回游戏盒，获得12金券 |

唯一限制沿用现有规则：同一玩家同时只能拥有一张同名设施。牌退回后可正常建设另一张实体复制牌；已经回盒的牌不洗回供应。未退回的牌仍永久已用，不能在下一次宣告中重复使用，不能事后作为一般出售行动领取12金券。风味小字未转录，明确保留unreadable状态，不影响已核对的执行效果。

## 库存与旧接口

原`FOUNDERS_FACILITY_STOCK`、原始混合数量JSON、18张基础卡面目录及固定摘要全部保留。新增`PROJECT_BASE_FACILITY_STOCK`为19类51张：普通17类44张、延伸3张、核心4张；旧48张库存继续用于旧局。

| 入口 | 范围 |
| --- | --- |
| getFoundersPhysicalFacilityCard / getFoundersFacilityFace | 原48张实体/18类卡面，继续排除FAC-017 |
| getFacilityPhysicalCard / getFacilityExecutionFace | 执行用项目基础范围，包含临时聚居点；查询本身不授予使用权限 |
| getFacilityConstructionSupport() | 旧普通16类41张 |
| getFacilityConstructionSupport(true) | 项目基础普通17类44张 |

新库存固定摘要：`sha256:5cafd7d5d504f5efc6662448cccf45ade8c0f9f73dabd3a96b6f2471aef4eedb`。新卡面/来源固定摘要：`sha256:e4792b1f47d2931e2214a5ab0e7f9fe0fab47ef45945e6a12cc82f520b3c2d04`。新旧摘要独立校验，不通过重写旧基准让新卡混入旧局。

## 可信新局初始化

`enableTemporarySettlements`只接受尚未进行任何角色盖放、两人移牌、建设或样式宣告的已显式初始化1.15.0新局，生成1.16.0。服务器必须提供44张普通牌的完整牌序；任何缺牌、重牌、企业卡、旧局中途初始化或重复初始化都会拒绝。此步骤不用于把3张新牌补进已在玩的旧存档。

```typescript
import { randomInt } from 'node:crypto';
import { shuffleFoundersFacilityDeck, enableTemporarySettlements } from '@nomad-city-online/game-core';

// state已完成真实入场及既有能力初始化，且第一回合尚未作任何角色/供应选择。
const next = enableTemporarySettlements(state, definition, {
  expectedVersion: state.stateVersion,
  deckOrder: shuffleFoundersFacilityDeck(randomInt, true),
});
```

新局供应仍6张，暗牌38张。数量与摆放由同一库存和面板校验；普通建设、牌堆建设和设施嵌套建设共用已有费用/唯一检查；新兴建筑群的非虹色限制继续排除临时聚居点。纯查询或内部结算函数不代替服务端认证、调度和原子持久化。

## 宣告选择与恢复

`declare-city-pattern`新增可选`returnTemporaryFacilityIds`，最多1张，必须是本次合法图案实际使用、仍在本人面板上的临时聚居点。省略或空数组表示保留该牌。旧快照明确拒绝这个新选项。

```typescript
{ type: 'declare-city-pattern', gameId, expectedVersion, patternId,
  facilityCardIds, returnTemporaryFacilityIds: ['FC:FAC-017:rainbow:01'] }
```

完整宣告后，在同次状态提交中移除实体归属与格位、放回现有returnedToBox分区、获得12金券并记录原宣告者；不抽牌、不补公开供应、不返还样式次数、不增加主要行动。错误身份、目标、图案、版本、余额溢出或设施revision溢出均不返回中间状态。

1.16.0新增`temporarySettlementReturns`，最多记录3张真实实体的宣告者，不重复保存资源或位置。永久已用清单保留历史，已回盒牌不会再参与匹配。

新兴建筑群先完成宣告/可选退回，再授予正常付费的非虹色建设；12金券此时已实际入账。`declarationFacilityPlacements`保留该次实际宣告格位，在临时牌离场及释放位置被后续建设占用时仍可核对，支持嵌套入场中途保存。仅真实回盒的临时牌可作为离场证据，其他已用设施仍须在原位，证据图案及实体集合仍需完整匹配。

## 验收与边界

运行`npm run verify`和`npm run check:temporary-settlements`；本批与原全部编译检查的实际结果见[验证记录](testing/temporary-settlements-validation-2026-10-25.md)。原1.0.0–1.15.0路径保持能力和库存含义。本批不处理普通牌堆耗尽的未确认规则、不实现正式终局提交或完整三档配置，无UI、联机或部署。
