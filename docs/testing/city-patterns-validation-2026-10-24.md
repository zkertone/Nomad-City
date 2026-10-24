# 城市样式资料与图案匹配 · 实际验证 · 2026-10-24

## 基线与范围

代码基线为GitHub main 2eb9ed56039e86ae74a558e53efe2ac84b0f0160。新增15张资料、风味、玩法/人数筛选、可信4+2抽选、图案匹配及只读宣告预检；不修改GameState，不执行宣告与特殊行动。

三份新附件的SHA-256已逐个从原字节复核，与catalog.json中身份/摘要一致。固定内容摘要为sha256:f18485ebafb5bb04792c2804428a095c81ee9a2052b34cfc54d7583053041e33。规则及风味来源分开，正式名称复合动力系统已获用户确认，submittedName保留之前输入的错字。

## 实际测试

- 首次npm run typecheck退出0。
- 首次单文件定向：135/135通过，0.496秒。
- 追加真实面板预检后，typecheck及2文件定向全部退出0：152/152，0.446秒。
- 最终npm run verify退出0：严格类型、1962/1962（25文件，50.20秒）、构建全部通过，原1810+新增152。

新增用例从照片独立记录15种图案/分数/等级，不从生产目录生成预期图案；覆盖四个方向、平移、边界不换行、禁止镜像、双色备选、单个虹色不能充当多个设施、已用牌、稀疏/对角布局允许额外设施、精确实体集合、拒绝重复/伪造格位、目录篡改即使重算自报hash也拒绝、三档与2/3/4人筛选及4+2抽选、错误来源/身份/版本/标记不足。预检实际交叉校验2/3/4人库存与面板，并证明输入不变、无行动授予。

未修改原测试断言、超时、worker或严格类型设置。初稿图标解释在正式数据完成前复核修正，不存在为了通过测试而改动官方图案或原设施/地图/事件数据。

## 编译包

最终构建后20项编译检查实际全部退出0。新check:patterns验证根/子路径导出、15张资料及风味、九组合目录筛选、4+2抽选、虹色/已用牌/实体匹配；输出明确catalog-filter-only。原19项流程全部保留并通过，不将其计为城市样式的权威结算测试。


| 编译检查 | 退出码 | 秒 |
| --- | ---: | ---: |
| check-city-move | 0 | 0.94 |
| check-construction | 0 | 0.85 |
| check-entry | 0 | 0.62 |
| check-events | 0 | 0.2 |
| check-exploration | 0 | 0.82 |
| check-facilities | 0 | 0.34 |
| check-facility-entries | 0 | 6.6 |
| check-game | 0 | 0.25 |
| check-harvest | 0 | 1.05 |
| check-influence | 0 | 0.88 |
| check-liskarm | 0 | 2.27 |
| check-maps | 0 | 0.14 |
| check-patterns | 0 | 0.21 |
| check-remaining-facilities | 0 | 44.98 |
| check-role-effects | 0 | 4.62 |
| check-role-schemes | 0 | 5.25 |
| check-rounds | 0 | 12.08 |
| check-scoring | 0 | 1.02 |
| check-settlement | 0 | 1.02 |
| check-warehouse | 0 | 3.88 |
