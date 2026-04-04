## TraeTask_260404_003 验收摘要（Fix + Acceptance，heavy）

### 结论块
- 结论：通过
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 修复目标：`order_truth_to_window_result_settlement_projection_missing` 已修复

### 修前污染事实块（复用 260404_002）
- `btc-updown-5m-1775293500`：row realized=`0`，但 `pnl_if_settle_win=0.99` / `pnl_if_settle_lose=-0.01`
- `btc-updown-5m-1775293200`：row realized=`0`，但 `pnl_if_settle_win=0.7` / `pnl_if_settle_lose=-0.3`

### 修后 reset 隔离验收（真实窗口，filled_total=1）
- `btc-updown-5m-1775312400`
  - entry_side=`YES`，entry_price=`0.29`
  - official/internal outcome=`null` / `DOWN`
  - filled_total=`1`，exit_fill_count=`0`
  - row realized=`-0.29`，truth realized=`-0.29`
- `btc-updown-5m-1775312100`
  - entry_side=`YES`，entry_price=`0.01`
  - official/internal outcome=`null` / `UP`
  - filled_total=`1`，exit_fill_count=`0`
  - row realized=`0.99`，truth realized=`0.99`

### reset 后 today 对账
- API：`realized_gross_pnl_total=2.0199999999999996`，`avg_realized_gross_pnl_per_window=0.4039999999999999`
- 手算：`Σrow realized=2.02`，`avg=0.404`
- 手算胜率：`win_numerator=3`，`win_denominator=5`，`win_rate=60%`
- 结论：today 摘要与修后窗口 truth 一致，不再有 single-fill completed 的虚假 0 污染

### 不回退事实
- `running_window_not_counted=true`
- `stop_semantics_chain_alive=true`
- `exit_windows_not_broken=true`

### server healthcheck
- `GET /`：`200`
- `GET /pairs`：`404`

### 收尾
- `node --check strategies/crypto_binary/server.mjs`：通过
- `node --check scripts/260404_003/truth_audit_settlement_projection_fix_260404_003.mjs`：通过
- 主审计脚本：通过
- `finalize_task_evidence --profile heavy`：通过
- `gate_light_ci --profile heavy`：通过

### 证据索引
- `rules/task-reports/2026-04/260404_003/260404_003_truth_audit_settlement_projection_fix.json`
- `rules/task-reports/2026-04/260404_003/260404_003_truth_audit_settlement_projection_fix.log`
