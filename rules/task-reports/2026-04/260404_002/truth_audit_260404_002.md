## TraeTask_260404_002 验收摘要（Truth Audit，heavy）

### 结论块
- 结论：通过（定位完成）
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 判定：`filled_total=1` 时 PNL=0 在当前业务口径下为预期，不是计算 BUG

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
  - 手算 realized=0
- 样本2：`btc-updown-5m-1775293200`
  - FILLED 唯一订单：`paper_2e9cd5fc`，YES ENTRY，price=0.3，qty=1
  - exit filled count=0
  - 手算 realized=0

### 直接原因（必须回答）
- 当前 realized 口径来自 `EXIT fill` 相对 `ENTRY 均价` 的实现收益。
- 当窗口只有 1 笔成交且该成交是 ENTRY（无任何 EXIT）时，realized 自然为 0。
- 因此“总成交单=1，PNL=0”在该场景下是业务口径预期，而非 today summary / postmortem/result / 订单真值链计算错误。

### 证据索引
- `rules/task-reports/2026-04/260404_002/260404_002_truth_audit_single_fill_pnl_zero.json`
- `rules/task-reports/2026-04/260404_002/260404_002_truth_audit_single_fill_pnl_zero.log`
