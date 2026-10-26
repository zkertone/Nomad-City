# 基础局启动与自动阶段推进 · 2026-10-26

基于main `fa746344117689333d774dbd693e259b228729d6`，复用已有纯规则转换、房间CAS和Socket.IO网关。本批实现**可信新基础局创建到正式终局的自动调度**；没有修改游戏规则、GameDefinition、GameState格式、原始数据／摘要、Accepted ADR、依赖或项目0.2.0版本。

## 新局创建与可恢复设置

`createAutomaticBaseRoomSnapshot(input)`是可信服务端工厂，返回需要整体交给`store.create`保存的RoomSnapshot。它要求明确的roomId/gameId、2–4名玩家、完整账户到席位映射、顺时针席位和起始玩家，不替负责人决定先手规则：

```typescript
const room = createAutomaticBaseRoomSnapshot({
  roomId, gameId, players, members,
  startingPlayerId, clockwisePlayerIds,
});
if (!await store.create(room)) throw new Error('Room or game already exists');
```

初始GameState为真实beginEntry生成的1.1.0，等待玩家入场。创建时使用安全随机源生成项目基础44张普通设施牌序、适用人数黄／红事件序和基础样式完整抽选序，作为不可变`lifecycle`设置与初始状态在同一SQL插入中保存。绿色事件由beginEntry一次抽选并保存于既有入场状态。恢复时使用原计划，不重新洗牌；活跃牌堆、余额、棋盘、标记、角色及样式轨道仍只以GameState为准。

工厂接受的可选`setupOrders`仅为可信调试／验收提供完整排列；不接受未知牌、重复／遗漏、错误人数事件或企业样式，不能映射为浏览器选项。工厂输出包含私人初始牌序，**不能直接作为前端房间响应**；玩家只获取既有成员视图及安全调度状态。

## 自动步骤与玩家选择

| 已保存状态 | 自动执行／停止位置 |
| --- | --- |
| 入场选择、绿色事件、两人额外影响力尚未结束 | 等待对应玩家，绝不代选 |
| 全部入场真正完成 | beginRoundFlow及既有能力初始化，逐步到1.16.0项目基础51张库存；在第一次角色／移牌选择前完成 |
| 两人移牌／角色盖放 | 等待当前玩家；不替玩家选择公开设施或角色 |
| 玩家主要行动、角色、样式、事件及设施续接 | 继续由原13通道验证；不自动结束行动轮或代选子步骤 |
| 全体两轮行动都已明确结束 | 自动开启本轮采集 |
| 采集方案尚未齐备 | 等待各玩家，可按原规则修改本人方案；不自动提交空方案 |
| 所有采集真实结算完成 | 调用既有openManagedCleanup，只有原规则判定真正不可执行的移除才跳过 |
| 雷蛇清理有合法目标 | 等待当前清理所有者提交实际目标，即使目标唯一也不代选 |
| 清理全部完成／没有可执行义务 | finishManagedRound：原角色回收、样式重置、先手传递和下一回合照原规则执行 |
| 第8回合真实收尾完成 | finalizeBaseGame一次性转为1.17.0；之后读取不再计分 |

主要行动完成后仍允许玩家使用合法角色／宣告样式，因此`finish-player-turn`保持显式玩家指令；样式额外行动及所有嵌套进度也不由调度器跳过。本批没有自动操作机器人、超时托管或默认策略，也没有推断普通设施牌堆耗尽的缺失规则。

## 持久化与恢复

迁移`003-automatic-lifecycle.sql`给nco_rooms增加可空JSONB lifecycle；migrateRoomStore显式执行001和003，独立会话迁移002不受影响。历史房间列为NULL，继续手动调度，读取时不会静默升级。自动模式只由可信新局工厂选择；尚无给玩家修改模式或上传快照的接口。

本批服务理解两类房间。新的自动房间依赖lifecycle元数据，不能用旧版本服务接管其启动过程；备份／恢复应保存整条房间记录，而非仅取GameState。普通CAS只修改state及state_version，不能修改成员、定义或设置计划。

所有自动转换复用既有核心函数，每步各加1版本并CAS确认。完成入场后的初始化共10步；普通回合的开采集／开清理／收尾各一步，最后另加正式计分。单次恢复最多16步；正常流程在玩家选择或终局前停止，不存在循环自动打完整局。

进程中断后，已确认的每一步可独立读取和验证；1.7.0–1.15.0只允许尚无角色／移牌／建设决策的初始化状态携带自动配置，不能给活跃旧48张库存补造初始化历史。授权成员重新读取／订阅时继续未完成步骤。不同实例用数据库版本条件竞争，不自动重试旧玩家命令或重做已提交动作。

## 服务与网络合同

- `RoomService.readView`：对自动房间，授权后会尝试恢复已到达的自动边界，再返回最后确认的成员视图；不再是所有房间都纯读取的方法。
- `readCommittedView`：只观察已保存事实，绝不推进。广播专用这个方法，避免发送视图时又产生新写入或偷偷重试自动失败。
- `submit`：先完成可执行的自动步骤，再校验玩家命令；保存玩家动作后尝试下一自动边界。
- 玩家保存／规则拒绝的原reply合同保持。自动房间的外层响应与room:state可额外包含`automatic`；手动房间省略此字段，原合同保持。

```json
{
  "automatic": {
    "status": "waiting-for-player",
    "stateVersion": 25
  }
}
```

status为waiting-for-player／finished／pending。pending可附STORAGE_UNAVAILABLE／COMMIT_CONFLICT／AUTOMATION_BLOCKED／AUTOMATION_LIMIT，均为安全码，不含牌序或原异常。未确认候选不会出现在view中。

**成功reply.stateVersion是玩家本次写入版本；view.public.stateVersion可能更高**，因为随后又完成了服务端转换。客户端下一条指令应使用最新视图版本，仍按版本忽略过期／重复状态。

如果玩家写入已确认、后续自动写入失败，返回仍为committed及该玩家的成功reply，同时automatic=pending；不能谎称玩家动作未保存。客户端重新订阅恢复，不能因此使用新版本重复相同选择。若自动步骤在玩家命令之前尚未确认，则返回AUTOMATION_PENDING，玩家动作不会执行。存储确认丢失依旧可能造成未知提交结果，应读取当前状态，尚无持久化requestId去重／网络exactly-once。

授权订阅如果恢复了状态，网关会通知同实例其他成员；逐接收者分别检查会话并生成本人视图，保持递增版本。广播读取不推进。进程没有后台扫描所有房间：离线中断的自动边界会在授权重连／读取时恢复；正常在线对局由每次成功命令自动继续。

## 验证与复现

```bash
npm ci
npm run verify
npm run check:automatic-rooms
# 显式专用原生数据库环境才运行：
NCO_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DEDICATED_TEST_DB' npm run check:automatic-rooms:postgres
```

实际2401/2401（原2368+32项调度+1项网络恢复）及strict／双包构建通过。调度32项、完整网络文件44项分别通过。新编译检查从可信创建初始记录开始，玩家仅经真实Socket.IO提交选择，**没有手动调用任何阶段转换**：2/3/4人各完整八回合，共479次玩家提交、105次自动写入和1532次成员专属推送。

每场第8回合实际使用雷蛇并等待本人清理；移除A区标记后正式区块分减少3，且关闭服务／PGlite数据库后凭原会话恢复相同终局，无重复计分。单元测试的最终回合隔离夹具不冒充八回合历史，完整流程证据在编译检查。详见[实际验证记录](testing/automatic-lifecycle-validation-2026-10-26.md)。

当前数据库验收仍使用PGlite测试引擎；原生PostgreSQL网络／行锁、多实例广播、账户登录／房间大厅与正式部署未执行或尚未实现。企业／企业家完整玩法、普通设施牌堆耗尽和采集他人方案显示继续按原待办处理。
