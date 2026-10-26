# 服务端房间与持久化基础 · 2026-10-26

基于main `9ab6f8f35e30efd4492e2b7ad7a2a51faf84462a`，新增独立工作区`@nomad-city-online/server`，沿用已批准的NestJS／PostgreSQL、服务器权威及单一GameState路线。项目及两个包仍为0.2.0；规则包、GameState格式、原静态JSON和Accepted ADR不变。本批不开放HTTP／WebSocket端口。

## 已实现的范围

| 部分 | 具体行为 |
| --- | --- |
| 房间记录 | 固定roomId、唯一gameId、完整GameDefinition、只保存一份GameState、不可变成员到玩家席位映射 |
| 创建 | 服务端可信provisioning；校验2–4名不同用户恰好覆盖游戏所有玩家；重复roomId或gameId返回false，绝不覆盖 |
| 成员识别 | 未来认证层提供authenticatedUserId，服务端按当前房间查playerId；请求体不能指定或覆盖身份 |
| 串行队列 | 同一RoomService中同房间顺序执行，其他房间可继续；失败释放队尾，不留下永久阻塞 |
| 持久化 | PostgreSQL JSONB记录、数据库版本约束及参数化SQL；条件UPDATE只有匹配expectedVersion时能写入 |
| 玩家提交 | 先按最新存档执行既有13通道接口，数据库确认写入后才返回成功reply及该用户自己的视图 |
| 可信转换 | setup／阶段开启／收尾／正式计分通过commitTrustedTransition，遵守同一队列及版本提交纪律 |
| 重连读取 | 从存储重新加载、验证，再根据成员映射生成本人视图；不依赖进程内游戏副本 |
| Nest接入 | RoomModule.register(sql)提供RoomService；应用上下文可真实启动／关闭，尚无监听器或登录端点 |

这是已经配齐席位的对局存储与服务层；大厅、邀请、准备、换座及账户登录尚未实现，不能把可信创建方法直接映射为任意客户端可调用的接口。成员映射在本批游戏创建后保持固定，因此不需要另一个可并发变化的成员账本。

## PostgreSQL存储

`packages/server/migrations/001-rooms.sql`创建`nco_rooms`。一行保存room_id/game_id/state_version/definition/members/state；game_id唯一，JSON游戏ID及版本必须与索引列匹配，版本限制在JavaScript安全整数范围。索引列是校验过的元数据，不是第二份经济或进度状态。

`PostgresRoomStore`仅提供create/read/compareAndSwap。提交前按原定义重新验证候选状态，要求版本恰好+1；写入只更新state和state_version，无法通过CAS改变房间成员或定义。所有动态值通过SQL参数传入，表／列名固定。

实际写入为单条条件语句：

```sql
UPDATE nco_rooms
SET state_version = $3, state = $4::jsonb
WHERE room_id = $1 AND state_version = $2
RETURNING room_id;
```

影响一行才算成功。进程内队列只负责本实例调度；不同实例仍由数据库版本条件决定胜负。冲突不自动重试旧选择，也不提前发送纯函数已经接受的候选结果。迁移是显式启动／管理步骤，不在每次玩家请求中运行；后续表结构变更需另加版本迁移，IF NOT EXISTS不负责修复外部修改的表结构。

数据库错误或连接中断时返回STORAGE_UNAVAILABLE。若连接在数据库已提交但确认尚未到达时断开，提交结果可能不确定；客户端应重新读取存档确认版本，而不是使用新版本自动重做。requestId仍只用于关联请求，没有实现持久化去重收据、跨进程网络exactly-once或广播outbox。

## 服务调用约定

生产连接使用node-postgres Pool，迁移和生命周期由未来主应用管理：

```typescript
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await migrateRoomStore(pool);
const app = await NestFactory.createApplicationContext(RoomModule.register(pool));
const rooms = app.get(RoomService);
```

主应用关闭时先停止接收请求、关闭Nest上下文，再关闭它拥有的Pool。本模块不会关闭外部注入的连接池，也不会在导入时启动迁移或监听端口。

- `readView(roomId, {authenticatedUserId})`：成功`{status:'ready', view}`；每次从已保存状态产生公开和本人私有部分。
- `submit(roomId, principal, unknownPayload)`：复用前一批严格游戏请求。成功`{status:'committed', reply, view}`；纯规则拒绝`{status:'rejected', reply}`；这些返回均不含原GameState或成员用户表。
- 存储／访问错误为`{status:'unavailable', error:{code}}`。ROOM_UNAVAILABLE统一表示无效身份、未知房间或无成员权限；STORAGE_UNAVAILABLE表示存储未能确认；COMMIT_CONFLICT表示该版本已被其他提交占用。
- principal和合法请求在入队前解析为独立对象，排队期间调用方修改旧对象不会更换席位或选择。
- `commitTrustedTransition(roomId, expectedVersion, synchronousCallback)`仅供服务端阶段调度；回调必须使用既有纯规则转换，不能作为前端提交任意状态的入口。未知规则／程序异常保留为服务端异常，没有伪造成功响应。

未来网关从认证会话构造principal。用户账户ID与游戏playerId是两种身份，可以不同；同一个用户在不同房间也可以映射到不同席位。单个玩家的返回视图不能作为全房广播；其他接收者须分别调用成员视图读取。

## 依赖与复现

新增服务端依赖固定为NestJS common/core 12.2.0、pg 8.23.1、reflect-metadata 0.2.2、rxjs 7.8.2；开发类型@types/pg 8.23.1。PGlite 0.5.12仅为根开发依赖，用于无外部数据库时的SQL／文件恢复测试，不是生产数据库替代品。Zod及既有开发依赖不升级，lock中旧依赖条目逐项保持不变。

```bash
npm ci
npm run verify
npm run check:rooms
```

根类型检查直接读取规则包源码；Vitest通过明确别名使用同一源码，因此干净克隆也不要求预先存在dist。构建顺序为game-core后server；SQL迁移保留在server/migrations，部署时须连同包一起复制。生产代码不导入测试数据库依赖。

默认check:rooms使用临时目录中的PGlite，完成2/3/4人各一场真实八回合、每次玩家／可信写入都实际保存，最后关闭并重开数据库检查终局恢复，清理本次创建的临时目录。它不是原生PostgreSQL的连接／行锁联调。

真实PostgreSQL验收命令：

```bash
NCO_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DEDICATED_TEST_DB' npm run check:rooms:postgres
```

仅对专用测试数据库执行：命令会创建nco_rooms，写入带随机ID的测试房间，结束时只删除本次创建的行；不会删除整表或其他房间。真实模式使用pg.Pool，末尾重建连接池检查重新连接，**不会重启PostgreSQL服务**。当前环境未提供可运行的原生PostgreSQL，以上真实模式尚未执行，不得把默认测试结果当作网络、跨进程行锁或生产部署证明。

## 验证与后续

本批实际全量2325/2325（原2288+新增37）、strict及两个包构建通过；37项服务／SQL测试包含真实Nest上下文、竞争、失败／恢复、输入隔离及数据库约束。默认编译检查实际3场八回合，467次玩家提交、84次可信转换、81次成员视图核对、文件数据库重开均通过。完整证据见[本批验证记录](testing/rooms-validation-2026-10-26.md)。

下一批先完成原生PostgreSQL连接／并发验收，再接会话认证映射、WebSocket网关及可信阶段自动调度。房间大厅／邀请策略、前端2.5D、Docker/Nginx部署仍待完成；普通设施牌堆耗尽及采集他人方案显示仍按既有待确认规则处理。

技术依据：[Nest动态模块](https://docs.nestjs.com/fundamentals/dynamic-modules)、[node-postgres参数化查询](https://node-postgres.com/features/queries)、[PostgreSQL并发与隔离](https://www.postgresql.org/docs/current/transaction-iso.html)。本批CAS只有一条写语句；未来多语句事务必须使用同一个数据库client，见[node-postgres事务说明](https://node-postgres.com/features/transactions)。


## 后续增量：本地Socket.IO与会话验证已接入

本文件正文保留房间基础批次的边界。后续同日已新增数据库会话摘要、真实网络握手／订阅／分别推送及重连；详见[Socket会话与网关](Socket-Sessions-2026-10-26.md)。账户登录和自动阶段调度仍未完成，原生PostgreSQL验收及部署仍未运行；PGlite与WebSocket网络验证分别表述。
