# 剩余基础设施实际验证 · 2026-10-23

已设计、已实现、已测试；本轮没有UI、联网、数据库提交或部署。源码工作区 `/workspace/scratch/a56cdbc0831a/nomad-city-dev`；交付沿用GitHub仓库 `zkertone/Nomad-City`，基准main提交 `62935e9849b97485f417444047bde9e0632dfcf5`。

## 环境及输入

Node24.19.0、npm11.9.0、TypeScript5.9.3 strict、Zod4.6.7、Vitest5.0.4。使用既有锁文件和依赖，未调整测试超时、maxWorkers、Schema宽松度或类型检查选项。原地图、事件、设施数量/卡面/库存/面板JSON及摘要未改。规则书SHA-256实际复核 `6b87c026e317606de2324276ff117480b8e104f5b925a21d43b95af176ddbf42`。

## 真实执行过程

1. 初次抽取城市移动共享步骤后strict发现残留current变量引用；随后strict发现草稿中已取消的route-influence分支和冗余TypeScript收窄比较。修正局部代码后strict退出0。
2. 初次定向测试在收集阶段失败，0项运行：state语义校验与继续命令模块的循环初始化导致construction命令Schema尚未定义。将只读规则查询移至facility-entry-rules.ts，语义校验仅依赖该模块，消除运行时初始化依赖；不是跳过测试或改成动态宽松Schema。
3. 再次定向 `npm test -- packages/game-core/src/game/remaining-facilities.test.ts` 实际63/65、2失败（20.70秒）。两个失败均为测试夹具：误用不存在的CP-1-4等面板格；错误假定A-01与E-01直接相邻。按静态面板/地图清单改为真实格位，以及从D-02经F-route-02尝试关闭的F-01。没有修改规则事实来迎合测试。
4. 第一轮全量 `npm run verify` 退出0：strict、1770/1770（23文件、52.81秒）、build通过。
5. 补齐所有已知设施的补牌后延后选择及边界测试；一轮verify在strict发现已被外层排除的deferred-entry冗余比较，移除该比较后verify退出0：1787/1787（55.27秒）、strict/build通过。
6. 加入旧仓库中途升级、损坏面板验证和真实雷蛇收尾交叉回归，verify退出0：1792/1792（54.27秒）。继续补齐确实无可移动目的地、不可负担的已存探索，收紧内部导出边界并移除不必要类型断言，才进行最终验证。

最终实际命令：

```bash
npm run verify
```

**退出0：TypeScript strict → Vitest 1794/1794（23文件、60.01秒）→ 构建全部通过。** 原1705项保留，本批新增89项；最终0失败、0跳过、0超时，没有删掉失败用例或放宽不变式。现有能力断言更新为16普通类型/38张；旧格式对原“未支持设施”的拒绝现改为FACILITY_FORMAT，旧1.6.0满面板夹具继续只放该格式支持的设施。

## 新增行为与反向覆盖

- 五种普通设施两套准确费用、负分、唯一建设边界；只实现已拍颜色及1张黄延伸，不推定5张缺失卡面。
- 物流可拒绝、实际预留区拿黄延伸、-1分、普通市场/牌堆不受额外影响；错误颜色/来源/格位/分数下溢原子拒绝。
- 工程营真实额外付费/补牌/入场、可建刚补出的牌、不可用未来奖励垫付、满面板不可能时结束。父进度只占一个主要行动，不能重复授予。
- 工程营→物流→延伸、工程营→仓库→正常付费探索→事件→末尾、工程营→能源→复制仓库多层保存恢复/完成回收。子步骤失败不撤销已提交父事实，不局部提交错误子步骤。
- 能源复制三种冶炼/提纯收益、资源分配、物流、仓库、完整动力；不重复费用/拿牌/印刷分数；不将工业自折扣当入场。不合法虹色/斜角/其他玩家/不存在目标拒绝。
- 免费移动保留2/3/4人真实地图、独立航道、红区/城市限制、选定范围清除及原所有者标记归还；事件/正常目标末尾/额外航道严格顺序，已探索不重发事件、满航道保留本人标记、空库存不造标记。真实相邻都被城市占据时没有虚构“经过航道”。
- 理事处只改本回合末传递，不改变当前顺序/起始双角色权限；不同玩家最后实际建成覆盖先前，按原环形顺序旋转并清空记录。建设后角色退休旧进度仍保留记录，雷蛇真实收尾未完成时不能提前传递。
- 1.11→1.12中途仓库原样继续、不重扣/重抽；父子/来源/角色/身份/对局/版本、伪造完成、错误存档格式、损坏面板/重复实体、查询与命令阶段、重复提交及溢出反向测试。

## 编译后的真实流程

最终构建后共19项脚本全部真实退出0，4路并发只读执行，每项输出独立记录；不是只检查模块是否能import。此前一次19项也全部通过，最终源码修改后重新运行本表全部脚本。

| 命令 | 退出码 | 耗时（秒） |
| --- | ---: | ---: |
| `node scripts/check-city-move.mjs` | 0 | 1.00 |
| `node scripts/check-construction.mjs` | 0 | 0.94 |
| `node scripts/check-entry.mjs` | 0 | 0.66 |
| `node scripts/check-events.mjs` | 0 | 0.22 |
| `node scripts/check-exploration.mjs` | 0 | 0.95 |
| `node scripts/check-facilities.mjs` | 0 | 0.33 |
| `node scripts/check-facility-entries.mjs` | 0 | 8.52 |
| `node scripts/check-game.mjs` | 0 | 0.28 |
| `node scripts/check-harvest.mjs` | 0 | 1.56 |
| `node scripts/check-influence.mjs` | 0 | 1.06 |
| `node scripts/check-liskarm.mjs` | 0 | 2.49 |
| `node scripts/check-maps.mjs` | 0 | 0.16 |
| `node scripts/check-remaining-facilities.mjs` | 0 | 32.24 |
| `node scripts/check-role-effects.mjs` | 0 | 5.86 |
| `node scripts/check-role-schemes.mjs` | 0 | 6.92 |
| `node scripts/check-rounds.mjs` | 0 | 15.56 |
| `node scripts/check-scoring.mjs` | 0 | 1.44 |
| `node scripts/check-settlement.mjs` | 0 | 1.48 |
| `node scripts/check-warehouse.mjs` | 0 | 5.29 |

新remaining-facilities脚本对2/3/4人各运行6种情景，共18段真实对局：物流→黄延伸、完整免费移城、工程营→物流→黄延伸、工程营→仓库付费探索、先建电铲后建能源复制新奖励、理事处本回合末取得起始标记。每段都实际入场、3个回合收入/角色恢复、两轮主要行动、采集、保存恢复、重放拒绝和进入第4回合。

没有注入资金、资源、标记或旧角色历史。本人资金完全来自入场10＋首回合德克萨斯12＋第二回合出售实际3源石9＋第三回合锡人回收前2角色各5＝41金券。最终6类分别剩17/21/9/22/8/24金券，2/3/4人一致；普通/延伸实体守恒、全体每人30标记守恒。能源情景使用第3回合两次正常主要行动，先付10建电铲并在补牌后选5资源，再付23建能源复制5资源；没有凭空增加建设额度。


## 复现与限制

```bash
npm ci
npm run verify
npm run check:remaining-facilities
```

完整脚本命令均保存在package.json；其余编译检查可按下表node命令运行。没有GitHub部署、网页运行或浏览器UI验证。库级鉴权上下文测试不代表实现了网络认证/数据库CAS。

待完成：5张未拍颜色（蓝铁厂、黄源石厂、红源岩厂、红/蓝延伸）、普通设施牌堆耗尽、城市样式、最终计分提交和完整公开视图。allFacilitiesImplemented仍false，不将已拍卡面全部完成说成整个基础版桌游已经可玩。
