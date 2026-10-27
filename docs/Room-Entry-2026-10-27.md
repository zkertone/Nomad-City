# 本人房间入口与退出会话 · 2026-10-27

本文件保留该批次范围；同日后续已接入服务端创建／邀请／准备／开始大厅，见[Lobby-Flow](Lobby-Flow-2026-10-27.md)及[本地运行](Local-Run.md)。账户验证和React界面仍待完成。

基于main `7c1eecd07a1bf10f93436fdbfca629a99f4818ac`。沿用既有NestJS／Socket.IO／PostgreSQL、持久化不透明凭证及固定房间成员。本批补齐已认证客户端进入已有对局所需的查询和退出功能；账户注册／验证凭据、创建／邀请／准备大厅及React界面继续待办。

## 客户端流程与协议

仍以原严格握手连接`/game`，协议版本保持1.0.0；本批新增事件，不改变原事件形状。身份来自服务器验证的会话，消息不接受userId或playerId。

| 事件 | 严格请求 | 成功响应 |
| --- | --- | --- |
| session:current | `{}` | `{status:'authenticated',protocolVersion:'1.0.0',userId,expiresAt}` |
| room:list | `{limit?:1..50,afterRoomId?:string}` | `{status:'listed',rooms,nextAfterRoomId:string|null}` |
| session:logout | `{}` | `{status:'logged-out',protocolVersion:'1.0.0'}`，随后失效通知并断开当前凭证的在线连接 |

这些事件均要求显式对象；不传参数、数组、未知字段或伪造身份返回INVALID_MESSAGE。session:current仅返回当前用户和原到期时间，不续期、不签发凭证。凭证原文及摘要均不返回。

登录页未来完成真实身份验证、取得可信服务签发的sessionToken后，客户端可依次连接、session:current、room:list、选房间、room:subscribe。列表不自动订阅；没有已加入房间时返回空数组，后续大厅负责建房或邀请。

退出客户端应先停止发送新游戏指令，发送session:logout；收到成功或session:invalidated后清除本地凭证和个人视图。请求超时意味着结果未知，应停止继续使用该凭证，重新验证身份；不能把未收到ack解释为撤销没有发生。当前尚无客户端凭证存储实现。

## 本人房间目录

RoomDirectory独立注入同一SQL连接，不改RoomStore接口或既有测试存储。SQL先按members中userId精确匹配过滤，再按room_id的C排序做键集分页；默认20条，最多50条，额外读取一行判断是否还有下一页。nextAfterRoomId只来源于本人最后一条结果，不返回全站数量、其他房间或其他成员身份。游标可以是任意合法房间ID，始终不能绕过成员过滤。

每条摘要只有roomId、gameId、本人playerId、playerCount、stateVersion、phase、roundNumber（未有受管回合时为null）、scored。scored表示已保存的正式1.17.0终局，不能把旧局仅stage=finished视为已计分。入口页用stateVersion判断列表信息是否已过期，真正进入时仍应订阅读取最新GamePlayerView。

SQL只投影上述元数据，不加载完整GameState、定义、成员表、角色暗牌、牌堆、采集方案或启动计划。列表读取不会调用自动调度器；需要恢复边界时仍由已授权room:subscribe完成。快照摘要是查询时事实，多页之间不提供全局事务快照；并发新建且排在游标之前的房间需要刷新首页。旧NULL lifecycle房间按原状态列出，不补造历史。

004-room-directory.sql增加成员JSONB的GIN索引；migrateRoomStore依次执行001、003、004，重复执行安全。没有新业务表或游戏状态格式迁移，原成员映射仍不可变。大量数据的在线索引部署需要届时单独安排，本批只在测试数据库迁移。

## 撤销、并发与故障

每次事件重新验证凭证；列表查询结束后再次验证，查询期间到期／撤销就丢弃查询结果。验证查询返回后也检查连接仍为原记录，避免断开期间完成的旧查询继续作为有效连接使用。

退出只撤销握手中的当前凭证。SQL DELETE确认后才发送成功ack，再向本实例使用同一凭证的连接发送session:invalidated并断开，包括同凭证标签页。相同用户另外签发的独立凭证保留有效；退出不退房、不更换席位、不修改GameState。即使客户端没有提供ack回调，撤销和断开仍执行。

撤销写入失败返回AUTH_UNAVAILABLE，不报成功、不主动断开仍有效凭证，可重试。若连接丢失或SQL结果不确定，客户端仍不能推断最终结果。已获得授权并开始处理的游戏写入可能完成；本批没有把会话撤销和游戏提交放入同一事务，也没有回滚已经提交的游戏动作。

RoomDirectory存储／摘要异常返回固定STORAGE_UNAVAILABLE，无部分成功及原异常文本；网关非预期错误返回SERVER_UNAVAILABLE。认证错误沿用AUTH_REQUIRED／AUTH_UNAVAILABLE及失效断开。现有单实例范围不变；另一实例的同凭证连接仍在下一次事件／推送验证时失效，没有新增跨实例撤销广播。

## 验证与剩余边界

本批结果及原始日志见[入口验证记录](testing/entry-validation-2026-10-27.md)。原生PostgreSQL联调和用户服务器部署仍未执行，测试SQL引擎为PGlite，真实Socket.IO使用loopback网络。完整账户登录、公开／私有建房大厅、邀请／准备／房主策略、前端入口及2.5D游戏界面仍待开发；本批不是可公开使用的登录系统。
