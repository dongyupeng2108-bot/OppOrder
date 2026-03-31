# TraeTask_260330_020 验收摘要（上一窗口结果 / 近期表现摘要字段链）

## 结论

- 验收结论：**通过（定位任务）**
- verdict：`A：通过`
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- real/debug：未分叉（`none`）

## 最小事实摘录

- 两块 UI 完整字段清单（按 DOM 显示顺序）已输出。
- real runtime 覆盖到窗口结算后刷新：
  - `current_window_id=btc-updown-5m-1774917900`
  - `last_window_id=btc-updown-5m-1774917600`
  - `completed_summary_window_id=debug-fill-yes-path-v1-w1`
- 逐字段对账（窗口结算后样本）全部 PASS。
- 关键 PNL 分离：
  - 上一窗口结果 `PNL=0`，来源 `postmortem ?? last_run_snapshot`
  - 近期表现摘要 `总计PNL=301.9`，来源 `performance.summary.realized_gross_pnl_total (fixed1)`

## 范围确认

- 未改业务语义
- 仅新增审计与证据文件
