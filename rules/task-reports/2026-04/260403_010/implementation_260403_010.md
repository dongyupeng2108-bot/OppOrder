## TraeTask_260403_010 实施记录（completed 触发链修复）

### 修复范围
- 仅修 completed/postmortem 触发链。
- 未修改 PM 官方 probe、today/7d 汇总逻辑、前端 UI。

### 代码改动
- `strategies/crypto_binary/bot_runner.mjs`
  - 新增 `onWindowChanged` 钩子，窗口切换时回传 `from_window_id/to_window_id/state_before/state_after`。
- `strategies/crypto_binary/server.mjs`
  - `finalizeBotRunSnapshot` 支持窗口覆写（`completed_window_id`）与 `trigger_source`。
  - 新增窗口切换完成快照触发：`WINDOW_ROLLOVER_COMPLETED` + `trigger_source=WINDOW_CHANGED`。
  - 触发后写入 `completed_at` 与 postmortem（沿用现有写入链路，无手工回填）。
- 新增验收脚本：`scripts/truth_audit_completed_trigger_fix_260403_010.mjs`
  - real runtime Fail->Pass 验证
  - 不回退验证（正常样本、running不提前、summary语义烟雾）
  - server healthcheck（GET /、GET /pairs）

### 运行
- `node --check strategies/crypto_binary/bot_runner.mjs`：通过
- `node --check strategies/crypto_binary/server.mjs`：通过
- `node --check scripts/truth_audit_completed_trigger_fix_260403_010.mjs`：通过
- 主审计脚本：通过（`first_break_layer=NONE_CHAIN_PASS`）
