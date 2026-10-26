# 整局视图与玩家接口约定 · 2026-10-26

基于main `ec567b8827b8a839ba9201f82ccca432436bb05b`，沿用服务器权威、单一GameState、Accepted ADR-0001及原游戏规则。本批是独立规则包的读写适配层，项目版本仍为0.2.0，未新增GameState格式。`viewVersion`及`apiVersion`各为1.0.0，与存档格式1.0.0–1.17.0分别版本化。

## 可见性及数据范围

| 权威数据 | 公开视图 | 本人私有视图／服务端 |
| --- | --- | --- |
| 玩家、颜色、余额、分数 | 实际值 | 同一事实，不另设经济账本 |
| 地图、资源标记、城市、影响力 | 已揭示资源及占用者、稳定点／槽ID | 供应中标记实体ID仅本人可见 |
| 角色 | 手牌数量、是否盖放、已公开弃牌与已使用角色 | 本人手牌与盖放身份；对手未用盖放牌不公开 |
| 设施 | 供应、延伸预备、归盒／未用核心、持有与面板位置、暗牌数量 | 普通暗牌序列始终留在服务端 |
| 城市样式 | 实际6张公开样式、设施耗用、轨道、使用及标记归属 | 本人的样式标记实体ID用于提交选择 |
| 进行中行动 | 当前玩家、阶段、已揭示事件、普通／嵌套行动进度、样式额外行动 | 不从进度推导额外权限；命令重新验证 |
| 事件牌堆 | 已初始化牌堆的剩余数量、当前已揭示事件 | 剩余牌身份与顺序不广播；入场前未知数量返回null |
| 采集 | 轮数、阶段和已提交玩家 | 本人方案返回本人；其他玩家方案留在服务端 |
| 样式搜牌 | 公共视图仅显示续接种类与状态 | 仅当前有权操作者可看可支付候选，按卡ID和支付方式排序，移除原牌堆顺序 |
| 终局 | 同一个正式结果及总分／资源／区块明细 | 不发送计分前收据或完整权威存档 |

采集方案的桌面可见性规则此前尚未确定。本批保守地不广播他人未结算方案，也不新增保密、同时锁定、禁止修改或公开承诺等游戏规则；原有“最后一份提交前可修改本人方案”的行为完全保留。后续UI若需展示他人方案，先核对依据并由负责人决定可见性。公开纯函数的存在也不表示允许旁观；网络层仍须检查房间成员资格。

## 读取接口

- `getGamePublicView(state, definition)`：不含任何玩家私有字段，供服务端生成共同部分。
- `getGamePlayerView(state, definition, {authenticatedPlayerId})`：返回`{public, private}`，私有部分只属于认证成员；未知玩家或多余身份字段拒绝。
- 两者均先校验完整存档，返回脱离输入的深度冻结对象；损坏存档报服务端错误，不输出部分视图。支持既有入场、独立行动、受管回合及正式终局格式，不迁移旧存档。
- `GamePublicView`、`GamePlayerView`为深度readonly类型；前端可使用类型导入。本规则包依赖Node运行时，不建议将整个包直接打入浏览器。
- 现有`getRoundPublicView`保留原合同：它包含本人私有角色，是历史局部接口，不能作为全房广播内容。新接口不修改旧调用方。

进度不是完整合法操作菜单。路径、报价、事件成本／目标、嵌套入场等继续使用现有只读查询；未来服务端只能开放经过授权的查询，actor从认证上下文取得，不能让客户端指定身份来调用内部函数。所有候选在实际提交时重新验证。

## 请求和响应

`gamePlayerRequestSchema`复用原有严格命令Schema，并增加版本、请求关联ID和13个明确通道。内外层都拒绝额外字段；客户端不能指定actor、收益、轮次、随机种子或牌序。

```json
{
  "apiVersion": "1.0.0",
  "requestId": "browser-session-1-command-7",
  "channel": "round",
  "command": {
    "gameId": "room-game-1",
    "expectedVersion": 42,
    "type": "choose-major-action",
    "action": "construct"
  }
}
```

| channel | 复用处理器 |
| --- | --- |
| entry | applyEntryCommand |
| round | applyRoundCommand |
| exploration | applyExplorationCommand |
| city-move | applyCityMoveCommand |
| influence | applyInfluenceCommand |
| harvest | applyHarvestCommand |
| construction | applyConstructionCommand |
| role | applyBaseRoleCommand |
| role-cleanup | applyRoleCleanupCommand |
| warehouse-entry | applyWarehouseEntryCommand |
| facility-entry | applyNestedFacilityEntryCommand |
| city-pattern | applyCityPatternCommand |
| pattern-continuation | applyCityPatternContinuationCommand |

嵌套探索／移城与普通步骤可能同名，因此通过通道区分父动作；实际父子授权仍由原处理器校验。错误通道不会打开窗口、获得主要行动或访问搜牌。建设完成后若有入场／事件选择，客户端继续按返回进度提交下一步。

`executeGamePlayerRequest(state, definition, context, unknownPayload)`是**服务端内部纯函数**。成功返回`{status:'accepted', state, reply}`；只有`state`供内部持久化，成功一次递增一个全局版本。拒绝返回`{status:'rejected', reply}`，没有新状态。禁止序列化整个执行结果。

可发送响应由`gamePlayerReplySchema`校验；`GamePlayerRequest`和`GamePlayerReply`同步从Schema推导。成功响应仅包含apiVersion/requestId/ok/gameId/stateVersion，随后向各成员发送各自视图。失败只包含关联ID和安全错误码，不回传内部异常消息、原请求或存档。

| 错误码 | 行为 |
| --- | --- |
| NOT_A_MEMBER | 可信身份缺失或不属于对局；不读取请求，requestId为null |
| INVALID_REQUEST | 版本、通道、格式或额外字段无效；requestId为null |
| WRONG_GAME | 请求指向不同对局 |
| STALE_VERSION | 请求版本已过期；客户端重新读取本人最新视图 |
| GAME_FINISHED | 正式终局不再接收玩家操作 |
| RULE_REJECTED | 原处理器拒绝，附固定ruleCode供界面映射说明 |

格式有效后才回显requestId；它只用于关联请求，不代表服务端已经实现持久幂等去重。同一个旧版本请求在成功后重发会被版本检查拒绝。未知异常及损坏权威存档仍抛给服务端，不能伪装成玩家错误或成功响应。

## 未来服务端提交顺序

1. 根据连接／登录会话解析用户与房间席位，构造可信`authenticatedPlayerId`；不能采用请求体中的身份。
2. 按对局串行读取权威存档，调用纯函数执行，拒绝时发送安全失败响应。
3. 接受时在数据库事务中以`gameId + expectedVersion`比较并交换；落库失败或竞争失败不得发送成功响应。
4. 成功保存后发送准备好的reply，并基于**已提交状态**为每个接收者分别生成视图。禁止广播整个GameState、执行结果或某个玩家的`{public,private}`给全房。
5. 重连使用同一已提交状态重新投影，终局调用正式计分结果，不重复奖励。

开始入场／回合、初始化能力、开启采集／清理、回合收尾和正式计分仍为可信服务端转换，没有玩家请求通道。未来阶段调度也须串行持久化；本批未实现认证、房间、WebSocket、数据库CAS、跨进程exactly-once、UI或部署。

## 验证

运行`npm run verify`及`npm run check:player-api`。后者在原真实终局夹具上用统一玩家入口运行2/3/4人×4情景的12场八回合；原检查的直接调用模式保留。每场在角色盖放、样式宣告／续接和终局检查所有成员的公开／私有视图及JSON恢复。实际数量、失败修复和退出状态见[本批验证记录](testing/player-api-validation-2026-10-26.md)。
