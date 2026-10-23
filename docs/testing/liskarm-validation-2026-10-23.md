# 雷蛇策略、计谋与收尾验证 · 2026-10-23

## 来源与范围

实际复读规则书20230803印刷p10/p13/p14与雷蛇原卡：顺序放置两次、任意本人影响力的收尾移除、条件支付3金券、先移除后同槽尝试放置、不能在对手城市资源点放置。PDF摘要重新实测6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42。

新增1.9.0显式升级和cleanup选择，保留旧五角色模式/格式。全角色完成仍false，当前7/10模式。本轮不是完整延迟效果通用引擎。

## 实际命令与结果

环境沿用Node24.19.0/npm11.9.0、TS5.9.3、Zod4.6.7、Vitest5.0.4；strict设置、maxWorkers/testTimeout与依赖锁未改。

1. 初次生产 `npm run typecheck` **退出0**。
2. 加入测试后的typecheck **退出2**，两类辅助代码问题：将自定义双参数错误构造器标成标准ErrorConstructor，以及通过只读GameState查询辅助函数取得篡改测试对象。改为具体错误构造器联合及从Zod可变测试副本直接取得引用，没有禁用检查/使用any或删除断言。
3. 修正后类型检查不再报告错误，定向 `npm test -- packages/game-core/src/game/liskarm.test.ts` **44/44，1文件，12.87秒，退出0**。
4. 增加5项兼容历史、最后槽位、both放弃费用、真实调度后位置与旧入口防绕过用例后，最终实际 `npm run verify` **退出0**：strict→全量Vitest→构建完成。

```text
Test Files  19 passed (19)
     Tests  1488 passed (1488)
Duration    32.13s
```

1488 = 既有1439 + 本次49。所有Vitest用例无失败/跳过/超时/中断。既有role-effects.test.ts保持90项，只更新能力5→7、雷蛇支持标志及旧1.8.0用雷蛇的拒绝理由ROLE_FORMAT；没有移除反向用例或放宽其他规则。既有角色编译检查也仅更新全局能力数量断言，原五模式仍完整执行。

构建后实际执行以下15项，全部 **退出0**：

```sh
node scripts/check-liskarm.mjs
node scripts/check-role-effects.mjs
node scripts/check-rounds.mjs
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

新增npm check:liskarm组合构建与检查；本轮实际按上述已构建后node执行。

新编译流程从根与/game包实际加载，对2/3/4人分别从真实入场和原收入开始：升级1.9.0→全员盖放→p1策略放2枚→p2支付3金券替换其中1枚→真实完成两轮主要行动→全员采集→直接收尾拒绝→打开cleanup→p1选择移除剩余1枚→下一回合。保存/加载待选择状态，旧版本重放拒绝，p1最初的供应标记集合最终全部恢复；每人30标记守恒。没有伪造资源或待结算记录来通过编译流程。

## 49项新增测试

- 2/3/4人显式升级且状态/历史不重置，重复与错误版本拒绝；真实既有角色使用记录升级后不丢弃牌历史。
- 每种人数策略使用两枚真实库存标记，准确注册单个收尾义务、不改资源/设施/行动额度。必须完整选择可执行放置，拒绝重复/占格/未探索/对手城市/多余目标。
- 只剩一个供应标记、完全没有供应、合法槽全满、第一步填满最后合法槽时逐次尽量执行；仍登记收尾，不能主动丢弃仍可执行的步骤。
- 替换按3金券→归还原所有者→同槽放本人执行；对手城市仅移除、本人供应空时不创造新标记、替换本人先归还可再用；条件放弃、支付后无可移除目标的情况。
- 缺目标/空目标/不足费用/选择种类错误原子拒绝；起始玩家both按顺序仅弃一次，后段失败回滚放置，放弃费用仍保留策略义务；非起始玩家不可both。
- 2/3/4人采集后直接完成收尾被阻止，玩家可选之前已有的标记而非新放的两个；移除恰好1个、归还供给、全部结算后才轮转起始玩家。
- 三个玩家独立义务按当前顺时针顺序选择；不能越过其他人，结算一人后仍不能略过剩余玩家。
- 真实对手角色计谋依次替换掉全部本人影响力后，收尾才按无法执行自动跳过；旧直接finish与显式cleanup结果一致。
- 采集未完成不可开始cleanup，计谋单用不产生策略义务；待处理义务JSON恢复、标记实际调度后按新位置选择。
- 对局/版本/本人/目标/溢出/覆盖字段与重复命令保护，公开来源义务、不泄露其他盖放牌；6种延迟记录/旧格式篡改拒绝；所有旧窗口入口不能绕过收尾。

## 未实现/未测试

极境/德克萨斯/坎诺特计谋、任意多效果选择顺序、城市样式/特殊行动、全部设施/未拍颜色、普通耗尽规则、最终计分、完整公开整局状态、认证/网络/数据库跨进程提交仍待完成。纯函数防旧版本不是数据库CAS；新增cleanup不是全部游戏效果总线。原静态JSON/摘要、GameDefinition、Accepted ADR及依赖不变，无UI/3D、部署或发布。
