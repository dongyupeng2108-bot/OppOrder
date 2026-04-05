# implementation_260405_008

## 任务信息
- task_id: `260405_008`
- 类型: 口径分离任务（S4 / M1-A3）
- 目标: 区分 monitor sampling 与 execution snapshot 日志口径，不改 UI

## 实施内容
- `BOT_PRICE_1S` 补齐 monitor sampling 口径字段：
  - `sampling_role`
  - `sampling_interval_ms`
  - `sampling_source`
  - `context_updated_at`
- 执行侧补齐 execution snapshot 口径字段：
  - `RUNNER_TICK.data.snapshot_role`
  - `RUNNER_TICK.data.snapshot_source`
  - `runSingleTick` 返回 `snapshot_role/snapshot_source`
- 修改文件：
  - `strategies/crypto_binary/server.mjs`
  - `strategies/crypto_binary/bot_runner.mjs`
- 新增真值审计脚本：
  - `scripts/truth_audit_m1_a3_sampling_semantics_260405_008.mjs`
