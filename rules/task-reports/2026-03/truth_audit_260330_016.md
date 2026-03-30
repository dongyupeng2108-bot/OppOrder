# TraeTask_260330_016 验收摘要（filled_total 真值链）

## 结论

- 验收结论：**通过（定位任务）**
- verdict：`A：通过`
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- real/debug：存在分叉，首分叉层=`fill_event_capture`

## 最小事实摘录

- real runtime 最小链覆盖完成：
  - 成交事件出现；
  - FILLED 状态出现；
  - runtime filled_total 增长；
  - 进入下一窗口后完成 stop，并拿到 last_run/completed summary/result_chain 对账值。
- 口径一致：
  - `runtime_filled_total == unique_filled_order_count`
  - `completed_summary_filled_total == last_window_filled_total`
  - `result_chain_filled_total == completed_summary_filled_total`
- 分区约束：
  - `current_window_filled_total <= unique_filled_order_count`
  - 未见 running 窗口混入 completed summary 的统计异常。

## 范围确认

- 未改业务语义
- 仅新增审计脚本与证据文件
