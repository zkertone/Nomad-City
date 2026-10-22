# 基础版设施实体牌库与供应区 · 2026-10-22

## 规则依据与本次范围

规则书 20230803 p01 配件表与已确认数量清单共同确定基础版 48 张设施：41 普通、4 核心指挥塔、3 延伸枢纽。p02 要将核心指挥塔与延伸枢纽分开，其余 41 张洗混作为设施牌堆，翻开 6 张作为供应区；p03 每位玩家拿取 1 张核心指挥塔。p07 设施供应区取牌或移除后立即从牌堆补满 6 张。

另外核对 p23 两人变体：每回合角色盖放时，按起始玩家顺序选择供应区牌放回游戏盒并补回 **6 张**。该段与开局的 6 张一致。本轮仅让账本能够记录返回游戏盒的牌，未实现该轮流选择阶段；也未混入同页带 E 标的企业规则。

本轮已设计并实现：实体牌身份、只读库存定义、开局供应区与玩家核心牌分配、物理数量守恒、服务器内部补牌、公开视图。不实现建设、费用、唯一设施限制、摆放、入场效果或角色/样式。物理账本通过不代表某次建设合法，单张照片的费用/效果不会自动套用到其他颜色版本。

## 静态库存与运行时状态

`FOUNDERS_FACILITY_STOCK` / `stock.ts` 是静态定义。48 张各有唯一 ID，格式 `FC:<设施ID>:<颜色>:<两位复制序号>`。它们是项目 ID，不是官方牌号。每张只存 id、facilityId、color、group，不复制照片费用、分数或布局。18 种基础设施按用户分颜色数量展开，企业/感染者牌不参与生成。

库存引用数量目录 2.0.0 及其原固定摘要，不依赖视觉坐标。普通/核心/延伸三组分别 41/4/3，逐张对照数量展开结果，除了数量还核对实体 ID、所属设施、颜色和组别，拒绝篡改后重算自报摘要。

`FacilitySupplyState` / `supply.ts` 是独立的运行时设施账本，引用静态库存版本和摘要。每张实体牌必须且只能出现在一个位置：

| 位置 | 范围 | 初始数量 |
| --- | --- | ---: |
| drawPile | 普通设施，数组第一个为牌堆顶 | 35 |
| supply | 公开普通设施供应区 | 6 |
| extensionReserve | 尚余延伸枢纽 | 3 |
| unusedCoreTowers | 未分配的核心指挥塔 | 4 − 玩家数 |
| playerHoldings | 按玩家保存的实体牌归属，每位恰有 1 张核心指挥塔 | 玩家数 |
| returnedToBox | 已返回游戏盒的普通设施，与未分配核心分开 | 0 |

支持 2/3/4 玩家开局，但人数不写入库存定义。设施 ID、位置类别、玩家唯一性、每人核心牌、全部 48 张唯一使用、版本/摘要均在运行时校验。数组保存玩家归属，不使用玩家 ID 构造普通对象属性，因此 constructor/__proto__ 不会变成原型引用。

这是一份独立模块状态，**尚未嵌入 GameState**，也没有另存一份设施棋盘坐标或建设合法性。正式整合时须由 GameState 的权威调用方绑定 gameId、玩家集合和事务；现有 GameState 1.5.0/存档格式不变。不能把该账本的 parse/validate 当作游戏行动授权。

## 洗牌与初始化

```ts
import { randomInt } from 'node:crypto';
import { shuffleFoundersFacilityDeck, createFoundersFacilitySupply } from '@nomad-city-online/game-core/facilities';

// 在可信服务器侧产生随机顺序；玩家请求不得传入 deckOrder。
const deckOrder = shuffleFoundersFacilityDeck(upperExclusive => randomInt(upperExclusive));
const facilities = createFoundersFacilitySupply({
  gameId: 'private-game-1', playerIds: ['p1', 'p2', 'p3'], deckOrder,
});
```

洗牌采用 Fisher–Yates，由服务器注入无偏 randomBelow；运行时检查每个随机下标的安全整数与范围。纯模块不默认 Math.random，也不把库存排列当成已洗牌。初始化必须显式提供全部 41 张普通牌的完整排列，拒绝缺牌、重复、额外牌、核心牌或延伸枢纽进入牌堆。传入顺序会精确保留，便于测试和服务端重放。确定性随机源只用于重放/测试，不作为生产随机性保证。

## 补牌与公开视图

`replenishFacilitySupply(state, expectedRevision)` 是服务器内部补牌原语，只从牌堆顶部填补供应区缺口；不会从供应区拿牌，也不会把牌分给玩家、支付费用或结算入场效果。未来的合法建设/移除事务须先完成规则验证，并在入场效果前调用补牌。输入/输出独立且深度只读：

- 已满 6 张：unchanged，不抽牌、不增加 revision。
- 能补齐：replenished，按牌堆顺序补齐，revision 加 1，返回抽出牌 ID。
- 牌堆不足：insufficient-cards，报告所需/现有张数，保持输入位置不变。本次规则资料没有明确给出耗尽后的替代流程，不自行洗回、复制或部分补牌，也不宣称官方游戏应停止；交由未来规则确认和调用方处理。

校验允许供应区存在待补缺口，供内部事务中间位置使用，因此通过校验不表示已经完成立即补牌。测试直接调整物理位置来构造缺口，仅是账本测试夹具，不代表实现了合法建设。

`getFacilitySupplyPublicView` 按显式字段清单投影：公开供应区、预留牌、玩家归属、返回游戏盒牌和牌堆剩余数量；不返回隐藏的 drawPile 顺序。客户端网络请求/协议尚未实现，不能将整个服务器状态直接广播代替该视图。

## 摘要、进度与后续

静态库存格式 1.0.0，协议 `nco-facility-stock-c14n-v1`：排除顶层 contentHash；cards 按 id 的 JS 字符串顺序排序；对象键递归排序；其余数组顺序保留，无缩进 JSON、UTF-8、SHA-256，不做文本规范化。哈希包裹 `{hashProtocol, definition}`，覆盖定义 ID/版本、原数量目录引用、来源和全部实体牌字段。当前固定摘要：`sha256:fd2b5bdebaace746684ec0edb01571db6e2866fcaa718c62a57449bd747a4e58`。运行时隐藏牌堆顺序不写入此静态摘要，重放通过保存服务器状态实现。

`getFacilityInventoryReconciliation` 新增 readyForPhysicalSupplySetup=true；旧 readyForDeckSetup=false 仍表示完整可玩设施流程尚未实现。已生成实体牌库，不能继续将当前进度笼统写为“尚未生成实际设施牌库”。

实际测试结果见 [验证记录](testing/facility-supply-validation-2026-10-22.md)。待完成：接入权威对局事务、建设/摆放与费用、入场效果、两人角色阶段移牌、明确牌堆耗尽处理、角色/样式与整局编排。静态卡面/数量/地图/事件原数据及摘要、Accepted ADR、项目版本和依赖均未更改，无 UI、联机、部署或发布。
