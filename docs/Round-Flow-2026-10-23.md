# 角色盖放与两轮主要行动调度 · 2026-10-23

## 已设计：核对后的规则与范围

依据负责人提供的规则书20230803，实际读取印刷p03–05、p08、p10–11、p14、p23。PDF SHA-256：`6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42`。未将企业扩展p15–22或感染者规则混入基础版。

| 规则事实 | 来源 | 当前处理 |
| --- | --- | --- |
| 每人5张初始角色，手牌不被展示 | p03，名字对照p14 | 雷蛇、极境、德克萨斯、坎诺特、锡人；个人库存各一张 |
| 每回合从手牌选1张盖放；手牌为空时先回收弃牌 | p05/p11 | 顺时针盖放，库存逐张守恒，空手回收 |
| 两轮行动，都从本回合起始玩家开始顺时针进行，每轮每人一次主要行动 | p05 | 两次完整遍历，不是每人连做两次 |
| 快速行动在主要行动之前或之后进行，不能插进主要行动中间 | p05/p08 | 查询返回not-started/pending/complete；角色/样式执行尚未接入，相关命令拒绝 |
| 全体玩家结束两轮行动后才采集 | p05/p09 | 只有调度到采集，旧采集入口才能开启 |
| 采集后先结算延迟效果、复位样式，再传起始玩家、移回合 | p10 | 当前只支持无待结算角色/样式和7类设施；未知已建设施拒绝，不静默跳过效果 |
| 未使用的盖放角色回手 | p11 | 收尾时回手；没有假装执行并弃置角色 |
| 两人每回合盖放角色前，从起始玩家起依次各移除一张供应设施并立即补到6张 | p23 | 单独role-removal阶段，先完成两次移牌，再盖放任何角色 |
| 共8回合，然后分数结算 | p05/p10 | 第8回合收尾后停在finished；最终分数提交仍待实现 |

ROLE-01至ROLE-05是项目ID，不是官方印刷牌号。`FOUNDERS_BASE_ROLES` / `ROUND_RULE_SOURCE` 保存初始身份与来源，**roleEffectsImplemented=false**。本轮实现角色盖放/库存及调度，不实现策略、计谋、优惠、城市样式或特殊行动。

## 已实现：单一GameState 1.7.0

新增 `roundFlow`，包含roundNumber、stage、supplyRemovalCount、rolePlacementCount、turnIndex、majorActionOpened和每位玩家的hand/discarded/placed角色分区。角色身份按玩家+roleId区分，相同角色可以由不同玩家各自盖放。五张牌在每位玩家的区域中恰好出现一次。

原有余额、分数、棋盘、影响力供应、设施归属与面板仍各存一份，不复制经济状态。1.7.0必须有facilities和roundFlow；现有动作进度表示当前主要行动的执行状态，roundFlow只保存调度游标，不另存一份完成结果。1.0.0–1.6.0继续按原格式运行，不能删除roundFlow后冒充1.7.0，也不自动补造旧局轮次历史。

状态流：两人移牌（仅2人）→角色盖放→第一轮顺时针→第二轮顺时针→采集→已支持收尾→下一回合/第8回合结束。每名玩家当前轮次的主要行动完成后，仍需显式结束该行动轮，保留未来快速行动在主要行动之后执行的窗口。

`roundFlowIssues` 跨对象检查：精确玩家集合、5张角色守恒、盖放玩家前缀、两人移牌次数、阶段/游标对应、当前动作的玩家和回合、两轮上限及第8回合终点。原动作入口共享 `preparePhaseWindow` 的调度闸门，不能通过旧openDeploymentWindow/openExplorationWindow等绕开顺序或额外授权；所有动作保持1.7.0和roundFlow。

## API与调用

```ts
import {
  beginRoundFlow, applyRoundCommand, getRoundTurn,
  openHarvestPhase, applyHarvestCommand, finishManagedRound,
} from '@nomad-city-online/game-core/game';

// 可信初始化，只接受已完成真实入场、尚未开始任何普通行动的新局。
// facilityDeckOrder是服务器洗好的41张普通牌顺序，不能由玩家提交。
let state = beginRoundFlow(entryComplete, definition, {
  expectedVersion: entryComplete.stateVersion,
  facilityDeckOrder,
});

// 玩家命令的身份来自可信认证上下文；actor/回合/额度不取自payload。
state = applyRoundCommand(state, definition, { authenticatedPlayerId }, {
  type: 'place-round-role', gameId: state.gameId,
  expectedVersion: state.stateVersion, roleId: 'ROLE-01',
});
```

首次beginRoundFlow初始化1回合、事件牌堆、设施与每人5角色；显式服务器牌序必填，可给既有格式的确定性事件测试牌序。之后不得重启、替换牌序或收编未知历史旧存档。

| 命令/函数 | 使用时机 | 成功结果 |
| --- | --- | --- |
| remove-round-supply-card + cardId | 两人回合开始，当前移牌玩家 | 牌回盒、立即补牌、供应revision+1，轮到下一位；两次后进入盖放 |
| place-round-role + roleId | 当前盖放玩家 | 从手牌盖放1张；空手时先回收弃牌；全部盖放后开始第一轮 |
| choose-major-action + action | 当前玩家，主要行动未开始 | deploy/dispatch/explore/city-move/construct之一，开放既有动作窗口 |
| cancel-major-preparation | 当前玩家，动作仍为ready且执行步数0 | 仅撤销尚未执行的操作准备，仍是当前轮，重新选择主要行动 |
| finish-player-turn | 当前玩家，主要行动完整完成 | 清理该动作进度、游标+1；第二轮最后一人后开放采集 |
| openHarvestPhase | 可信阶段转换，且两轮已完成 | 复用现有采集计划/同时结算，不接受玩家选择回合 |
| finishManagedRound | 可信收尾，且所有采集计划已结算 | 未用角色回手、起始玩家顺时针传递、下一回合或finished |

主要行动窗口打开后，具体选择仍由既有applyConstructionCommand/applyExplorationCommand/applyCityMoveCommand/applyInfluenceCommand执行。报价、失败输入不结束当前轮。已经完整完成的主要行动不能撤销；调度已移动一步即使仍处于ready，也不能撤销；探索抽牌/收费后不能撤销；不退款、不回滚已知信息、不补回已消耗次数。

撤回准备是技术层面的选择修正，不是新增桌游行动、跳过主要行动或已执行行动的悔棋。它只清除尚无实际操作的动作进度，玩家仍必须完成一个主要行动才能结束本轮。实现避免“先选建设但付不起费用”永久锁死操作的情况。

每个成功的调度命令或阶段转换全局stateVersion+1；错误不改输入和任何账本。旧命令拒绝、错误玩家拒绝、额外actor/round/优惠/额度字段拒绝。未来服务器仍须串行比较/提交版本，纯函数不提供跨进程CAS。

## 角色与能力边界

目前所有盖放角色保持未使用状态：没有可执行的翻牌、策略、计谋或样式命令，不能通过伪造roleEffectResolved表示已结算。弃牌分区和空手回收已按规则实现并用库存夹具验证，但本轮没有宣称已实现产生弃牌的角色效果执行。

现有7类普通原价建设能力不变。1.7.0拒绝包含未支持的已建设施，防止联邦理事处等延迟效果在收尾被略过；未支持的牌可以存在供应和暗牌堆中，不能据此建设。尚无城市样式状态，不执行或复位虚构样式。角色与样式完整接入后才能扩展这些边界。普通原价建设不是角色优惠或“免费”来源的替代。

第8回合finished表示拓荒回合已结束，尚未提交最终分数；不把已有只读分数预览改为自动加分。没有UI、3D、网络、数据库、部署或对外发布；Accepted ADR、技术栈和单一权威状态结构不变。

## 公开投影

`getRoundPublicView(state,definition,viewerPlayerId)` 是角色与供应区的局部公开投影，viewerPlayerId必须来自未来认证层。包含回合/阶段/当前行动玩家、顺序、角色数量、公开弃牌、自己手牌和盖放牌；其他玩家只有手牌数和是否盖放，不能看到手牌或盖放身份。供应复用现有公开投影，不泄露暗牌序。它不是完整整局公开状态，也不应将原GameState广播给客户端。

实际测试与早期错误见 [验证记录](testing/round-flow-validation-2026-10-23.md)。
