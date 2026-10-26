# 会话凭证与Socket.IO房间网关 · 2026-10-26

基于main `d8d3871d3012550bc9f59e08c4192ffc6adb6c04`。沿用NestJS／Socket.IO／PostgreSQL、服务器权威和既有单一GameState。本批接入真实本地网络握手、成员订阅、玩家提交、分别推送及重连；账户注册／登录页面、公开房间大厅、自动阶段调度及部署仍待完成。游戏规则、game-core源码、静态资料／摘要、存档格式和项目0.2.0不变。

## 会话与身份

`SessionService.issue(userId, ttlMs)`仅供**已经确认用户身份的可信服务端代码**调用；没有允许浏览器指定userId获取凭证的接口。后续密码登录或其他身份提供者成功后接入这个签发接口，本批没有选择或实现账户登录方案。

- 凭证由Node crypto的32字节安全随机数生成，为43字符base64url字符串；数据库只保存SHA-256摘要，不保存明文凭证。
- 默认有效期8小时，可信签发调用可选正整数TTL，最多7天。到期边界拒绝；查询期间到期同样不返回已过期会话。
- `resolve(unknownToken)`从数据库恢复userId及expiresAt；`revoke(token)`删除该凭证摘要，独立凭证互不影响。迁移在`002-sessions.sql`，与对局存档分开，不把登录身份加入游戏经济状态。
- 每次连接握手、事件处理及状态推送前重新验证。空闲连接有到期定时器；撤销凭证在该连接下一次事件或推送时生效，不能继续获取后续视图。
- 撤销与游戏提交不是同一个数据库事务；已经获得授权并开始处理的请求可能完成。提交后确认丢失时仍需重新读状态，不能承诺网络exactly-once。

凭证原文属于客户端秘密，只在可信签发结果中给出。通过Socket.IO auth发送，不放URL查询参数、房间消息、广播、日志或游戏快照。生产环境仍需HTTPS/WSS；本批测试仅监听127.0.0.1随机端口。

## 应用与连接

`createRoomSocketApplication({sql, allowedOrigins, sessionClock?})`创建已配置Nest应用，但不迁移数据库、不签发凭证、不创建房间，也不开始监听。主应用明确管理数据库连接、迁移和生命周期：

```typescript
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrateRoomStore(pool);
await migrateSessionStore(pool);
const app = await createRoomSocketApplication({
  sql: pool,
  allowedOrigins: ['https://game.example.com'],
});
await app.listen(3000, '127.0.0.1');
// 停机时先app.close()，再关闭主应用自己拥有的pool。
```

客户端使用Socket.IO 4.x的websocket transport及`/game`命名空间：

```typescript
const socket = io(`${serverUrl}/game`, {
  transports: ['websocket'],
  auth: { protocolVersion: '1.0.0', sessionToken },
});
const result = await socket.emitWithAck('room:subscribe', { roomId });
```

握手auth为严格对象，只接受protocolVersion及sessionToken。伪造用户／席位、未知协议版本、失效凭证拒绝。认证数据库异常只给固定AUTH_UNAVAILABLE；不返回原SQL异常。Origin须精确匹配配置中的规范HTTP(S) origin，禁止通配符或包含路径的值；引擎和命名空间均检查。凭证始终承担身份验证，Origin限制不代替凭证。

本批固定单包上限64KiB、每连接最多8个房间订阅，取消订阅释放名额。Socket.IO自动连接状态恢复保持关闭；重连重新握手和订阅，不复用旧socket.id作为用户身份。

## 消息合同

| 方向／事件 | 数据与行为 |
| --- | --- |
| 客户端 room:subscribe | 严格`{roomId}`；从已保存状态检查成员后返回RoomReadResult，并为该连接登记订阅、发送当前room:state |
| 客户端 room:command | 严格`{roomId,request}`；request复用原13通道严格Schema；身份只来自会话映射；返回RoomSubmitResult |
| 客户端 room:unsubscribe | 严格`{roomId}`；移除该连接订阅，返回`{status:'unsubscribed',roomId}` |
| 服务端 room:state | `{protocolVersion:'1.0.0',roomId,view}`；view是这个接收者自己的GamePlayerView |
| 服务端 room:unavailable | 指定房间读取／推送失败的安全错误；该连接需重新订阅恢复 |
| 服务端 session:invalidated | AUTH_REQUIRED或AUTH_UNAVAILABLE，随后断开连接；失效连接不保证还有消息ack |

传输层错误使用`{status:'unavailable',error:{code}}`，代码为INVALID_MESSAGE／AUTH_REQUIRED／AUTH_UNAVAILABLE／SERVER_UNAVAILABLE／SUBSCRIPTION_LIMIT。正常房间与规则错误保留原服务层合同。Origin、超大包或底层连接错误也可能表现为Socket.IO的connect_error／disconnect；前端不能只依赖某个固定错误字符串。

## 提交和分别推送

RoomGateway按房间串行安排订阅、玩家提交、可信阶段提交及推送。它调用既有RoomService，只有SQL条件写入确认成功后才推送；失败或冲突没有候选状态推送。每个订阅者分别检查会话、成员资格并读取本人视图，禁止将一个玩家的private广播全房。

每个连接每个房间保存最后推送版本，只发送严格更高的版本；再次订阅即使不产生重复推送，ack仍给当前视图。客户端也应按gameId／stateVersion接纳状态图像，忽略过期或重复视图，避免较晚到达的ack覆盖更高版本。网络JSON在客户端是客户端自己的数据对象，不宣称跨网络后仍具有服务端Object.freeze性质。

可信setup／收尾／计分通过`RoomGateway.commitTrustedTransition(...)`包装既有服务层CAS，成功后刷新订阅者；该方法没有客户端事件入口。直接绕过网关调用存储的外部写入不会自动通知连接。本批**仅单实例网关推送**，跨实例广播总线、持久化outbox及消息可靠重放尚未实现；数据库CAS仍防止版本写入冲突。

断线恢复依赖已保存GameState和会话摘要：重新连接后再订阅，读取当前已提交版本。没有把客户端旧快照作为权威状态恢复，也不会重做终局计分。签发／撤销只提供可信服务端方法，尚无账户登录或注销HTTP端点；过期会话记录维护清理、登录入口和前端凭证管理在后续范围。

## 复现与实际证据

新增依赖固定为@nestjs/websockets、platform-socket.io、platform-express 12.2.0及socket.io 4.8.4；socket.io-client 4.8.4是根开发依赖。启用TypeScript传统装饰器，通过显式Inject注入，不依赖测试转换器生成design metadata。既有锁定包版本／地址／完整性摘要不变；@types/node及undici-types的dev标记因新增Socket.IO依赖链被npm提升，未升级版本。

```bash
npm ci
npm run verify
npm run check:sockets
# 专用原生PostgreSQL环境才执行：
NCO_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DEDICATED_TEST_DB' npm run check:sockets:postgres
```

check:sockets复用上一批三场真实八回合夹具，467次玩家请求全部经过实际loopback Socket.IO，84次可信写入走网关包装，81次成员视图核对，并检查1556次按接收者区分的递增状态推送。关闭网关和PGlite文件数据库后重开，原会话凭证仍能认证并重新订阅相同终局。脚本关闭全部客户端和监听器；真实PostgreSQL模式只清理本次随机房间和签发的凭证摘要。

本批全量2368/2368（原2325+新增43）、strict和双包构建通过。默认数据库仍为测试用PGlite；真实WebSocket网络已验证，但原生PostgreSQL网络／行锁联调和用户服务器部署仍未执行。详见[本批验证记录](testing/sockets-validation-2026-10-26.md)。

技术依据：[Nest网关与ack](https://docs.nestjs.com/websockets/gateways)、[Socket.IO握手中间件](https://socket.io/docs/v4/middlewares/)、[Socket.IO服务端选项](https://socket.io/docs/v4/server-options/)。连接中间件只在握手时运行，本实现另在事件及推送前主动重新验证会话。


## 后续增量：明确新基础局的自动阶段推进

本文件正文保留网关批次边界。后续已接入可信新局工厂和自动调度；新自动房间外层消息可带automatic状态，玩家成功reply版本与随后视图版本可能不同。广播改为readCommittedView纯读取，授权订阅可恢复未完成自动边界并通知其他成员。历史手动房间保持原合同；详见[自动基础局说明](Automatic-Base-Lifecycle-2026-10-26.md)。
