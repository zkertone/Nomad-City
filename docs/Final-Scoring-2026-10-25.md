# 正式终局计分与八回合验收

范围：项目基础版2/3/4人，已初始化GameState1.16.0的51张设施新局。第8回合全部行动、采集及收尾完成后，由可信调用方提交一次正式计分，返回终局专用1.17.0。现有1.0.0–1.16.0读取能力保留，不向旧48张库存或旧局补造缺失历史。

## 规则复核

本轮重新渲染并阅读原《铸基者》规则书印刷p10、p12、p23，文件SHA-256为`6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42`。

- 8回合结束前，先结算收尾效果、复位样式标记、传递起始玩家并推进回合。雷蛇实际选择未结清时不能计分。
- 当前已得分加区块控制分、剩余资源分。资源点/航道标记各计1影响力，城市额外计2；唯一最多者获得区块分，并列无人获该区块分。
- 各资源分别按完整组计分：至纯源石1、异铁6、源石8、源岩9换1分，不合并余数。金券不直接计分。
- 总分相同，依次比较剩余金券、剩余至纯源石；仍相同则共同胜利。两人非起始玩家的初始3分已经在当前score中，不重复加入。

上述计算复用现有已验证预览，未改变地图、已确认规则或任何卡牌数值。计分保留资源余额，特别是同分判定要用的金券和至纯源石，不再扣除换分资源。

## 一次提交与终局专用格式

```typescript
import { finishManagedRound, finalizeBaseGame, getFinalScoringResult } from '@nomad-city-online/game-core/game';

// 此前已经完成第8回合全部主要行动、采集与必要的玩家收尾选择。
const afterCleanup = finishManagedRound(state, definition, { expectedVersion: state.stateVersion });
const finalState = finalizeBaseGame(afterCleanup, definition, { expectedVersion: afterCleanup.stateVersion });
const result = getFinalScoringResult(finalState, definition);
```

`finalizeBaseGame`是可信服务器流程，不是允许玩家上传分数的命令。参数只接受expectedVersion；由服务器计算分数、控制者和赢家，拒绝额外points/winners/gameId等字段。必须是已完成全部收尾的1.16.0：第8回合finished、无未用盖放角色或待处理义务、Ⅰ级样式已复位、特殊行动冷却已清空、无子行动/入场/事件续接。

成功将区块及资源分同时加到每名玩家唯一的score，版本只增加1，格式成为1.17.0。棋盘、资源、实体牌、标记、角色、牌堆和样式次数保持不变。Ⅱ级整局次数不重新补充。过早调用、重放、重复结算、格式错误、版本或安全整数溢出均不返回部分修改。

终局新增`finalScoring`作为只读结算依据：

| 字段 | 含义 |
| --- | --- |
| schemaVersion | 结算依据格式1.0.0 |
| sourceSnapshotVersion | 原局格式1.16.0 |
| sourceStateVersion | 本次提交之前的版本，必须恰为当前版本减1 |
| scoreBeforeByPlayer | 全部实际玩家的计分前分数 |

没有保存第二套权威余额或控制表，也不保存可被改写的赢家缓存。存档校验按当前棋盘和资源重新计算各分项，要求当前score恰好等于计分前分数加正确奖励；同时核对收尾状态、玩家集合、格式和提交版本。畸形终局数据返回验证失败，不由未知样式引用导致内部异常。

1.17.0只允许在第8回合finished状态存在。所有正常行动、角色、样式、采集、再次收尾及重复最终计分都拒绝；恢复后同样拒绝。原有早期finished格式仍可读取，但不能据此自动伪造新局配置并进入正式计分。

## 结果与公开投影

`getFinalScoringResult`只接受正式提交后的状态，返回：

- gameId、stateVersion、completedRounds=8及计分来源版本。
- 每名玩家的existingPoints、regionPoints、resources明细、totalPoints，以及用于同分比较的剩余金券/至纯源石。
- 区块实际影响力和控制者、winnerPlayerIds、resolvedBy。
- 按总分→金券→至纯源石降序排列的rankingGroups；同组不再区分先后，不额外使用座次或颜色打破平局，也不自行创造官方数字名次规则。

结果深度冻结，可JSON保存。没有事件暗牌序、角色手牌、标记身份或设置参数。`getRoundPublicView`在正式终局时附带同一finalResult；原注册玩家检查继续保留。

**终局展示、重连和导出应读取getFinalScoringResult。** 原getBaseScoringPreview仍是任意给定局面的只读附加分预览，不应把已经加过最终奖励的当前位置再次交给预览来生成最终结果。正式结果用结算依据中的原始分数复核，不重复加分。

## 实际验收与下一阶段

命令：`npm run verify`、`npm run check:final-scoring`。完整实际结果、早期夹具修正和日志见[验证记录](testing/final-scoring-validation-2026-10-25.md)。

本批完成基础2/3/4人八回合至正式终局的选定流程验收，不代表穷举所有策略组合或完整联机产品。普通设施牌堆耗尽的未确认规则、完整三档玩法、整局公开视图、身份认证、数据库串行/CAS提交、重连服务和2.5D UI仍在后续范围。纯函数版本检查不等于跨进程的 exactly-once 存储保证。
