## TraeTask_260403_014 验收摘要（heavy 默认静态 domain）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`

### 新 heavy 静态 domain 表
- 默认：`--profile heavy` => `--domain btcqdd`
- 显式：`--domain btcqdd|opportunities|global|full`
- 非自动触发：不按 changed files/diff/path 自动扩域

### 默认 btcqdd heavy 检查项
- core evidence / scope / postflight / envelope
- BTCQDD healthcheck
- SnippetCommitMustMatch
- heavy mandatory
- 已有提效能力（并行/复用/短超时/fail-fast/Git local-first）

### 被移出默认 heavy、改为显式 domain 的检查项
- `news/rank/export/ledger`
- `scanner/universe/trading`
- `Rank V2 Contract Version Guard`
- 仅 `--domain opportunities|full` 执行以上跨域 checks

### 最小事实块
- BTCQDD 默认 heavy 通过关键行：
  - `TASK_DOMAIN=btcqdd`
  - `Heavy mandatory evidence verified`
  - `SnippetCommitMustMatch verified`
  - `Healthcheck evidence verified`
  - `GATE_LIGHT_EXIT=0`
- 跨域 checks 跳过关键行（默认域）：
  - `DOMAIN_SKIP: opportunities contract pack skipped (domain=btcqdd)`
  - `DOMAIN_SKIP_CHECKS: news/rank/export/ledger/scanner/universe/trading`
- 显式 `--domain full|opportunities` 执行关键行：
  - `TASK_DOMAIN=full` / `TASK_DOMAIN=opportunities`
  - `HEAVY_PARALLEL_START: news/rank/export/ledger`
  - `HEAVY_PARALLEL_START: scanner/universe/trading`
- light 烟雾关键行：
  - `TASK_PROFILE=light`
  - `LIGHT profile: skipping heavy-only contract checks`

### 证据索引
- `rules/task-reports/2026-04/260403_014/260403_014_truth_audit_heavy_domain_static.json`
- `rules/task-reports/2026-04/260403_014/260403_014_truth_audit_heavy_domain_static.log`
