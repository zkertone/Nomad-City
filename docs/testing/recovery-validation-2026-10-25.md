# 开发会话恢复复验 · 2026-10-25

核对基准为 GitHub main `c790987551f34b5b317aa32e05928ff2b721b576`，最新保留源码为其后32份修改、5份新增。本地保护提交 `40a3ce5be8e2117556b1a53e10e495766a8140b5` 的214份文件与被测保留源码逐一校验一致。没有重写或新增游戏逻辑，没有修改依赖、静态数据、摘要、ADR或测试配置。

## 实际执行

环境：Node v24.22.1、npm 11.9.0；Asia/Shanghai 2026-10-25。测试日志的启动时钟来自执行环境，不用它推定用户当地时间。

| 对象 | 命令 | 实际结果 |
| --- | --- | --- |
| main基准（1.14.0） | npm run verify | 退出0；strict、2087/2087（27文件，Vitest 67.11秒）、build通过 |
| 恢复源码（1.15.0） | npm run verify | 退出0；strict、2145/2145（28文件，Vitest 66.14秒）、build通过 |
| 恢复源码编译包 | 构建后逐一运行package.json的23项check命令对应node脚本 | 23/23退出0，脚本执行合计183.90秒 |

编译构建只执行一次，随后执行每项check命令中实际的Node脚本，没有为每个脚本重复编译。完整原始输出保留在同名子目录；没有把23项脚本再加进2145项Vitest测试总数。

首次新检出目录曾在检查中出现跟踪文件回到1.14.0而新增文件仍为1.15.0的混合副本，导致构建失败及一项脚本退出1；该混合副本不是有效开发快照，不作为上述业务验证结论。随后改在完整复制、独立依赖并逐文件核对的恢复源码目录执行全部23项检查，未修改生产规则或放宽断言；下表为最终有效结果。

| 编译包检查 | 退出码 | 秒 |
| --- | ---: | ---: |
| check:maps | 0 | 0.15 |
| check:events | 0 | 0.21 |
| check:game | 0 | 0.27 |
| check:entry | 0 | 0.54 |
| check:settlement | 0 | 1.14 |
| check:exploration | 0 | 0.69 |
| check:city-move | 0 | 0.76 |
| check:influence | 0 | 0.82 |
| check:harvest | 0 | 1.02 |
| check:scoring | 0 | 0.97 |
| check:schemes | 0 | 4.77 |
| check:liskarm | 0 | 2.19 |
| check:roles | 0 | 4.21 |
| check:rounds | 0 | 12.36 |
| check:construction | 0 | 0.74 |
| check:warehouse | 0 | 3.84 |
| check:remaining-facilities | 0 | 49.42 |
| check:facility-entries | 0 | 7.94 |
| check:pattern-major-actions | 0 | 31.24 |
| check:pattern-continuations | 0 | 35.14 |
| check:pattern-actions | 0 | 25.00 |
| check:patterns | 0 | 0.22 |
| check:facilities | 0 | 0.26 |

新增check:pattern-major-actions覆盖源石工业中枢、核心商业区、拓荒指挥中枢×2/3/4人共9段真实入场、收入、建设、宣告、子行动、保存及收尾流程。原有22项检查保留。没有UI、网络、持久化服务或部署验证。

## 恢复边界

远端仅main，无标签、开放PR或开放Issue，Actions运行记录为空；本轮结果来自本地实际执行，不是GitHub CI。现有回合finished仅表示8回合调度停止，正式最终计分提交尚未实现。三档玩法×人数只完成目录筛选，不能报告九个可运行组合。

GitHub远端创建恢复检查点的操作被自动审批拒绝，理由为当前审计请求未明确授权发布本地变更。本轮保留本地提交、Git bundle与可审阅差异，没有更新远端分支。
