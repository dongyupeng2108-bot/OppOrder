# implementation_260405_013

## 任务信息
- task_id: `260405_013`
- 类型: Debug 回修任务（Fix）
- 目标: 清理 260405_012 正式 notify 历史失败噪音并修复 Branch/Commit 绑定

## 实施内容
- 修改 `scripts/assemble_evidence.mjs`：
  - 过滤新增历史噪音行：
    - `Missing Blocks: ...`
    - `ACTION: Use 'assemble_evidence.mjs' to regenerate reports.`
    - 任意 `FAILED:` 与 `FAIL_REASON=`
  - `GATE_LIGHT` 正文块启用同口径过滤，避免旧失败片段回灌
  - `Branch/Commit` 改为优先绑定当前 live git 上下文，避免旧 `git_meta` 污染
- 新增回修审计脚本：
  - `scripts/truth_audit_notify_binding_fix_260405_013.mjs`
- 重建目标顶层 notify：
  - `rules/task-reports/2026-04/notify_260405_012.txt`
