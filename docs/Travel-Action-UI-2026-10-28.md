# 简化2D探索、移城与事件界面 · 2026-10-28

基于main454ae97f949c0b4dd6a417dede90ac471f3c2844，延续负责人“下一步”、本地优先与保存main的授权。原核心、资料、存档和Accepted ADR沿用，不新增游戏规则。

## 已实现

- 主要行动列表从部署／调度扩展至探索／移城，建设入口仍待完成。
- 探索逐段添加航道及到达点，可撤回最后一段；最多22段，与原命令Schema一致。允许途经已探索点及重复航道，不由地图布局或中间发现状态推定通行许可。
- 完整路径由原getExplorationTollQuote给出总金券／每条独立航道费用／供应或可收款玩家。多持有人时用户明确选择；同一航道重复出现时保持同一收款人，仅收一次。现有余额、红区开放、牌堆、收款安全范围仍由原reducer检查，不预支事件收益。
- 移城保留原getCityMoveOptions的具体routeId／nodeId组合，支付3源石后按原规则清除选定航道与目标点的对手标记；费用不足时不能确认；未探索目标缺少对应事件牌时不可确认，已探索目标不再抽牌。
- 只在原行动已揭牌的event-choice阶段提供该事件原文、每个原选项及准确效果，包括本人／每位对手收益。条件费用必须明确pay或decline，有合法事件内放置时必须选槽位；不执行的选择不可确认。
- 事件内影响力和行动末尾影响力是两个独立原规则提交。事件后按实际最新状态重新计算末尾槽位，不能沿用事件前候选。已完成后仍需本人明确结束行动轮，不自动跳过角色／样式机会。

共享TravelAction面板挂在MajorActionPanel，独立于2D渲染器；来源、路径、支付、事件和槽位选择使用原稳定ID。当前使用下拉选择路径／航道，棋盘仍为资源点／槽位数据概览，不新增准确几何或3D模型。角色／样式生成的免费移城／额外续接不进入本批普通行动面板，不把它们误显示为付费普通移城。

## 只读合同

`room:action-options {roomId}` 增加四项开启权限和travel：kind／status／已确认目标、移城组合与原拒绝代码、末尾合法槽位、当前已揭事件的执行变体。父接口继续仅给受管player-actions的本人操作者选项，初始化pending时不推进；非本人options=null。

事件变体通过原getPendingExplorationChoiceRequirements／getPendingCityMoveChoiceRequirements取得费用与放置要求，再由原applyExplorationCommand／applyCityMoveCommand逐项验证完整choice。合法与否只返回固定blockedBy，临时状态立即丢弃；不保存或广播候选GameState，不返回其他事件、牌序、成员表、对手盖放身份或物理markerId。

新增严格`room:exploration-route {roomId,gameId,expectedVersion,path}`。path复用原explorationPathStepSchema，每段routeId／toNodeId及可选payeePlayerId，0–22段，拒绝身份／费用／牌序等额外字段。本人映射、房间队列、查询前后重新认证及安全存储错误与既有网关一致。

响应ready封套包含当前roomId／gameId／stateVersion；options只有版本与对局匹配、本人正处于普通探索ready时出现，其余为null。options包含请求路径、当前路径末端、下一段几何连接选项、原quote（可为空）和原reducer的执行许可。几何选项仅用原topology工具导航，不表示目标玩法合法。只有完整路径以合法未探索目标结束时给出quote，是否可实际提交还经过原完整命令验证。未提交的预览不扣费、不抽牌、不占行动、不CAS，也不恢复自动初始化。

## 客户端与恢复

CityClient新增原exploration／city-move通道方法，命令类型从原核心类型去除封套，不复制另一套命令Schema。每次提交使用最新确认view版本；候选、延迟ACK、换房、失效和断线继续原保护，不重发超时玩家写入。

路径预览同时检查房间／gameId／确认版本。TravelAction按gameId／版本重建；编辑路径时立即清除预览，响应路径必须与当前草稿完全一致，旧effect完成后不能启用新草稿确认。预览失败可手动重新查询。路径草稿仅本地展示，刷新丢弃草稿；已确认的费用／抽牌／事件／末尾放置进度来自保存状态恢复。

## 范围与边界

本批覆盖普通探索、普通移城及其事件／末尾放置，不含建设或设施嵌套行动、角色／城市样式、采集、雷蛇清理和终局页面。当前还不能通过网页操作完整八回合。2.5D模型、模式切换、真实账户、原生PostgreSQL和部署继续后续；未接触用户服务器。

未再尝试此前被策略拒绝的浏览器或采用替代浏览器路线。实际点击、截图和视觉验收仍未完成；服务端、客户端控制器及HTTP／Socket.IO自动测试另行列证，见[验证记录](testing/travel-ui-validation-2026-10-28.md)。
