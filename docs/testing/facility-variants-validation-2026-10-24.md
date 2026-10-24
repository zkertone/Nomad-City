# 同名设施颜色版本 · 实际验证记录 · 2026-10-24

基线为GitHub main `a4ab6262f987019e428404db12ac715170ebb43d`，树 `e986c635bd3d90f5046aae2115a384d1f6f2c8bc`。逐个Git blob摘要核对本地182个基线文件一致后开始修改，原照片、数量、地图、事件数据及固定摘要不改。

## 定向检查

初次strict发现新测试误用核心分组名core-tower，改为现有core-command-tower；首次定向336项中334通过、2失败，分别是同一分组误名造成只计44张，以及额外建设候选误用constructionChoices字段。修正测试为constructionOptions.choices，无生产逻辑调整。修正后再次实际运行4个测试文件，336/336通过，40.51秒。strict也通过。

覆盖三种新颜色资源厂的资源/金券两种支付、印刷分数与入场奖励；不同颜色同名卡计2色/同色不同名卡计1色；全部48实体覆盖；三色延伸候选、无额外收费补牌、保存恢复、重复拒绝与跨回合；跨颜色能源复制、工程营候选与额外建设；旧存档与现有拒绝约束保留。原颜色拒绝断言按新确认改为成功、不能支付或错误来源，不删除相应边界用例。

## 全量与编译包

实际 `npm run verify` 退出0：严格TypeScript检查、1810/1810测试（23文件，86.28秒）与构建均通过。原1794+新增16，无最终失败/跳过，没有调整严格性、超时或worker数。

编译remaining-facilities脚本扩为33段真实2/3/4人流程：原18段保留，新增红/蓝延伸及三种新颜色资源厂各3人数组合。所有花费来自真实入场及三回合角色收入，保留保存恢复、重放拒绝、两轮主要行动、采集/收尾和实体守恒；不注入资源。


最终构建后19项编译检查全部实际退出0。remaining-facilities扩展的33段真实2/3/4人流程通过（71.36秒）；红/蓝延伸与三种新颜色资源厂分别从真实收入走完建设、恢复、两轮主要行动、采集和下一回合，无额外行动额度。其余地图/事件/游戏/入场/探索/移动/影响力/角色/雷蛇/回合/采集/计分/设施检查均保留并通过。

| 编译检查 | 退出码 | 秒 |
| --- | ---: | ---: |
| check-city-move | 0 | 1.82 |
| check-construction | 0 | 2.97 |
| check-entry | 0 | 1.27 |
| check-events | 0 | 0.35 |
| check-exploration | 0 | 1.27 |
| check-facilities | 0 | 0.34 |
| check-facility-entries | 0 | 9.97 |
| check-game | 0 | 0.39 |
| check-harvest | 0 | 1.66 |
| check-influence | 0 | 1.27 |
| check-liskarm | 0 | 3.37 |
| check-maps | 0 | 0.2 |
| check-remaining-facilities | 0 | 71.36 |
| check-role-effects | 0 | 6.1 |
| check-role-schemes | 0 | 6.66 |
| check-rounds | 0 | 20.85 |
| check-scoring | 0 | 1.69 |
| check-settlement | 0 | 1.74 |
| check-warehouse | 0 | 5.87 |


提交授权：2026-10-24负责人明确回复“批准提交”，授权将本批19份已验证变更提交至公开仓库zkertone/Nomad-City的main。此前自动审核要求具体目标授权，现已取得。
