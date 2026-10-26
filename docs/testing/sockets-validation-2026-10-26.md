# 会话与真实Socket.IO网关验证 · 2026-10-26

基准main `d8d3871d3012550bc9f59e08c4192ffc6adb6c04`。新增会话摘要表、SessionService、Socket.IO协议／网关／应用工厂和43项测试；复用原房间服务、SQL CAS、权威状态和规则包。game-core、原静态JSON及固定摘要、Accepted ADR、项目版本和存档格式未变。

## 最终真实结果

| 命令 | 结果 |
| --- | --- |
| npm run typecheck | 退出0 |
| npx vitest run packages/server/src/sockets.test.ts | 43/43，6.92秒 |
| npm run verify | 退出0；strict、33文件2368/2368、game-core/server构建通过；Vitest101.85秒 |
| npm run check:sockets | 退出0；真实127.0.0.1 Socket.IO、3场完整八回合、服务／测试数据库重开及原会话重连 |
| git diff --check | 源码和文档通过；原始日志末尾空行不作为源码问题 |

原2325项全部保留，新43项。先前39项首轮实际通过（7.05秒）；随后增加数据库查询中途过期、订阅名额释放、同身份双连接竞争、超大包四项，最终43项和上述全量通过，不重复计算用例数量。原有各独立编译脚本本批未逐一重跑；新--sockets模式保留原三场房间流程断言并增加真实传输与会话检查。

## 43项新增验证的范围

- 32字节随机凭证、仅SHA-256摘要入库、独立凭证、跨验证器恢复、修改／畸形凭证拒绝、精确到期边界、查询期间到期、单凭证撤销、TTL／时间安全整数及存储故障。
- 实际Nest监听loopback随机端口，真实socket.io-client使用websocket transport接入/game；伪身份、错误协议、缺失／伪造凭证、错误Origin、认证数据库异常均拒绝，异常不泄漏SQL文本。
- 两名玩家的公开部分一致、本人手牌／盖放身份不同，对手隐藏身份和设施暗牌序列不出现；认证非成员与未知房间给相同不可用结果。
- 角色／结果字段注入拒绝；错误席位不能替当前玩家行动；实际玩家请求保存后更新所有已订阅成员的本人视图。
- 写入屏障前没有成功ack或候选状态推送；写入失败或CAS冲突不推送；旧版本重放与双标签页竞争只有一次写入。
- 房间隔离、取消订阅、8个订阅上限及释放名额、64KiB引擎限制、断开后的新握手及重新订阅、撤销后不再获得其他玩家更新、已连接会话再次检查过期、空闲会话主动到期断开。

所有客户端和Nest监听器在测试结束关闭；每项之后确认连接登记清空。测试使用PGlite执行真实SQL语义，但网络通道是实际Socket.IO连接，而不是直接调用网关方法或假socket。

## 三场真实网络整局

check-room-service.mjs新增--sockets，复用原真实入场／初始化／采集／收尾／终局流程：

| 人数 | 完整回合 | 主要行动 | 验收 |
| --- | ---: | ---: | --- |
| 2 | 8 | 32 | 通过 |
| 3 | 8 | 48 | 通过 |
| 4 | 8 | 64 | 通过 |

467次玩家请求经真实WebSocket发送，84次可信转换经网关的服务端包装写入；81次成员视图核对和1556次单独推送均检查接收者、房间和严格递增版本，没有广播某一玩家的private给所有人。各场都真实执行入场、实际城市采集及八回合收尾，未注入经济、布局或完成历史；51张设施和每人30枚标记保持原守恒校验。

原始凭证只保留在本次检查进程的内存。关闭全部客户端／Nest应用，再关闭并重开同一PGlite文件数据库后，重新启动监听，三场都能用原凭证重新认证、订阅并得到相同终局版本及结果。日志只输出统计，不输出凭证原文。

默认引擎实际报告PostgreSQL18.6(PGlite0.5.12)，WASM目标。最终统计明确记录socketIoLoopbackChecked=true、persistedSessionReconnectChecked=true、realPostgresNetworkChecked=false。真实PostgreSQL模式只重建Pool，不停止外部数据库服务。

## 实现中修正与依赖

首次类型检查发现Nest IoAdapter声明要求完整ServerOptions，而Socket.IO构造器接收Partial；已改为按现有HTTP server／端口构造配置后的Socket.IO Server，无强制伪造完整类型，之后strict、真实网关与编译检查全部通过。最终审阅补充“SQL查询期间已到期”的拒绝，并增加相应测试；其后才运行最终43项、全量及编译检查，未在最终验证后修改代码。

新增固定依赖Nest websocket/platform-socket.io/platform-express12.2.0、socket.io及开发客户端4.8.4。逐项比较旧锁定包的version/resolved/integrity均不变；@types/node24.10.1、undici-types7.16.0因新增生产依赖链移除dev标记，版本和内容摘要未改，不能把这个元数据变化写成依赖升级或声称旧锁条目完全不变。

## 边界与后续

本批验证真实WebSocket传输及测试数据库上的会话／游戏恢复，**未运行原生PostgreSQL网络／行锁联调或用户服务器部署**。check:sockets:postgres已提供，要求显式专用NCO_TEST_DATABASE_URL，且只删除本次测试创建的房间及凭证摘要；本批未执行该命令。

签发／撤销仍是可信服务端方法，账户注册／登录／注销HTTP入口、房间大厅／邀请、自动阶段调度、跨实例推送总线、持久去重／outbox、UI/3D及部署均未完成。撤销阻止后续验证点的读取／操作，但不能回滚已经授权并提交的请求；断线后的未知提交结果须重新读状态。

## 原始证据

- [全量2368、strict与双包构建](sockets-2026-10-26/full-verify.log)
- [43项真实网络与会话定向](sockets-2026-10-26/targeted-43.log)
- [编译后3场网络整局及重开恢复](sockets-2026-10-26/compiled-sockets.log)

日志使用执行主机时钟，文档日期使用Asia/Shanghai。
