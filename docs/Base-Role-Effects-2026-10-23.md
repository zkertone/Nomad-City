# 基础角色效果：首批五种完整模式 · 2026-10-23

## 已设计与实际核对

实际读取用户规则书20230803印刷p08/p11/p13/p14，并将p14角色卡渲染至6000像素宽后逐张查看原卡及说明。PDF实测SHA-256：`6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42`。未将企业/感染者角色或未确认文字写成生产规则。

本轮覆盖**4名角色的5种模式**。模式是策略或计谋；起始玩家可以按策略→计谋顺序使用两种，其他玩家只能选其中一种。每回合只能使用本回合盖放的角色一次，快速行动只能在自己的主要行动之前或完整结束之后使用，不能插入进行中的动作。

| 角色/项目ID | 已实现模式 | 原卡数值及选择 | 未实现 |
| --- | --- | --- | --- |
| 雷蛇 ROLE-01 | 无 | 未执行占位效果 | 策略的放置/延迟移除、计谋替换 |
| 极境 ROLE-02 | 策略 | 在当前数量最少的源岩/源石/异铁中选择一种，获得4个；并列最少可自行选 | 计谋的付费与免费城市移动 |
| 德克萨斯 ROLE-03 | 策略 | 获得12金券；选择1张供应设施置于牌堆底部，立即补牌至6张 | 计谋的付费、放置与两次移动 |
| 坎诺特 ROLE-04 | 策略 | 任意数量出售：源岩3、源石3、异铁4、至纯源石15金券；各类可选择不卖 | 计谋的全体玩家选择/出售结算 |
| 锡人 ROLE-05 | 策略、计谋 | 策略：获得1分，或依次决定是否支付12/15金券，各获得1至纯源石；计谋：回收原弃牌区的牌，每张选择5金券或移动1影响力 | 无待补的这两种模式；完整角色系统仍未齐备 |

p14明确：德克萨斯可在设施牌堆为空时使用策略，置底的牌会被立即翻回供应区；不能套用普通建设对耗尽补牌的拒绝。锡人计谋结算时，当前锡人尚未进入弃牌区，回收数量**不包括本张锡人**。奖励移动是一次移动，不是一次完整调度（两次移动）。

## 已实现：显式GameState 1.8.0

新增 `enableBaseRoleEffects(state,definition,{expectedVersion})`，仅将已验证的1.7.0状态显式升级为1.8.0，为每位玩家添加used=null；原阶段、角色牌区、行动进度、设施、余额、顺序等全部保留。升级本身全局版本+1。不自动重启对局或重置回合，也不接管更旧未知轮次的存档。

beginRoundFlow仍默认产生原1.7.0状态以兼容旧入口；准备使用角色效果时由可信调用方升级一次。再次升级、错误版本或更旧格式明确拒绝。1.0.0–1.7.0原行为保留；1.8.0在所有动作/采集/收尾转换中保持，不降级丢失使用记录。

每位玩家的hand/discarded/placed依旧是五张角色的唯一物理分区。新增used是对弃牌中角色的本回合使用引用，内容为roleId/mode/turnIndex，**不是第六张牌或另一个牌区**。成功使用后置placed=null、当前牌进入discarded并记录used；其他玩家未使用的盖放牌仍隐藏。校验检查已使用牌确在本人弃牌、没有同时未用盖放牌、使用属于已到达的本人行动轮次、模式已支持、both仅属于本回合起始玩家。

收尾仅让未使用的盖放牌回手；已使用牌保留在弃牌区，used清为null供下回合使用。盖放阶段的空手回收继续使用真实弃牌库存。锡人可在后续回合回收此前真正使用过的角色，已通过连续两回合流程验证。

## 玩家API与顺序

```ts
import {
  enableBaseRoleEffects, applyBaseRoleCommand, getBaseRoleEffectSupport,
} from '@nomad-city-online/game-core/game';

// 对1.7.0只做一次可信升级；其后按原调度完成角色盖放。
const enabled = enableBaseRoleEffects(state, definition, { expectedVersion: state.stateVersion });

// 此例须在该玩家已经盖放极境、轮到本人且主要行动未开始/已完成时调用。
const next = applyBaseRoleCommand(current, definition, { authenticatedPlayerId }, {
  type: 'use-base-role', gameId: current.gameId,
  expectedVersion: current.stateVersion,
  roleId: 'ROLE-02', mode: 'strategy',
  strategyChoice: { kind: 'minimum-resource', asset: 'iron' },
});
```

roleId只是对自己盖放牌的选择，服务器必须核对，不允许选择手牌、其他玩家或弃牌中的另一角色。身份来自可信上下文，客户端不能覆盖actor、轮次、价格、得分、执行结果或额度。当前本回合起始玩家由轮转后的playerOrder[0]判断，不使用最初座位0硬编码。

| 模式 | 选择数据 |
| --- | --- |
| 极境策略 | strategyChoice={kind:'minimum-resource',asset:'orirock'/'originium'/'iron'} |
| 德克萨斯策略 | strategyChoice={kind:'cycle-facility',cardId:当前供应实体ID} |
| 坎诺特策略 | strategyChoice={kind:'sell-resources',amounts:{orirock,originium,iron,'pure-originium'}}；四个非负安全整数 |
| 锡人策略得分分支 | strategyChoice={kind:'tin-point'} |
| 锡人策略购买分支 | strategyChoice={kind:'tin-purchases',payFirst:boolean,paySecond:boolean}，两项条件分别明确决定 |
| 锡人计谋 | schemeChoice={kind:'recover-roles',rewards:[...]}；每张原弃牌选择一次奖励 |

每项rewards是 `{roleId,kind:'vouchers'}` 或 `{roleId,kind:'move-influence',sourceSlotId,targetSlotId}`。必须恰好覆盖本人原弃牌，不得漏张、重复或包含当前锡人；数组顺序就是奖励执行顺序。移动复用原有逻辑槽位规则，来源是本人现有棋盘标记，目标是合法空位；移动同一枚标记而不取新标记、不收路费、不增加主要行动。后续移动必须从前一次结果选择来源。无合法目标的移动选择会拒绝整个命令，输入不变，须改成可执行选择；没有实现“虚假移动成功”的占位结果。

mode='both'必须两种模式都有完整handler，只有锡人当前满足此能力。服务器先完整执行策略，才执行计谋；不能用稍后计谋奖励的钱垫付较早购买。当前卡在两种效果完成之后才进入弃牌区并记录一次使用。mode='strategy'不能附带schemeChoice，反之亦然；双方选项齐备且合法才提交。

已打开但未执行的主要行动准备也属于pending窗口，须先用既有cancel-major-preparation取消准备，才能在主要行动之前使用角色。动作开始后（事件已抽出、调度一步等）不能通过此方式插入快速行动；主要行动完全结束、尚未finish-player-turn时可使用角色。角色效果不授予新的主要行动次数。

## 原子性与能力边界

一次完整角色使用只返回一个新权威GameState，全局版本+1。费用、资源/分数、市场置底与补牌、回收、移动和弃牌/used同时提交；错误/溢出不留下中间金券或恢复的牌，也不弃置角色。德克萨斯供应revision+1，其他模式不凭空改供应/面板revision。重复旧请求拒绝，更新版本再使用同回合角色也拒绝。

使用前检查所请求的**所有**模式是否支持。雷蛇、极境/德克萨斯/坎诺特计谋以及包含这些缺失模式的both会在执行任何效果前拒绝。1.8.0也拒绝伪造这些模式的used记录，不能令收尾略过未实现的延迟效果。原7类普通原价建设范围不扩大，角色效果不代表获得建设折扣。

`getBaseRoleEffectSupport`给出逐角色/逐模式明细、supportedModeCount=5和allBaseRoleEffectsImplemented=false。旧ROUND_RULE_SOURCE.roleEffectsImplemented仍为false，表示全部角色效果尚未齐备，当前部分实现应以新能力明细为准。

公开投影只在成功结算后公开used引用和弃牌，未用对手盖放身份及手牌不展示；原状态含暗牌不能广播。未来服务器仍须串行比较并提交expectedVersion，纯函数没有跨进程CAS、认证或网络服务。

## 验证与待完成

真实命令、早期编译检查夹具错误和最终结果见 [验证记录](testing/role-effects-validation-2026-10-23.md)。

已设计/已实现：首批五模式、1.8.0显式升级、主要行动前后使用、起始玩家两模式顺序、角色一次使用/弃牌/真实回收、严格目标和支付、原子失败、局部公开投影更新。已测试范围以记录为准。

待完成：雷蛇两模式、极境/德克萨斯/坎诺特计谋、嵌套/多玩家与延迟效果、城市样式/特殊行动、其他设施和未拍颜色、普通耗尽处理、最终计分、完整公开对局投影及服务器持久化/联机。Accepted ADR、技术栈、GameDefinition、原静态JSON与摘要、项目版本和依赖不变；无UI/3D、部署或对外发布。


## 同日后续：雷蛇已接入，当前七模式

[雷蛇两种效果与收尾](Liskarm-Effects-2026-10-23.md) 新增策略和计谋，当前 `supportedModeCount=7`；上文五模式及雷蛇未支持的描述保留为首批实现历史。旧1.8.0仍拒绝雷蛇使用及其used记录，须显式 `enableLiskarmEffects` 升级至1.9.0，不静默修改旧存档。雷蛇和锡人现在都可由起始玩家使用both；其他三名角色的计谋及包含这些计谋的both仍拒绝，allBaseRoleEffectsImplemented仍false。

雷蛇策略选择为 `{kind:'liskarm-place',slotIds:[...]}`，逐次尽量执行两次，不能主动少选可执行目标；计谋为 `{kind:'liskarm-replace',costDecision:'pay'|'decline',slotId?:SlotId}`，支付3金券后先移除再尝试同槽放置。策略/both还记录 `cleanupResolved=false`；收尾依本人当前实际棋盘标记选择移除1枚，不限定刚放置的标记。详细不可执行跳过、库存和对手城市规则见新文档。

真实1488/1488、strict/构建和15项编译检查通过；原五模式90项测试保留，只更新能力和格式断言。验证及首次测试辅助类型错误见 [新增验证记录](testing/liskarm-validation-2026-10-23.md)。


## 同日后续：五张基础初始角色的十种模式已齐备

[剩余三种计谋](Remaining-Role-Schemes-2026-10-23.md) 已实现极境免费移城、德克萨斯顺序影响力操作和坎诺特全体强制出售/本人1分。当前supportedModeCount=10、allBaseRoleEffectsImplemented=true，ROUND_RULE_SOURCE.roleEffectsImplemented也更新为true；含义严格限定5张初始基础角色，不表示城市样式、设施或完整桌游已完成。上文五/七模式及完成标志false仅为历史进度。

显式enableRemainingBaseRoleEffects从1.9.0升级1.10.0；旧1.8.0/1.9.0仍不允许这三种计谋或相关used记录。所有5张角色现在均允许起始玩家both，仍先策略后计谋、失败整次回滚。新格式支持在主要行动完成后结清旧动作进度，保存completedMajorAction而不增加额度，避免第二次移城与旧城市目标校验冲突。具体选择格式、不可执行跳过、所有玩家强制出售及边界见新文档。

实际1558/1558、strict/构建和16项编译检查全部通过；既有90项原角色测试保留，只更新能力元数据和旧格式拒绝理由。详见 [验证记录](testing/remaining-role-schemes-validation-2026-10-23.md)。
