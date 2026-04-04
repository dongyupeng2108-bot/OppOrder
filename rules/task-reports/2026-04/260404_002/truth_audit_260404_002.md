## TraeTask_260404_002 验收摘要（Truth Audit，heavy）

### 结论块
- 结论：通过（定位完成）
- 唯一 first_break_layer：`order_truth_to_window_result_settlement_projection_missing`
- 判定：这是计算 BUG（窗口结算收益未进入结果链 realized）

### today 当前值
- `window_count=3`
- `filled_total=2`
- `realized_gross_pnl_total=0`
- `avg_realized_gross_pnl_per_window=0`

### filled_total=1 窗口清单（today 全量）
- `btc-updown-5m-1775293500`：filled=1，cancelled=0，row pnl=0
- `btc-updown-5m-1775293200`：filled=1，cancelled=0，row pnl=0

### 两个真实窗口订单真值手算
- 样本1：`btc-updown-5m-1775293500`
  - FILLED 唯一订单：`paper_5eb06a61`，YES ENTRY，price=0.01，qty=1
  - exit filled count=0
  - 结算反事实：`pnl_if_win=+0.99`，`pnl_if_lose=-0.01`（均不为0）
  - 实际 row realized=0（与结算反事实冲突）
- 样本2：`btc-updown-5m-1775293200`
  - FILLED 唯一订单：`paper_2e9cd5fc`，YES ENTRY，price=0.3，qty=1
  - exit filled count=0
  - 结算反事实：`pnl_if_win=+0.7`，`pnl_if_lose=-0.3`（均不为0）
  - 实际 row realized=0（与结算反事实冲突）

### 直接原因（必须回答）
- 当前 `realized_gross_pnl_total` 仅按 EXIT 相对 ENTRY 均价计算；窗口结算（0/1 payout）未投影到结果链 realized。
- 所以窗口结束后即便单成交（价格在 0~1 之间），理论结算 PNL 必不为 0，但 row/summary 仍为 0。
- 断层不在 today summary 聚合（聚合与 rows 一致），而在“订单真值 -> 窗口结果 realized”投影层。

### 证据索引
- `rules/task-reports/2026-04/260404_002/260404_002_truth_audit_single_fill_pnl_zero.json`
- `rules/task-reports/2026-04/260404_002/260404_002_truth_audit_single_fill_pnl_zero.log`
