# 四张城市样式：建设、连续移城与可恢复结算

后续状态：GameState1.15.0已完成基础13种宣告和10种特殊行动，见[额外行动与角色例外](City-Pattern-Major-Actions-2026-10-24.md)。本文件中较早的支持数量和待实现项保留为该批历史。

本批统一接入新兴建筑群、城建开拓区、复合动力系统、高效移动管理体系。基础版二、三、四人均使用同一权威流程，当前支持基础目录全部13种宣告及10种特殊行动中的7种。源石工业中枢、核心商业区、拓荒指挥中枢的特殊行动，以及两张企业样式仍待完成，不把目录继承当成完整三档九组合已经运行。

## 规则与逐牌行为

再次读取负责人提供的image(6)/(7)/(8)转正照片，沿用patterns/catalog.json登记的原图/PDF摘要、15张原文与风味及正式名称“复合动力系统”。共有宣告/特殊行动/操作顺序/无法执行/收尾规则沿用《铸基者》印刷p07–11、p13；玩法依赖继续按[三档规范](Gameplay-Versions-2026-10-24.md)，E/O来源与玩法版本分别保存。

| 样式 | 本批完成的实际行为 | 费用与额度 |
| --- | --- | --- |
| 新兴建筑群 | 宣告计分并记录使用后，从公开供应选择非虹色设施，放在本人空位，按普通费用建设，完整结算入场 | 没有免费标识；不占主要行动，主要行动前/后均恢复原额度 |
| 城建开拓区 | 从实际设施牌堆选择一张，正常建设与入场，最后安全随机洗混剩余设施牌堆 | 先失去1分；消耗本行动轮主要行动及该样式本回合一次使用 |
| 复合动力系统 | 一次完整免费移城，含所选航道/目标对手标记清除、未探索目标事件、目标末尾放置，然后在实际经过的航道放置1影响力 | 先支付1源石及合计3源岩/异铁；不再支付普通移城的3源石 |
| 高效移动管理体系 | 连续执行两次完整免费移城，第二次从第一次实际目的地重新查询目标 | 开始前一次支付3源石；本行动轮不能使用角色；Ⅱ级整局次数仍不补充 |

每一步可执行时必须完成，不得主动跳过以拿取奖励或提前结束；实质无法执行的操作才自动推进。新兴建筑群全盘占满或没有任何可支付且合规的建设时不虚构子建设，仍保留宣告/分数/标记/已用设施。城建开拓区无可建牌时仍扣其1分与使用，并记录最终洗混。普通公开供应补牌规则若遇到既有未解决的牌堆耗尽情况，会原子拒绝，不把未解决规则当成“无法执行”而静默完成。

城建开拓区从drawPile直接拿牌，不从公开六张拿取，不因该次拿取补充公开供应；普通供应建设仍拿取并立即补足六张。两者使用同一费用、唯一性、实体归属、空位、计分和完整入场引擎。牌堆建设可以取走最后一张普通牌；后续若另有普通供应建设，仍受原补牌边界约束。其入场若继续建设/探索/移城，由既有设施续接管理，全部完成才洗混。内部建设回执区分take-from-deck和take-and-refill。

## 状态与升级

可信enableCityPatternContinuations(state, definition, {expectedVersion})只从验证通过的1.13.0显式升级一次至1.14.0，保留已有宣告、标记、余额、设施、角色及当前普通行动进度，不重放效果或补次数。增加cityPatternContinuation显式null或以下单个所有者：

- declaration-build/PAT-013：复用顶层construction，原主要行动状态保存在既有roundFlow字段中，不复制旧行动进度。
- deck-build/PAT-012：复用顶层construction，来源由服务端的样式上下文授予；完整入场后洗混并完成原一次特殊行动。
- city-move/PAT-004或PAT-006：复用顶层cityMove，保留剩余移城次数；一次移城的事件/末尾放置结束后才推进下一次或航道放置。

任一续接期间getRoundTurn统一返回pending，即使宣告前主要行动尚未开始，或者移城子进度已complete但航道放置尚未做。此时不能取消、结束行动轮、使用角色、再次宣告或开启其他主要行动。完成后清空续接及子进度：宣告恢复原主要行动额度，特殊行动完成本行动轮主要行动。不存在同时运行的第二个经济、位置或建设账本。

1.14.0必须包含该字段；旧格式禁止携带，旧存档不自动升级。当前样式、实际标记、设施永久已用记录、Ⅰ级恢复/Ⅱ级整局次数、角色同一turnIndex禁令全部保留。检查续接的样式/公开牌/已用设施/实际本人标记/本行动轮使用/已消费次数/进度及阶段，拒绝伪造完成或错属角色。牌堆建设必须保留最终洗混所需revision容量，不能发布无法结束的中间存档。

## 接口

根模块及/game导出enableCityPatternContinuations、getCityPatternContinuationOptions、getPendingPatternCityMoveRequirements、applyCityPatternContinuationCommand和对应错误类。getCityPatternActionSupport(state.schemaVersion)给出1.13.0或1.14.0逐牌边界；省略参数保留旧1.13.0结果，不破坏旧调用方。

原applyCityPatternCommand增加三种effect：composite-move（orirock与iron之和必须为3）、double-move、deck-construction。新兴建筑群使用原declare-city-pattern格式，由服务端启动完整宣告后建设。

所有普通移城、事件、末尾放置继续使用applyCityMoveCommand；服务端根据实际续接授予免费资格，客户端不能传free。复合动力最后一步使用applyCityPatternContinuationCommand，type为place-pattern-route-influence，带所经过航道的实际合法slotId。无法放置时自动完成，不允许把这一步放到其他航道。

所有建设继续用applyConstructionCommand/getConstructionQuote，设施子入场继续用原applyNestedFacilityEntryCommand或applyWarehouseEntryCommand及查询接口。来源由服务端上下文确定，玩家不能提交source/free/费用/分数。getCityPatternContinuationOptions只向当前有权玩家返回牌堆搜索候选；getCityPatternPublicView不包含牌堆顺序或搜索候选。实际认证仍需未来服务器适配层。

每条成功玩家命令增加一次stateVersion，连续效果通过多条指令保存每个选择点；失败不消费本次指令的任何成本、奖励、随机洗混、次数或标记，已有成功步骤仍保留。所有等待阶段可严格JSON往返，不会重新扣启动成本、重抽事件或补次数。

## 验证与待办

测试和真实执行结果见[本批验证记录](testing/city-pattern-continuations-validation-2026-10-24.md)。接下来仍需源石工业中枢/核心商业区/拓荒指挥中枢的额外行动与角色例外，再接临时聚居点、企业/企业家、完整三档配置及最终计分。原资料、固定摘要、GameDefinition、Accepted ADR与依赖锁不变；没有UI、网络、部署或对外发布。
