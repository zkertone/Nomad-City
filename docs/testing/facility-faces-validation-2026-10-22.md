# 基础设施卡面转录验证 · 2026-10-22

> 最新更新：用户原文与图标含义补齐后，实际定向测试 **148/148（2 个文件）**、strict 检查、构建和四项相关编译包检查通过。下面早先的 905 全量回归属于 1.0.0 转录版本历史，不是本次重跑结果；最新执行明细见文末。

## 实际运行环境与范围

Node v24.19.0、npm 11.9.0、TypeScript 5.9.3、Zod 4.6.7、Vitest 5.0.4；依赖和锁文件未变。沿用现有最多 4 个 Vitest 文件并发、单项 30 秒设置，没有为本次测试更改超时或游戏断言。

新增 faces.test.ts **47** 项：18 张图片卡面的名称/颜色/分数/成本逐项独立预期，分颜色实体数量隔离，资源组合中的金券、替代支付、未印费用、负分、基础/扩展边界、唯一与入场标识、只有图标的效果、重复图标及选择关系、合计资源/相邻条件、缺字进度、不可变性、未知 ID、严格 Schema、来源引用/重复 ID、有限整数/空字段/未知图标、版本、规范化、Unicode 和含重新计算自报摘要的篡改。

测试预期是独立的 AI 读图复录；测试通过证明代码与该转录基准一致，不能替代负责人确认新文本，不能证明尚未实现的行动规则合法。

## 初次运行与修正

1. 生产模块初次 `npm run typecheck` 退出 0；加入新测试后再次 strict 类型检查退出 0。
2. `npm test -- packages/game-core/src/facilities`：2 个文件，**99/100，1 失败**，9.02 秒。失败在进度统计的测试预期：移除一条不能可靠辨认的风味片段后，数据实际为部分 4 / 待辨认 13，预期仍写成部分 5 / 待辨认 12。修正预期为真实保留的数据；没有补猜文本、删除失败用例或更改规则去凑结果。

## 最终验证

执行 `npm run verify`（strict 类型检查 → 全量 Vitest → 构建），**退出 0**。

```text
Test Files  12 passed (12)
     Tests  905 passed (905)
Start at    23:30:03 UTC
Duration    107.56s
```

905 = 原游戏/地图/事件等 805 + 已更正数量/版别测试 53 + 本次卡面测试 47。设施两文件合计 100 项包含于本次全量回归，未把先前运行重复计入数量；最终无失败。

构建后实际执行下列编译包检查，均退出 0：

```sh
node scripts/check-facilities.mjs
node scripts/check-maps.mjs
node scripts/check-events.mjs
node scripts/check-game.mjs
```

设施检查实际从包的根路径和 `/facilities` 导入，验证数量目录及新卡面目录、-1 分、未印费用、版别过滤、不可用于开局状态、重新计算自报摘要后的篡改拒绝，输出如下进度：

```json
{"totalPicturedFaces":18,"printedScores":18,"printedCostAlternatives":16,"costNotPrinted":2,"effects":{"transcribed":16,"partial":2,"unreadable":0},"flavor":{"transcribed":1,"partial":4,"unreadable":13},"executionReady":false,"reviewStatus":"ai-transcribed-awaiting-review"}
```

三张原图实际 `sha256sum` 与接收记录一致。卡面内容摘要：`sha256:2b8220fa4df10ad8c949b43720d38bd61b27269e4179b021e7bcdcbd32cc9e21`；数量目录摘要保持 `sha256:935420d88b603f20333ef399c4968f98e72ab30c41d715cf145f1380889b5e7d`。地图和事件编译检查输出原有摘要，对局检查验证 2/3/4 人初始化及标记守恒。

## 未测试/未实现

设施建设/费用扣除/入场效果/设施计分执行、形状/布局匹配、跨颜色版本等同性、实际设施牌库、角色/城市样式、整局收尾、UI/网络均不在本次实现中。2 张效果区部分可读、17 张风味未完整；新增转录等待核对，不能称完整设施规则引擎。npm 的 http-proxy 环境配置告警没有导致命令失败，未据此变更依赖。


## 用户原文与行动图标更新 · 最新验证

本次接收负责人 18 份风味全文及联邦理事处、核心指挥塔的完整说明。18 份风味按用户文本逐字保存，包含引号、六个英文句点及原措辞；两处效果不再列为部分。其他图片转录没有因此自动提升成用户确认。

更正佣兵指挥部红绿双箭头为替换影响力；为 11 个视觉 token 添加带规则书页码的语义词典和只读可读效果查询。区分单个移动影响力和完整调度两次移动；保留护航的两次移除、载具仓库选择关系、免费城市移动及建设图标。没有开放行动窗口、扣除费用或执行设施效果。

格式更新为 2.0.0，SHA 协议更新为 nco-facility-faces-c14n-v2，将新逐字段来源、用户全文、规则书身份、图标含义及页码纳入固定基准。当前摘要 `sha256:840edd051e9c8a97377a0419cf64d663b35d68a2fcd861b5f288560ac6ab614e`。旧格式明确拒绝，不静默迁移为用户确认。

### 实际执行

- 增量过程中首次 `npm run typecheck` 退出 2：测试文件已加入 4 个新导入/用户文本常量，但相应测试尚未追加，触发 4 个 unused 声明错误。补齐对应测试后最终 strict 检查退出 0；没有关闭 noUnused 选项。
- `npm test -- packages/game-core/src/facilities` **退出 0，148/148，2 个文件，7.65 秒**。数量 53 + 卡面 95；卡面原 47 更新来源格式并新增 48 项用户全文/图标语义/来源校验测试，没有减少此前用例。此轮测试无失败。
- 最终 `npm run typecheck && npm run build` **退出 0**。
- 构建后实际运行 `node scripts/check-facilities.mjs`、`node scripts/check-maps.mjs`、`node scripts/check-events.mjs`、`node scripts/check-game.mjs`，**全部退出 0**。涵盖根/设施子路径新函数导入、替换图标、单个移动、用户全文、初始位置说明、原地图/事件摘要及对局初始化守恒。
- 规则书 PDF 实测 SHA-256 与 rulesSource 一致：`6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42`。

最新编译进度 effects={transcribed:18,partial:0,unreadable:0}、flavor={transcribed:18,partial:0,unreadable:0}、reviewStatus=mixed-source-transcription、executionReady=false。本轮未重跑全量游戏测试，不报告 953 项通过；此前 905 项回归仅为历史。设施执行、跨颜色等同性、布局/牌库和完整回合仍待实现，不以纯文本或语义查询冒充已执行游戏规则。
