# TraeTask_260329_006 实施记录（Workflow Upgrade：两层制与重任务瘦身）

## 范围确认

- 仅修改三大文档真源：
  - `rules/rules/WORKFLOW.md`
  - `rules/rules/PROJECT_RULES.md`
  - `rules/rules/PROJECT_MASTER_PLAN.md`
- 未修改业务代码、未修改 verify 业务测试脚本、未修改 UI。

## 本次落地内容

- 保留两层口径：仅“轻任务 / 重任务”，明确禁止新增 T1/T2/T3。
- 重任务瘦身规则落地：
  - 中途禁止反复 Integrate；
  - 完整 gate 前强制 Fast Gate；
  - 默认证据最小提交集进 PR（完整 evidence 仍允许生成）。
- mandatory 收口落地：
  - 轻任务 mandatory 四项；
  - 重任务 mandatory 六项（含 first_break_layer / Fail->Pass / real runtime / 不回退项 / healthcheck / 收尾链）。
- 新增最小验证硬规则：
  - 非纯测试任务必须做与任务相关的最小验证；
  - 修复任务至少 1 组 Fail->Pass；
  - 涉及运行语义必须至少 1 组 real runtime 样本。
- 即刻生效：
  - 本任务合并后，下一条新任务起执行；
  - 不设观察期；
  - 在执行中的任务不半途切换。
