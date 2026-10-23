# 载具仓库完整入场与探索恢复 · 2026-10-23

状态：已设计、已实现、已测试；通用嵌套设施引擎和完整游戏仍待完成。本增量将建设支持扩至11类/26张匹配已拍颜色实体，allFacilitiesImplemented仍false。

## 规则与来源

载具仓库FAC-001已拍红色3张：印刷0分，资源费1源岩+2源石或9金券；入场先放置1个影响力、再移动1个影响力，或执行1次探索。实际查看原图warehouse.png及现有已核验转录，沿用用户规则书p05–07行动、p13顺序/尽量执行及人数红区限制。PDF摘要重新实测 `6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42`。

探索没有“免费”，仍付所选路径路费、结算对应事件及在目标点末尾放置。入场一个蓝箭头是移动1次，不是整个两次调度；可以移动之前已有或刚放置的本人影响力。未将放置误当替换，未加入费用、所有者、距离或扩展规则。

卡面基准仍 `sha256:840edd051e9c8a97377a0419cf64d663b35d68a2fcd861b5f288560ac6ab614e`；原JSON、确认文字、费用、数量和摘要均不改。

## 显式1.11.0升级

`enableWarehouseEntries(state,definition,{expectedVersion})` 仅从已验证1.10.0升级至1.11.0，全局版本+1，保留已有资源/设施、使用/弃牌历史、当前主要行动及雷蛇义务。默认beginRoundFlow仍1.7.0，旧升级链继续使用；新设施执行和已建仓库只接受1.11.0，不把旧局未知入场历史自动补成已完成。

外层仍是唯一 `phase='construction'`，只在已有construction中增加：

- status可为ready、entry-pending、complete。
- warehouseEntry可选，包含kind='warehouse-choice'或'warehouse-exploration'、status（branch-choice/event-choice/final-influence/complete/skipped）、targetNodeId/cardId/resolvedChoiceId。
- actorId/roundNumber只取父建设进度，不在子记录中重复保存。

没有同时保存顶层exploration，不复制棋盘、经济或牌堆账本；未新增通用效果总线，也没有改变Accepted ADR的权威状态结构。所有动作/采集保留1.11.0，基础角色和雷蛇收尾继续适用。GameDefinition、依赖和项目版本不变。

## 补牌公开后选择入场，或自愿预先确定分支

继续提交 `construct-facility`，角色/身份/对局/版本/主要行动授权仍由现有服务器边界验证。

| 分支 | entryChoice | 额外顶层字段 |
| --- | --- | --- |
| 待选入场（推荐） | `{kind:'warehouse-entry'}` | 不允许warehouseExploration；建设/补牌提交后再选择分支 |
| 影响力 | `{kind:'warehouse-influence',placeSlotId?,move?:{sourceSlotId,targetSlotId}}` | 不允许warehouseExploration |
| 探索 | `{kind:'warehouse-explore'}` | 可执行时必须提供warehouseExploration={nodeId,path}，path沿用普通探索格式及可选路费收款人 |

推荐先提交warehouse-entry：完成支付、取牌/立即补牌、摆放和分数后，construction进入entry-pending，子状态branch-choice。新补牌此时已经公开，玩家再用 `choose-warehouse-entry` 选择影响力或探索；探索目标和路径也在此时决定。不能强迫玩家在看到补牌前作决定。直接给出影响力/探索的方式仅用于玩家自愿预先确定全部选择。

影响力分支按付款→取牌补牌→摆放/印刷分数→先放1枚再移1枚原子结算。每一步可执行就必须给合法选择，不可执行才跳过：供给空时仍可能移动已有标记；目标全满才可能两步都无法执行。不能移对手标记、占格、同槽或进入对手城市/未探索点；新标记和被移动标记均是真实本人标记，不额外授予主要行动。

一次提交时，探索分支先验证构建后的支付能力及选择的初始路径，再将建设、路费支付、揭牌和子事件进度在**同一次提交**写入。一次提交时初始目标/路径/费用无效，整次建设回滚，不拿牌、不支付、不揭事件；采用补牌后选择时，错误路径/费用保留已合法完成的建设和待选分支，允许改选其他合法路径或完整影响力分支；没有可执行探索才自动跳过。

`getConstructionQuote`对仓库增加只读warehouseExplorationTargets（nodeId/minimumToll），按建设付款后的资金、红区、未探索点及剩余牌堆计算。最小费用沿独立航道关联图计算，分叉不拆边、中间点是否探索不限制通行，路径复用同一航道不重复收费。报价不是授权；实际路径及收款人仍逐步验证，所有整数溢出仍拒绝提交。

没有任何当前可执行探索时，省略warehouseExploration会按尽量执行记录skipped并完成建设，不抽牌；仍有免费或可支付路径时不能主动省略探索。提供无效的多余目标也拒绝。

## 事件暂停、保存恢复及继续

初始探索成功后，设施已经支付/拿取/补牌/摆放，建设次数为1，但status='entry-pending'、子状态event-choice。玩家仅通过可信身份继续同一建设的子效果：

| API | 行为 |
| --- | --- |
| applyWarehouseEntryCommand(...,{type:'choose-warehouse-entry',gameId,expectedVersion,entryChoice,warehouseExploration?}) | 补牌公开后选完整分支，并执行放置/移动或付路费揭牌；错误选择保留已付款建设和待选分支 |
| getPendingWarehouseEventRequirements(state,definition,actorId,choiceId) | 查询实际揭示事件的条件支付/影响力选择要求 |
| applyWarehouseEntryCommand(...,{type:'choose-exploration-event',gameId,expectedVersion,choice}) | 复用已有事件结算；错误选择不撤销此前合法建设/揭牌，保留原待选状态 |
| getWarehouseEntryFinalSlotIds(state,definition,actorId) | 仅当子状态final-influence时列出目标资源点的实际合法槽 |
| applyWarehouseEntryCommand(...,{type:'place-exploration-influence',gameId,expectedVersion,slotId}) | 放置目标点末尾影响力，子状态/父建设均完成 |

条件事件自身的额外放置不替代末尾放置；没有库存或合法槽时，事件后才自动完成不可能的末尾放置。事件选择和末尾放置各成功提交版本+1，JSON序列化恢复同一进度，不重扣建设费/路费，不重抽牌、不重复奖励。

子阶段期间不能结束玩家轮次、取消已执行建设、再开主要行动、插入角色、采集或收尾；旧独立窗口及普通探索命令同样拒绝。完成后仍只完成当次建设主要行动，之后角色可正常使用，已有completedMajorAction机制可结清父动作后结束本轮。旧版本重放、错误玩家/对局/阶段、重复事件或放置均拒绝。

## 代码职责与内部API

- exploration-engine.ts复用原普通探索的路径/独立航道收费、事件、末尾放置算法，普通exploration.ts保持所有公共接口及旧存档行为；exploration-invariants.ts共用语义验证。
- warehouse.ts负责显式升级、当前子进度权限、事件查询/继续和全局版本；warehouse-rules.ts只提供当前可执行目标/最低路费查询。
- facilities的beginFacilityConstruction是可信内部开始事务，可返回pendingEntry；receipt.entryStatus明确pending/complete，不能冒充已结算入场。原settleFacilityConstruction只返回完整同步结果，探索分支以ENTRY_REQUIRES_CONTINUATION拒绝，要求权威建设层接管。
- 影响力分支仍可由同步内部结算器完整执行，GameState层对仓库两分支都要求显式新格式。

## 实测与剩余

76项新增测试；全量1705/1705（22文件）、strict/构建通过，18项编译检查全部退出0。新脚本对2/3/4人两种分支共6段真实流程：原入场10金券+德克萨斯策略12→付9建设/公开补牌→保存恢复branch-choice再选分支，影响力分支余13，探索付2路费余11；无资金/标记注入。分支、事件和末尾放置三暂停点恢复、重放拒绝、一次主要行动、两轮/采集/下一回合和30标记守恒均实际验证。首轮1项测试错误及所有命令见 [验证记录](testing/warehouse-validation-2026-10-23.md)。

待完成：高性能动力系统的免费移城/航道额外放置、物流延伸、复制入场、联邦延迟起始玩家、额外建设及更深嵌套；未拍颜色、城市样式、设施牌堆耗尽、最终计分、完整公开视图、认证/联机/持久化CAS。本轮不是任意嵌套效果系统。无UI/3D、部署或对外发布。
