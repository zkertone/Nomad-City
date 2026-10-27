# 简化2D回合准备界面 · 2026-10-27

后续增量：部署／调度及明确结束行动轮现已接通，见[主要行动界面](Influence-Action-UI-2026-10-27.md)。本文保留上一批范围与测试历史。

基于main3c21df51cc3d91faf78e8e54d4aa9d93063c7d9c。负责人批准简化2D＋2.5D两种显示模式、共享规则／状态及先完成2D操作闭环。本批记录[ADR-0002](adr/ADR-0002-Shared-2D-and-2.5D-Presentation.md)，并接通供应设施移除、角色盖放，继续原本地工作流。

## 已实现范围

- renderers/types定义共享GamePlayerView／BoardDefinition、服务器候选、本地选中项与稳定node／route／slot选择意图。原资源点概览提取为Board2D，经BoardRenderer调用，现有注册表仅2D；不改变地图／规则对象。
- 角色与设施面板在共享React界面中，独立于棋盘渲染。二人局按真实顺序选择移除一张供应设施、补齐六张，再轮到另一人；三／四人直接进入角色盖放。当前只有实际操作者看到候选。
- 设施展示真实实体ID对应的名称、颜色、印刷分数／费用和原效果文字，用户先选择再确认移除。候选来源及能否补牌由服务器原规则决定，不添加耗尽处理。
- 所有人从本人可用角色中选择后确认盖放；其他人只见“已盖放”，本人可见自己的角色。空手时展示弃牌收回提示，实际恢复发生在原规则确认提交中。没有代替其他人选择、推断对手牌或自动盖放。
- 全部盖放后显示当前主要行动玩家；本批尚未接入主要行动、角色效果／计谋、样式、采集或清理页面，不能通过网页完成完整八回合。

现有本地命令不变：npm ci后npm run dev:local，自己电脑打开http://127.0.0.1:5173，多窗口选不同测试身份。游戏开始后完成入场，即可继续回合准备；刷新和断线恢复依赖原保存状态。

## 服务端只读合同

新增严格`room:round-setup-options {roomId}`，返回ready、roomId／gameId／stateVersion、blockedReason和options。非成员／不存在统一ROOM_UNAVAILABLE，非法身份字段INVALID_MESSAGE；存储故障STORAGE_UNAVAILABLE。握手与事件前后认证、房间队列及本人映射沿用原网关。

options仅在round-control的role-removal／role-placement且本人为getRoundTurn.actorId时出现；其余人／阶段为null。自动初始化仍pending时返回blockedReason=AUTOMATION_PENDING、options=null，本接口不推进阶段或提交任何状态。

候选使用原applyRoundCommand纯函数逐项验证，临时候选GameState立即丢弃，不返回或保存。供应候选仅来自当前公开六张及其静态卡面；无法补牌、版本溢出等原拒绝用固定blockedBy代码表示，按钮不可确认。角色候选仅保留原规则接受的本人手牌或可收回弃牌，不另写一套盖放／收回规则。未知程序故障仍由网关安全归一，不伪装为已执行。

确认仍经原`room:command`的round通道，remove-round-supply-card／place-round-role实际校验、单版本CAS保存及逐接收者推送。玩家不能提供抽牌顺序、其他人角色、回合数、结果或权威快照。

## 客户端和展示

CityClient共享playerCommand封装原entry与round请求；请求使用最新GamePlayerView版本，较低写入receipt不回退状态。入场期查询原entry-options，进入受管回合后查询round-setup-options；结果只有roomId、gameId和stateVersion都匹配时才进入缓存。

新版本、选房、断线、失效和房间不可用都清除准备候选；旧选项不能恢复新局面。拒绝／超时不替换已确认视图、不自动重发。选中项是共享React面板局部状态，随版本清除；渲染器只负责显示和选择意图，不发权威状态或修改回合。

2.5D实现、模型资产、WebGL降级和玩家模式偏好尚未接入；用户批准的是两种显示路线与共享架构，不表示目前两种界面均已完成。原C路线作为增强显示保留。

## 验证边界

详见[回合准备验证](testing/round-preparation-validation-2026-10-27.md)。延续此前浏览器安全策略拒绝，本批没有再尝试浏览器、替代预览或截图；类型／规则／真实Socket.IO／HTTP自动检查单独记录，不冒充人工点击或视觉通过。生产账户、原生PostgreSQL和部署仍在后续范围。
