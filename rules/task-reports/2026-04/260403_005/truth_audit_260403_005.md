## TraeTask_260403_005 验收摘要（heavy 短超时 + fail-fast）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 固定短超时：`4000ms`（scanner/universe/trading）

### 最小事实块
- heavy 成功路径：
  - `Heavy mandatory evidence verified.`
  - `SnippetCommitMustMatch verified.`
  - `HEAVY_ENDPOINT_HARD_TIMEOUT_MS=4000`
  - `Scanner/Universe/Trading ... SKIP (server unreachable)` 且快速结束
  - `HEAVY_PARALLEL_START/DONE`、`MOCK_SERVER_SESSION=starting/ready/stopping`
- heavy 失败路径（注入）：
  - `FIRST_FAILED_STAGE=news_contract`
  - `FAIL_FAST_ABORTED=true`
  - `SKIPPED_AFTER_FAIL=[...]`
  - 退出码非 0
- light 烟雾路径：
  - `TASK_PROFILE=light`
  - `LIGHT profile: skipping heavy-only contract checks ...`

### 证据索引
- `rules/task-reports/2026-04/260403_005/260403_005_truth_audit_heavy_timeout_failfast.json`
- `rules/task-reports/2026-04/260403_005/260403_005_truth_audit_heavy_timeout_failfast.log`
