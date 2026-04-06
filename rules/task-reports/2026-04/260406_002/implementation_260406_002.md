# implementation_260406_002

## 任务信息
- task_id: `260406_002`
- 类型: 治理机制接入任务
- 目标: 接入 T1~T4 轻门禁自动检查

## 实施内容
- 新增审计脚本：
  - `scripts/truth_audit_governance_t1_t4_260406_002.mjs`
- 检查项：
  - T1 任务口径声明一致
  - T2 目标产物头字段完整
  - T3 目标产物在 PR diff 可读
  - T4 strict/ancestor 关系检查
- 对齐：
  - `docs/tasks/260406_002.md`
  - `rules/LATEST.json`
