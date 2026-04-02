## TraeTask_260403_003 验收摘要（Workflow Upgrade：light/heavy 落地分流）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 机制确认：未新增第三层，仅 light/heavy 两层

### 轻任务收尾链（最终定义）
- 语法检查
- LATEST 一致性、范围锁、postflight/envelope 必要校验
- 修前1条+修后1条最小事实块
- `finalize_task_evidence --profile light`
- `gate_light_ci --profile light`

### 重任务收尾链（最终定义）
- 唯一 first_break_layer
- Fail -> Pass
- real runtime
- 至少2条不回退
- 改 server 时 healthcheck
- `finalize_task_evidence --profile heavy`
- `gate_light_ci --profile heavy`

### light vs heavy 检查项差异表
- both：LATEST、report block、workspace_healer、doc path、scope lock、postflight/envelope、healthcheck 证据
- light-only：跳过 heavy-only 合约检查；跳过 heavy mandatory 与 SnippetCommitMustMatch
- heavy-only：全局合约检查 + heavy mandatory（first_break_layer/Fail->Pass/real runtime/不回退）

### 最小事实块
- 260330_045（light）：
  - gate 输出包含：`TASK_PROFILE=light`
  - `LIGHT profile: skipping heavy-only contract checks ...`
  - `LIGHT profile: heavy mandatory evidence checks skipped.`
- 260403_002（heavy）：
  - gate 输出包含：`TASK_PROFILE=heavy`
  - `Heavy mandatory evidence verified.`
- 生效时点：
  - 合并后下一条新任务起生效；已在执行中的任务不切换

### 证据索引
- `rules/task-reports/2026-04/260403_003/260403_003_truth_audit_workflow_profile_split.json`
- `rules/task-reports/2026-04/260403_003/260403_003_truth_audit_workflow_profile_split.log`
- `rules/task-reports/2026-04/260403_003/260403_003_truth_audit_workflow_profile_split.heartbeat.log`

