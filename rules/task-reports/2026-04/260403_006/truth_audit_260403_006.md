## TraeTask_260403_006 验收摘要（Snippet Git local-first）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 策略：`SNIPPET_GIT_STRATEGY=local_first`

### 最小事实块
- heavy 正常路径：
  - `SNIPPET_GIT_STRATEGY=local_first`
  - `SNIPPET_GIT_FETCH_NEEDED=false`
  - `SnippetCommitMustMatch verified.`
- heavy 信息不足路径（治理注入）：
  - `SNIPPET_GIT_FETCH_NEEDED=true`
  - `SNIPPET_GIT_FETCH_REASON=...`
  - `SNIPPET_GIT_FETCH_ACTION=git fetch origin --deepen=50`
  - `SnippetCommitMustMatch verified.`
- light 烟雾路径：
  - `TASK_PROFILE=light`
  - `LIGHT profile: skipping heavy-only contract checks ...`

### 不回退确认
- heavy mandatory：保留并通过
- heavy 合约覆盖：news/rank/export/ledger/scanner/universe/trading 保留
- 260403_004 并行 + mock 会话复用：保留
- 260403_005 短超时 + fail-fast：保留

### 证据索引
- `rules/task-reports/2026-04/260403_006/260403_006_truth_audit_snippet_git_local_first.json`
- `rules/task-reports/2026-04/260403_006/260403_006_truth_audit_snippet_git_local_first.log`
