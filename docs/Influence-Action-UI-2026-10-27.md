# 简化2D部署与调度界面 · 2026-10-27

后续增量：探索／移城与事件选择现已接入，见[2026-10-28范围](Travel-Action-UI-2026-10-28.md)。本文保留上一批接口范围和验证历史。

基于main c5e21d411d4e2f48d28d3ce1337ad92ee0b83bc7，延续负责人“下一步”、本地优先及提交main的授权。复用原核心／存档／Accepted ADR-0002，本批不改变规则、依赖或显示路线。

## 已接通的操作

- 当前玩家选择部署或调度；其余主要行动尚未显示可操作入口。
- 2D概览按区块显示资源点、航道及全部稳定ID槽位，航道显示连接点，槽位显示公开占用人。布局是数据概览，不是真实棋盘坐标或距离依据；只有服务端候选可选。
- 部署：先选择合法空槽，确认后原规则从本人供应转移一枚真实标记。
- 调度：先选择本人影响力来源，再选择合法空槽；确认一项操作后清空本地选择，可继续第二次或明确点击“不再移动”。不添加相邻限制、不领取新标记；同一标记可按原规则再次调度。
- 有零实际操作的准备可取消，重新选择主要行动；有实际操作或已完成后不允许撤销。无可执行位置的行动按原规则直接完成，本人仍需明确结束行动轮。
- 结束行动轮是单独按钮，不自动点击。当前明确提示角色和样式入口尚未接通，结束此轮会放弃此时的可选操作机会。核心仍保留主要行动前后这些机会，未修改额度或弃牌。

MajorActionPanel放在共享React面板，不属于2D渲染器。BoardIntent沿用稳定slotId，新增选中来源／目标为展示状态；未来2.5D可复用同一流程。模型、WebGL、切换按钮和模式偏好尚未实现。

## 服务端只读选项

`room:action-options {roomId}` 严格拒绝额外身份字段。RoomService和网关沿用房间串行、会话前后验证及可信成员映射；非成员／不存在统一ROOM_UNAVAILABLE，存储故障统一STORAGE_UNAVAILABLE。仅受管player-actions的当前玩家获得options，其他人／阶段为null；初始化pending时blockedReason=AUTOMATION_PENDING且不推进任何步骤。

返回公开封套roomId／gameId／stateVersion，以及部署／调度开启权限、实际influence进度、部署槽位、按来源关联的调度目标、取消／提前结束调度／结束行动轮权限。没有原始GameState、成员表、牌堆顺序、对手手牌、盖放身份或物理markerId。

- 权限通过原applyRoundCommand／applyInfluenceCommand纯函数验证；候选新状态立即丢弃，不保存／推送。
- 槽位通过原getDeploymentSlotIds、getDispatchSourceSlotIds、getDispatchTargetSlotIds取得；用实际候选命令检查版本等公共门槛，不复制放置／目标规则。
- 原错误固定blockedBy标记不可执行，程序故障交由网关安全归一。版本耗尽不会显示可确认的执行槽位。
- 确认仍走原room:command的round／influence通道，经原规则校验、CAS保存后个别推送；候选不是后续提交的授权替代。

## 客户端与恢复

CityClient在入场期查询entry-options、准备期查询round-setup-options、player-actions查询action-options。只接受与当前roomId／gameId／stateVersion相同的候选。更高视图、换房、断线、失效及房间不可用均清理候选；拒绝／超时保留最后确认视图，不自动重发。后续请求使用最新返回view版本，不使用可能落后的玩家receipt。

选择来源／目标属于本地展示，版本变化即清空。刷新／重连从保存状态重新取得尚未完成的influenceAction及合法选项，不重复部署／调度、不重新发牌。终止服务再重开文件数据库的实际验证另见[验证记录](testing/influence-ui-validation-2026-10-27.md)。

## 尚未完成

探索、城市移动、建设及嵌套事件／设施入场、角色／城市样式、采集、雷蛇清理、终局操作页面仍待接入；当前不能通过网页操作完整八回合。地图精确几何、2.5D建模、真实账户、原生PostgreSQL和部署也未完成。普通供应耗尽及方案显示等既有待确认事项不新增解释。

继承此前浏览器安全策略拒绝，本批没有再尝试浏览器、替代浏览器或截图。自动类型／规则／Socket.IO／HTTP验证不代表实际点击或视觉验收通过。
