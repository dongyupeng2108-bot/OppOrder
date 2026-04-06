# implementation_260405_017

## 任务信息
- task_id: `260405_017`
- 类型: Debug 回修任务（Fix）
- 目标: 统一任务定义、目标产物与审计口径为 lineage 语义

## 实施内容
- `scripts/assemble_evidence.mjs`
  - 维持重生产物三元身份写入
- `scripts/truth_audit_notify_binding_live_head_260405_017.mjs`
  - 与任务定义一致：`Generated From Head` 为 PR head 祖先
  - 校验 runtime head 来源必须存在
- 目标产物重生：
  - `rules/task-reports/2026-04/notify_260405_012.txt`
