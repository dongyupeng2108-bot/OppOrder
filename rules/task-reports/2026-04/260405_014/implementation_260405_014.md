# implementation_260405_014

## 任务信息
- task_id: `260405_014`
- 类型: Debug 回修任务（Fix）
- 目标: 修复 260405_013 中 notify commit 绑定口径不严格问题

## 实施内容
- `scripts/assemble_evidence.mjs`：
  - `notify` 头部 `Branch/Commit` 改为优先绑定 live git 上下文
  - `DOD` 与 `GATE` 正文统一过滤历史失败噪音：
    - `Missing Blocks / Missing block`
    - `ACTION: Use 'assemble_evidence.mjs' ...`
    - `FAILED:` 与 `FAIL_REASON=`
- 新增严格审计脚本：
  - `scripts/truth_audit_notify_binding_strict_260405_014.mjs`
  - 恢复 `notify_commit == git_meta.commit` 严格口径（不再降级）
