# 建设与设施入场界面验证 · 2026-10-28

基准main0174f7ff17ad8e6afcb73328d00c2f4827a5cbcb。业务日期按用户Asia/Shanghai，原始记录保留宿主时钟。最终命令均已结束并退出0，没有浏览器点击／截图／视觉验收。

## 实际执行

| 命令 | 真实结果 | 原始记录 |
| --- | --- | --- |
| 初始服务端严格检查 | union属性未收窄，退出2；改为原类型的in判断 | [initial-union-types-failure.log](construction-ui-2026-10-28/initial-union-types-failure.log) |
| 首次UI严格检查 | readonly数组与原可变Schema类型不匹配，退出2；从原指令Schema派生输入类型 | [readonly-types-failure.log](construction-ui-2026-10-28/readonly-types-failure.log) |
| 新增夹具类型检查 | 可选余额索引、展开联合对象丢失关联，退出2；改用明确资产类型及原Schema解析 | [fixture-types-failure.log](construction-ui-2026-10-28/fixture-types-failure.log) |
| 修正后npm run typecheck | 退出0 | [corrected-types.log](construction-ui-2026-10-28/corrected-types.log) |
| action-options定向 | **69/69，21.10秒，退出0** | [initial-targeted.log](construction-ui-2026-10-28/initial-targeted.log) |
| action-options＋sockets＋client | **176/176，21.32秒，退出0** | [targeted.log](construction-ui-2026-10-28/targeted.log) |
| npm run verify（再补旧仓库不可能探索用例） | **39文件／2593全部通过，79.22秒，strict与三包构建退出0** | [full-verify.log](construction-ui-2026-10-28/full-verify.log) |
| 最终web严格检查／构建 | 退出0，52模块，JS316.98kB／gzip97.53kB | [final-web-check.log](construction-ui-2026-10-28/final-web-check.log) |
| node scripts/check-local-web.mjs | 原大厅／入场／准备／部署／调度PASS，退出0 | [compiled-local-web.log](construction-ui-2026-10-28/compiled-local-web.log) |
| node scripts/check-travel-web.mjs | 原探索／移城恢复PASS，退出0 | [compiled-travel-web.log](construction-ui-2026-10-28/compiled-travel-web.log) |
| node scripts/check-construction-web.mjs | 新六场建设及入场恢复PASS，退出0 | [compiled-construction-web.log](construction-ui-2026-10-28/compiled-construction-web.log) |

原2554保留，新增39=32候选／入场＋3网络＋4客户端。三文件定向176=69候选＋82网络＋25客户端；之后新补的旧仓库无目标分支1项进入最终全量（候选文件70项），不能把未执行的定向177写成已通过。未放宽strict或取消原规则断言。

全量类型检查之后仅补较早格式无法deferred-entry时的页面错误说明，最终web严格检查／构建再通过，三个独立编译脚本随后使用同一最终bundle。之后只补文档与日志，没有新的实现修改。

## 已验证行为

- 2／3／4人当前基础局原准备后，返回公开六张供应、真实本人4×3逻辑格位和11个空格，非操作者options=null。原报价与预览一致，预览前后原始快照相同，不发模拟补牌／牌序／对手暗牌／物理标记ID。
- 全部17类普通设施逐类经原deferred-entry构造：实际付费、实体牌转移、补六张、摆放、印刷分数及真实入场状态。为逐类覆盖所用的充足余额／供应顺序为明确隔离夹具，**不代表此前实际对局收入或历史回合**；真实收入的编译流程见下。
- 原拒绝保持：入场收益不能垫付、唯一设施、格位／来源、普通牌堆耗尽和版本上限。唯一设施第二次拒绝在真实第一轮结束／他人行动／本人第二轮中检查，候选失败不改变保存状态。
- 仓库放置后移动同一新标记、不增主要行动；嵌套探索沿用原完整路径报价、事件与末尾查询。旧warehouseEntry分支／事件／末尾可恢复，无任何可执行探索时只按原命令跳过，不强造路径。
- 免费移城费用0，事件、目标点末尾和之后附加航道标记分开，父建设直到全部子步骤完毕才complete。
- 追加建设重新付原成本／补牌／格位，同一主要行动不另开额度；复制仅原邻接非虹色目标，不重复支付或印刷分数；物流用原延伸库存免费摆放或明确放弃。
- 五资源分配、强制尽量移除、对手城市标记替换后的不能放置、按原3／3／4／15出售全部经原reducer检查，不复制另一套结算。
- 真实网关construction-preview：前后认证、成员／缺失房间等价、身份／不支持通道注入拒绝、数据库安全错误、查询中撤销后丢弃响应、无查询写入。网络实际建设用已存在1.7手动夹具逐步调用原升级并各CAS至1.12，没有给未知旧局编造历史；下面六场为原自动工厂1.16新局。
- 客户端三原通道和当前view版本正确，旧版本／换房／失效预览丢弃，写入拒绝／超时不重发或接受候选视图。严格Schema重排对象字段时，按内容的选择键仍匹配；改变选择或数组顺序会使旧预览失效。React组件选择键和effect保护已实施，未实际浏览器点击验证。

## 最终编译流程

旧check-local-web保留所有HTTP／身份守卫／默认生产无fixture／bundle分离及三场45行动写入（9部署／5调度）和恢复检查。旧check-travel-web再次通过三场48行动写入、四次重开及12个旅行阶段检查点。

新增check-construction-web使用可信工厂提供六个确定性**新局**（仓库／动力系统各2／3／4人），初始牌序由可信夹具提供，不向玩家暴露设置接口：

- 全部真实入场／准备，p1盖德克萨斯并经原role通道实际循环一张供应取得12金券，起始10→22。没有注入余额或假设施。角色页面尚未接入，该收入是脚本主动经原服务器指令取得，不能冒充网页点击完成。
- 六次原报价及建设：仓库付9、动力系统付20金券，实体牌补至六张，按报价加印刷分，保存子进度；没有用未来收益付款。
- 首次整体重开恢复仓库分支及免费移城ready；之后三次仓库探索／三次免费移城，确认普通路费／城市位置及免费不扣源石。
- 所有六场在事件前重开，选择实际已揭事件，再在末尾放置前重开；六次末尾放置后，三仓库complete、三动力系统仍待额外航道标记，再重开核对，最后三次额外放置后各自明确结束行动轮到p2。
- **108玩家写入、60自动初始化写入、6角色收入、6建设、6事件、6末尾放置、3航道放置、4次整体服务／文件库重启、24个保存局面恢复检查点**。各成员专属视图／版本／候选完全一致，每人30枚标记守恒，没有重付／重复补牌／加分或提前结束父行动。

以上是第一回合的选定行动，不是本批完整八回合；独立旧八回合脚本未逐一重跑，原规则／网络测试仍在全量中执行。PGlite是测试用WASM PostgreSQL，不能代替原生PostgreSQL、跨进程和部署验收；未连接用户服务器。原始日志不含凭证，测试临时库退出后关闭删除，不影响dev:local保留对局。

规则实现、原始数据／摘要、存档和依赖未改；game-core仅新增原quoteExplorationStep的公开导出，供可信服务对保存子进度只读报价。角色／城市样式、采集／清理／终局页面和2.5D仍待完成。没有再次尝试或绕过此前浏览器策略，点击／视觉验收未完成。
