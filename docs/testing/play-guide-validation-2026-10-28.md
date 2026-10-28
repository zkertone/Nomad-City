# 2D操作指引与反馈验证 · 2026-10-28

基准main81d92b2c27d49f156128ebbb7c50e1550b08afde。业务日期按Asia/Shanghai，日志保留原时钟。本阶段不推进2.5D；人工双人整局、实际浏览器点击／跳转／键盘／窄屏视觉仍待执行。

## 实际执行

| 命令 | 结果 | 原始记录 |
| --- | --- | --- |
| 初始npm run typecheck | 通过、退出0 | [initial-types.log](play-guide-2026-10-28/initial-types.log) |
| 新展示夹具strict | 退出2：采集候选派生类型原本错误排除了null，另有测试对象展开未保留必填字段；显式可空合同及已知对象断言修正 | [fixture-contract-types-failure.log](play-guide-2026-10-28/fixture-contract-types-failure.log) |
| 原客户端与结果语义复验 | **36/36，2.35秒，退出0** | [client-regression.log](play-guide-2026-10-28/client-regression.log) |
| 修正后npm run typecheck | 通过、退出0，保持strict | [corrected-types.log](play-guide-2026-10-28/corrected-types.log) |
| 指引＋客户端＋结果标记＋采集候选四文件 | **84/84，7.23秒，退出0**（22＋37＋5＋20） | [targeted.log](play-guide-2026-10-28/targeted.log) |
| 首次npm run verify | 执行环境exec-server连接中断；仅保留测试开始前输出，没有完成结果或退出码，不算通过 | [interrupted-verify.log](play-guide-2026-10-28/interrupted-verify.log)、[runtime-interruption.log](play-guide-2026-10-28/runtime-interruption.log) |
| 恢复后完整npm run verify | **43文件2713/2713，138.41秒，strict／三包构建，退出0** | [full-verify.log](play-guide-2026-10-28/full-verify.log) |
| 最终编译check-local-web | **PASS，退出0** | [compiled-local-web.log](play-guide-2026-10-28/compiled-local-web.log) |
| 最终编译check-harvest-web | **PASS，退出0** | [compiled-harvest-web.log](play-guide-2026-10-28/compiled-harvest-web.log) |

原2685保留，新28=22展示指引／语义＋6客户端反馈／会话并发。最终2713／43文件。没有为了展示测试放宽采集规则：未提交方案在运行时一直是null，本批仅让派生类型明确反映它；原有效成员网络输出不变。

## 已覆盖行为

- 指引只接受同房间／对局／版本的候选；过期／缺失时提示同步，不显示可执行结束指引。非当前玩家只见公开操作者等待文案，不使用私有检索／角色选择。busy与断线提示不触发提交。
- 入场起点、绿色事件与奖励、双人移供应和盖角色分别提示当前选择；准备页与主决策页有独立页内定位。普通主要行动、探索路径／已揭事件／末尾放置、设施免费移城／追加建设／入场、样式额外航道／显式子行动完成与结束行动轮的提示优先级逐项验证。
- 采集不套用单actor权限，每个未提交玩家都提示规划；本人已提交时仍提示可修改。最终清理未完成不会显示正式终局，只有真实public.finalResult才提示结束。
- Node React序列化验证可读的aria-live状态、操作区链接、只读指引无提交按钮；资源概览从公开标记显示实际资源量、同点多个城邦和未揭资源。使用明确展示数据夹具，不代表相应局面实际发生，也不等于浏览器跳转／排版／视觉通过。
- 客户端收到成功回执后保留最新视图并显示保存确认；后续候选读取超时／失败只提示同步，不把原写入报成失败或重发。拒绝与无确认回执不显示成功、不接受候选视图。
- 一项UI操作在途时，第二意图等待同一结果且不执行、不排队；忙碌状态直到首项完成。换房后旧错误／反馈丢弃，会话撤销后不恢复旧反馈；旧会话的延迟意图在执行前取消。原过期候选和身份守卫测试保留。
- 运行环境断开后重新核对文件都在，先创建本地保护检查点，再重新执行全量；未丢弃或覆盖之前各批检查点，未将中断日志视为成功。

## 最终编译与人工边界

原check-local-web复验HTTP资源、本地身份守卫、默认生产无fixture、浏览器bundle无服务运行时和三场45主要行动写入（9部署／5调度）及恢复。原check-harvest-web复验2／3／4人各八回合，485玩家／105自动写入、78采集提交（含6次本人替换）、6预期拒绝、3本人清理、三次整体Nest／PGlite文件库重开，恢复9个局面／27份个人视图和相同正式结果。两命令均PASS、退出0。原角色／旅行／建设独立脚本本批未逐一重跑，相关回归仍在全量中保留。

编译检查是原Socket.IO协议／HTTP及PGlite文件库恢复流程，不实际执行浏览器中的PlayGuide或点击指令；展示路径由独立语义与控制器测试验证。PGlite是WASM测试数据库，不能代替原生PostgreSQL网络或跨进程验收；临时库退出后关闭删除，不影响dev:local保存局面。

[双人试玩单](../playtests/Two-Player-Local-2026-10-28.md)给出本机两身份、32个玩家行动轮、角色／设施条件覆盖、本人采集修改、错误／断线和终局恢复及问题记录格式；其人工状态仍为**待执行**，遇不到的卡型记未覆盖。原生PostgreSQL、正式账户、部署与规则待确认项未推进，未连接用户服务器。

此前浏览器预览已被环境策略拒绝，本批未再次尝试或绕过，未使用其它浏览器／headless方式替代。代码、测试和本机试玩准备已完成不表示人工整局通过。原game-core、规则资料／摘要、GameState、ADR、package及依赖锁不变。
