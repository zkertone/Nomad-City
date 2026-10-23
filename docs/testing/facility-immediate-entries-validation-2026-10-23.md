# 三种即时设施入场效果验证 · 2026-10-23

## 实际环境与范围

Node24.19.0/npm11.9.0，TypeScript5.9.3 strict、Zod4.6.7、Vitest5.0.4；依赖/锁、测试超时和并发均未改。实际查看原设施照片、规则书印刷p06–07/p13及已确认语义，沿用p14替换定义。规则书SHA-256重新实测6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42，卡面固定基准未改。

本轮新增护航调度中心/佣兵指挥部/贸易街区完整入场，扩至10种/23张已拍颜色实体；无嵌套效果、状态格式迁移或扩展规则。

## 实际执行

1. 初次生产 `npm run typecheck` **退出0**。
2. 加入71项新测试及能力断言后，再次 `npm run typecheck` **退出0**。
3. 定向命令 **退出0**，首轮即全部通过：

```sh
npm test -- packages/game-core/src/game/facility-entries.test.ts packages/game-core/src/facilities/construction.test.ts
```

```text
Test Files  2 passed (2)
     Tests  156 passed (156)
Duration    16.46s
```

156=原内部建设85+新增71；既有85项完整保留，能力改为10/23，原9项拒绝用例中新增三种设施改为断言缺失必要entryChoice时报ENTRY_CHOICE，其余仍断言UNSUPPORTED_ENTRY_EFFECT。没有删除反向断言或绕过未实现效果。

4. 全量实际 `npm run verify` **退出0**，strict→Vitest→构建全部完成：

```text
Test Files  21 passed (21)
     Tests  1629 passed (1629)
Duration    40.92s
```

1629=既有1558+本次71。全部用例无失败/跳过/超时/中断，本轮没有需修复的类型、Vitest或编译检查失败。角色替换/出售抽取公共内部原语后，既有角色、雷蛇和全部动作回归仍通过，未放宽Schema。

## 编译包检查

构建后实际执行下列17条命令，全部 **退出0**：

```sh
node scripts/check-facility-entries.mjs
node scripts/check-role-schemes.mjs
node scripts/check-role-effects.mjs
node scripts/check-liskarm.mjs
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

新增 `npm run check:facility-entries` 组合构建和新检查；本轮实际按上方已构建后node执行。既有check-facilities仅更新支持范围断言，原静态数据/摘要及建设检查保留。

新脚本实际从根、/game、/facilities加载接口，对2/3/4人各执行三种设施，共9段真实流程：

1. 真实入场，p1使用G03:1获得3源石和原10金券；两人移牌保留目标设施，所有玩家实际盖放。
2. 第一轮p1主要行动部署1枚，p2雷蛇策略放2枚并登记真实收尾义务；其余人依序行动。
3. 第二轮p1先用德克萨斯策略获得12金券并完成市场置底/补牌，当前实际资金22，然后主要行动建设。
4. 护航调度中心付18并移除p2两枚，剩4；佣兵指挥部付18、替换p2一枚、得印刷1分，剩4；贸易街区付6、出售实际持有3源石得9，剩25。不注入额外资金或标记。
5. 报价不改输入、建设一次原子提交、旧版本及已完成窗口再建拒绝；供应6张、revision及面板正确，JSON恢复。
6. 完成其余主要行动与全部采集。佣兵/贸易情形p2仍有标记，直接收尾被阻止，再实际选择雷蛇移除；护航已移除其全部标记，才自动跳过不可能的收尾。
7. 每段均进入第2回合、起始玩家变p2、新设施保留有效、每人30标记守恒。原1.6.0/1.7.0/1.8.0/1.9.0各编译脚本也继续通过。

## 71项新增覆盖

- 支持10类型/23实体的逐项数量、源摘要固定；报价entryChoiceKind/费用、不可变、无最终选择也可查询；错误选择种类/目标格式/数量/分支的运行时Schema拒绝。
- 护航2/3/4人两次按序实际归还原所有者；0/1个可执行情况跳过，剩余可移除标记不能主动不选；重复/空/多余第二目标失败整次回滚；对手城市、红区关联航道可移除，城市与其他槽保持不变。
- 佣兵2/3/4人替换只收建设费、自己/对手均可移除；对手城市仅移除、本人供应耗尽不造标记、替换本人先归还可复用；0目标两分支跳过，可执行目标必须提供；不能同时两分支或覆盖费用。
- 贸易四种独立单价、多种同时售卖/全0、仅本人余额变化、实际销售回执；资源/金券支付后的剩余库存校验，未来收入不能垫付造价，不能超卖或自动缩量；乘法、总额、最终余额溢出整次回滚，客户端单价/收款人/收入/任意跳过字段拒绝。
- 三设施独立核对资源组合、金券替代与印刷分数；付款/实体/补牌/摆放/分数/入场在一个版本提交，原输入冻结/保存恢复、旧请求/第二次建设拒绝。
- 身份/对局/版本、覆盖actor、计分/供应标记目标；未实现和未拍颜色继续拒绝。
- 真实1.6.0–1.10.0现有格式均可继续建设，不添加新设施效果账本；2/3/4人建设后使用角色、结清主要行动进度、两轮行动、采集及下一回合保持设施与版本有效。

单元测试明确使用资金/库存边界夹具，不宣称其由入场获得；新编译流程单独验证无注入的真实收益及动作。所有数据JSON、内容摘要、已确认规则全文、GameDefinition/存档格式、项目版本、依赖锁及Accepted ADR不变。

## 尚未测试或完成

未实现嵌套探索/建设/复制/延迟设施、未拍颜色、城市样式/特殊行动、普通设施牌堆耗尽、最终计分提交、完整公开整局状态、认证/网络/数据库CAS。不因本轮原子纯函数测试通过宣称完整可玩或跨进程防重。无UI/3D、部署或对外发布。
