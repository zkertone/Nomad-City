# 私人大厅到基础局开局 · 2026-10-27

基于main c3a78bcd37cc775d57de9f0dd720e2280cb72042。按负责人“下一步”，随后明确“我们先本地跑通”，沿用现有NestJS／Socket.IO／PostgreSQL、会话验证及自动基础局。新增的是开局前的应用流程，不变更玩法、静态资料、GameState／Definition、Accepted ADR或2.5D视觉路线。

## 大厅状态与玩家确认

独立nco_lobbies保存schema1.0.0、唯一大厅／预留gameId、房主、创建请求键、独立version、2／3／4目标人数、成员及准备状态、明确的先手／顺时针配置。waiting可以变为started或cancelled；开始后成员不可再修改，固定映射交给既有房间系统。大厅版本与GameState版本不同，客户端应分别跟踪。

房主占p1红色，加入者取得第一个空闲席位（p2蓝／p3绿／p4黄）。这是当前大厅的默认席位分配；实际先手和顺时针必须在满员后由房主明确配置，并展示给所有成员。成员只能设置本人ready；开始要求目标人数全部到齐、有效配置及每人准备。房主修改配置、成员离开或新加入时清除配置／准备（配置变更保留新配置），避免沿用对旧设置的确认。断线／退出登录不代表主动离席，也不清除准备；重连读持久化状态。

成员可在waiting主动离开；房主应取消整个大厅，不能直接丢下无房主大厅。没有踢人、房主转移、动态人数、颜色编辑、旁观、机器人或开始后的换座功能。房主也不能通过大厅替别人准备、指定他人userId、设置牌堆或提交游戏快照。

## 传输合同

仍为/game命名空间、严格会话握手及协议1.0.0。只有已验证用户可使用下列事件；消息中没有身份字段。

| 事件 | 请求 | 成功 |
| --- | --- | --- |
| lobby:create | `{requestId,playerCount:2..4}` | `{status:'created',view,inviteToken}`；同用户／requestId重试返回existing及同一大厅，无明文邀请 |
| lobby:join | `{lobbyId,inviteToken}` | joined及本人view；已有成员返回ready，不重复占座／加版本 |
| lobby:list | `{limit?:1..50,afterLobbyId?}` | listed、lobbies、nextAfterLobbyId；只列本人当前成员大厅，默认20，C顺序键集分页 |
| lobby:subscribe | `{lobbyId}` | ready及本人view，并发送当前lobby:state；每连接最多8个大厅订阅 |
| lobby:unsubscribe | `{lobbyId}` | unsubscribed及lobbyId，释放订阅名额 |
| lobby:command | `{lobbyId,expectedVersion,type,...}` | updated及本人view；离开返回left／lobbyId／version |

命令type包括configure（startingPlayerId、clockwisePlayerIds）、set-ready（ready布尔）、start、leave、cancel、rotate-invite。configure／start／cancel／rotate-invite只允许房主；其他字段严格拒绝。除join外的修改都必须带最新大厅expectedVersion。join内部读取版本后CAS，竞争失败不偷偷重试为另一个座位；客户端应重新读取或重新尝试加入。

大厅view只含lobbyId、version、status、playerCount、selfPlayerId、ownerPlayerId（p1）、roomId（仅started时非null）、公开席位／颜色／准备列表及明确配置。其他账户ID、创建键、内部gameId、邀请摘要／明文及任何游戏暗牌不在view中。每接收者的selfPlayerId单独生成；lobby:state只发送更高版本。离开者下次发布会收到lobby:unavailable并释放其订阅，之后不再收到该大厅状态。

started视图的roomId就是lobbyId；客户端继续原room:subscribe，获得本人GamePlayerView并继续原13通道指令。开始不会自动增加游戏订阅，也不把GameState随大厅广播。room:list仅列已开始的游戏，waiting及cancelled通过lobby:list恢复。

## 邀请与确认

邀请为32字节随机数的43字符base64url形式，数据库仅存SHA-256摘要。创建和rotate-invite的成功ack仅向房主返回本次明文；常规读取、订阅、列表及推送均不返回。未保存明文或ack丢失时，房主可以按当前版本旋转新邀请；无法从摘要恢复原值。

邀请持有人仍须有有效会话；非成员不知道正确邀请时，缺失大厅与无权大厅返回相同LOBBY_UNAVAILABLE。旋转立即使原邀请失效，开始／取消将摘要清空；不撤销已加入成员。邀请本批可重复使用直至满员、旋转或关闭，未增加过期策略或对外分享服务。客户端不得把邀请或会话凭证写入日志。

创建按数据库UNIQUE(owner_id,create_request_id)恢复同一大厅；复用该键但改变人数返回REQUEST_CONFLICT。其他命令通过版本避免重复执行，不承诺持久化全通道requestId幂等或exactly-once。确认丢失后应读最新状态，不能重新生成另一局。

## 保存、失败与恢复

加入和设置使用版本条件UPDATE。start调用已有createAutomaticBaseRoomSnapshot，安全随机设置由服务器生成；单个数据修改CTE先按大厅旧版本封存，再INSERT同一完整定义／成员／状态／lifecycle到nco_rooms。没有吞掉INSERT冲突：插入失败时整个语句回滚，大厅保持原waiting／版本／邀请；SQL确认后才返回started。两个服务实例竞争仅一个版本获胜，落败者没有候选状态推送。

SQL技术依据：[PostgreSQL数据修改CTE](https://www.postgresql.org/docs/18/queries-with.html#QUERIES-WITH-MODIFYING)。本批用真实PGlite约束冲突验证回滚；原生PostgreSQL网络／行锁／跨进程仍未验收。

005-lobbies.sql由migrateRoomStore在原迁移后执行，独立表及成员GIN索引可重复执行。旧房间不迁移为大厅、不添加缺失开局历史。发布仍为原单实例网关；同数据库跨实例CAS有保护，但另一实例的在线大厅推送没有总线。

网关所有操作使用会话principal；返回ack／推送前再次验证，处理中撤销则丢弃结果并失效连接。已有授权写入可能仍完成，这与原游戏命令边界相同。服务错误只返回固定码；数据库／损坏存档异常为STORAGE_UNAVAILABLE，版本为STALE_VERSION或COMMIT_CONFLICT，设置／权限／准备分别用专门码，不把原SQL错误发给客户端。

本地运行见[Local-Run](Local-Run.md)。真实账号验证、前端界面、生产限流／过期清理、跨实例推送和部署仍待完成；当前测试会话不是公开登录入口。
