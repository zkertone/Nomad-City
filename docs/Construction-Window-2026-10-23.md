# 建设行动窗口与权威快照 · 2026-10-23

## 已设计与规则依据

沿用现有探索、城市移动、部署/调度、采集的纯状态转换方式，将此前7类、15张匹配已拍颜色实体牌的内部建设结算接入 GameState。规则书20230803印刷p07已再次读取：支付资源组合或金券、拿取供应设施并立即补齐6张、放在自己面板任意空位、获得印刷分数、结算入场效果；唯一设施限制仍按自己的同名设施判断。原图、文字、费用、颜色数量和固定摘要不变。

可信调用方授予**一次普通原价建设**；命令成功消耗一次窗口，失败保留窗口。角色选择、行动顺序、两轮主要行动及角色优惠尚未实现，调用方不得把需要特殊价格/权限的行动当作普通原价建设。玩家不能自行调用授予接口。这与现有单行动窗口的权限边界一致，没有宣称已实现完整回合调度或认证服务。

## 已实现：GameState 1.6.0

| 权威字段 | 内容 |
| --- | --- |
| 原 players / board / markerSupplyByPlayer | 余额、分数、棋盘及标记唯一账本，原位置不变 |
| facilities.supply | 已有供应账本：48张守恒、实体归属、牌序和revision |
| facilities.panels | 已有玩家面板：实体cardId与cellId、revision |
| construction | actorId、roundNumber、ready/complete、constructionsCompleted（0或1）、builtCardId |

**不保存第二份 GamePosition 或余额**，内部结算工作视图只在函数调用中存在。供应账本保存牌属于谁，面板保存牌在哪格；两者严格交叉核对。ready必须次数0且builtCardId=null；complete必须次数1且所建支持的普通实体牌位于授予玩家面板。

1.6.0 必须包含 facilities，并允许现有各非入场阶段或 construction；每次只能有对应阶段的一个进度对象。已有1.0.0–1.5.0格式继续按原规则读取，不自动添加设施、不推断旧局中未保存的建造历史。GameDefinition仍1.0.0。新增格式是既有模块的增量接入，Accepted ADR-0001内容和架构决策未修改。

设施会在探索、移动、部署、调度、采集之间保留，格式保持1.6.0，不能静默降级丢失设施。每次parseGameState，即使当前不是建设阶段，也检查设施库存/面板/玩家/对局/引用、已建颜色和唯一性。

## 可信初始化与授予

```ts
import {
  openConstructionWindow, shuffleFoundersFacilityDeck,
} from '@nomad-city-online/game-core';
import { randomInt } from 'node:crypto';

// 仅供可信服务器创建已知尚未分配设施的新局/开发局；state已完成入场或当前行动。
// rng必须来自服务器，不接受玩家发送牌序。
const rng = () => randomInt(0x100000000) / 0x100000000;
const granted = openConstructionWindow(state, definition, {
  actorId: authenticatedPlayerId,
  expectedVersion: state.stateVersion,
  roundNumber: 1,
  facilityDeckOrder: shuffleFoundersFacilityDeck(rng),
});
```

首次必须显式给完整41张普通牌的合法排列，分配核心、供应6/暗牌35；这不是历史旧存档恢复工具。事件牌初始化继续沿用现有phase准备逻辑。首次设施初始化可以出现在已完成的旧格式行动后，不重置已经存在的事件牌堆、棋盘或余额。初始化和授予共同返回一个新快照，任一步失败不发布半成品。

后续授予只给actorId/roundNumber/expectedVersion，**不能再次传facilityDeckOrder**。未完成入场、其他行动或采集时不能授予；不能回退回合、同回合重新打开已完成采集后的行动或重置事件牌堆；满面板不能开启建设。这些仍不是完整角色/回合调度校验。

## 玩家选择与原子提交

```ts
import { getConstructionQuote, applyConstructionCommand } from '@nomad-city-online/game-core/game';

const context = { authenticatedPlayerId }; // 来自未来可信认证适配器，不能取自玩家payload
const command = {
  type: 'construct-facility' as const,
  gameId: granted.gameId,
  expectedVersion: granted.stateVersion,
  cardId: selectedCardId,
  cellId: 'CP-1-1',
  paymentMode: 'vouchers' as const,
};
const quote = getConstructionQuote(granted, definition, context, command);
const next = applyConstructionCommand(granted, definition, context, command);
```

开采电铲还须给entryChoice={kind:'resource-allocation',gains:{orirock,originium,iron}}，三个整数0..5且合计5。其余支持设施不接受此选择。选择不能携带actor、价格、免费、优惠、得分、剩余次数、牌序或内层revision覆盖。

命令校验顺序：快照→strict请求→对局→全局版本→未用窗口→可信身份→内部建设规则。内部actor与供应/面板revision从当前快照生成，不由客户端提供。报价不改状态、不消耗窗口；正式执行重新计算，不信任旧报价或客户端金额。

成功时一次返回：扣费/补牌/摆放/得分/入场后的原权威账本、供应revision+1、操作者面板revision+1、窗口complete/次数1、全局stateVersion+1。其他玩家、事件牌堆、棋盘和标记不因建设改变；若入场效果涉及它们，则仍属于本轮不支持范围。重复旧请求报STALE_VERSION，更新版本后再请求同一已完成窗口报ACTION_STAGE。下一次建设必须由可信调用方另行授权。

任何规则、费用、选项、颜色、唯一性、版本、整型溢出或补牌能力错误，都不扣费、不移动实体、不消耗窗口，输入保持原样。当前7类及颜色白名单与上轮相同，没有扩大规则范围；其余复杂效果、未拍颜色及耗尽补牌依旧明确拒绝。

纯函数的版本检查只保证以**当前权威快照**调用时拒绝旧命令。未来服务器必须在同一串行执行器/存储事务中比较并提交expectedVersion；用同一个旧对象在两个独立进程调用并不构成跨进程防重。本轮没有数据库CAS、网络路由、身份认证服务或客户端公开快照。GameState含暗牌序，不能直接广播；现有供应公开投影仍可查询，整局按玩家裁剪的公开视图待实现。

## 验证与待完成

运行 `npm run verify`、`npm run check:construction` 和现有相关编译检查；本轮真实命令、错误修正和结果见 [验证记录](testing/construction-window-validation-2026-10-23.md)。

已设计/已实现：一次授权建设窗口、正式玩家命令边界、严格版本与身份校验、原子状态替换、设施/面板接入及跨行动保留、1.6.0序列化验证。已测试范围以验证记录为准。

待完成：角色与两次主要行动的整局额度/顺序、角色优惠/免费来源、复杂和嵌套入场、物流延伸、未拍颜色、城市样式、两人角色阶段移牌、官方牌堆耗尽处理、公开整局投影、服务器串行提交、UI/3D/联机。没有新增依赖、更换技术栈、修改官方规则、部署或对外发布。


## 同日后续：受管回合1.7.0

[角色盖放与两轮主要行动调度](Round-Flow-2026-10-23.md) 已接入现有建设窗口。1.7.0时只能由当前行动玩家、当前回合、未用主要行动轮开启建设，成功/失败/结束轮次受调度约束，不能用旧接口多开一次窗口；动作与设施保持1.7.0。1.6.0的独立可信授权方式作为旧格式继续支持。

此前“角色顺序/两轮额度待完成”现细分：盖放、轮次/额度和采集前后顺序已实现；角色使用/策略/计谋、优惠与样式、复杂/延迟效果仍待完成。新的调度不授予优惠或免费建设；当前7类普通原价能力未扩大。
