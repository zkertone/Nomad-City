# 建设窗口验证 · 2026-10-23

## 范围与环境

验证 GameState 1.6.0 接入现有7类/15张匹配照片颜色的建设、一个可信授权窗口、玩家命令边界及跨行动保留。规则书p07再次实读；没有新增或推断费用、扩展、角色优惠、完整回合次数规则。原静态JSON与固定摘要保持不变。

Node24.19.0、npm11.9.0、TypeScript5.9.3、Zod4.6.7、Vitest5.0.4，strict配置及依赖锁未修改。npm提示既有环境http-proxy配置警告，不影响本次命令退出状态。

## 已实际执行

1. 初次生产代码 `npm run typecheck` **退出0**；加入首批测试后再次typecheck **退出0**。
2. 首次 `npm test -- packages/game-core/src/game/construction.test.ts` **66/70，4失败，6.99秒，退出1**。失败均为夹具：第二次建设的供应中未放支持牌；采集窗口多传actorId（影响两项）；空调度被规则自动完成，却误断言仍阻塞新窗口。修正为显式支持牌序、独立采集参数、先实际部署再开启待执行调度，未放宽命令/次数检查。
3. 再次同一定向命令 **70/70，7.50秒，退出0**。
4. 补充5项测试后，首次 `npm run verify` **strict通过，Vitest1276/1277（16文件），1失败，16.89秒，退出1**，因此构建未运行。探索夹具使用随机事件牌序，却假定第一个选项无前置支付，导致有时触发COST_DECISION。改用显式固定事件牌序，并通过现有要求查询补齐支付决定和必要影响力选择。没有改变生产洗牌或事件规则。
5. 最终实际 `npm run verify` **退出0**，strict类型→全量Vitest→构建全部完成：

```text
Test Files  16 passed (16)
     Tests  1277 passed (1277)
Duration    14.31s
```

1277 = 既有1202 + 本轮75；本轮game/construction.test.ts共75项。最终无失败、跳过、超时或中断测试。类型检查未关闭、反向断言未删除、既有用例未改写。

最终构建后实际执行以下12项，全部 **退出0**：

```sh
node scripts/check-construction.mjs
node scripts/check-facilities.mjs
node scripts/check-maps.mjs
node scripts/check-events.mjs
node scripts/check-game.mjs
node scripts/check-entry.mjs
node scripts/check-settlement.mjs
node scripts/check-exploration.mjs
node scripts/check-city-move.mjs
node scripts/check-influence.mjs
node scripts/check-harvest.mjs
node scripts/check-scoring.mjs
```

新增编译检查从根路径和/game子路径加载：真实2/3/4人入场后，用明确资金夹具和服务器牌序初始化设施，建设30金券行政区、得3分、补牌6/暗牌34、供应与面板各revision+1；验证输入不变、错误玩家/旧版本/同窗口二次建设拒绝、JSON恢复和切换部署时设施保留。资金夹具不声称来自入场收入。新增npm脚本 `npm run check:construction` 将构建与该检查组合；本轮上述命令按“已完成构建后node执行”实际运行。

## 75项新增测试覆盖

- 2/3/4人真实入场后初始化、核心分配、事件牌堆/顺序/棋盘和30枚标记账本保留；已完成旧格式行动也可由可信方显式初始化设施。
- 7类建设均正式提交到GameState，资源和金券支付、开采电铲选择、计分/补牌/归属/位置/版本同时推进，其他玩家不变；不同玩家及数组倒序时身份仍正确。
- 报价只读、成本从当前快照重算；授予一次只成功一次，旧命令与更新版本后的重复执行分别拒绝；下一次需另行可信授予。
- 错误对局、全局版本、玩家、牌源、占格、未拍颜色、复杂效果、缺费、非法选择、全局/面板/供应版本、得分与入场余额溢出，均保留输入及未用额度。
- 10种客户端覆盖字段、4类无效命令、失败后正常重试、重复唯一设施、耗尽牌堆、报价身份及版本保护。
- 不得绕过未完成入场、探索、移动、部署、实际待执行调度和采集；不得重新分配已有设施、回退回合或重置事件牌堆。
- 实际建设→部署→调度→采集→下一回合；建设→探索/事件/最终放置；建设→城市移动/事件/最终放置；各节点设施都保留且1.6.0快照有效。
- 缺失设施、降级格式、第二份余额视图、阶段冲突、伪造计数/所建牌/玩家、引用摘要错误、错误归属/对局、丢失实体；非建设阶段同样检查设施守恒；满面板拒绝新授予。

## 实际限制

验证的是纯函数在最新权威快照上的一次授权和事务式返回。没有实现或测试跨进程/数据库提交、网络认证、整局角色顺序与两轮额度、优惠、复杂入场、未拍颜色、官方耗尽处理、整局公开投影、UI/3D/联机。旧状态按原格式读，不自动修补未知设施历史；全局设施executionReady和readyForDeckSetup仍为false。
