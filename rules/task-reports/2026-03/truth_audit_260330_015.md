# TraeTask_260330_015 验收摘要（执行层幂等 / 窗口隔离）

## 结论

- 验收结论：**通过（定位任务）**
- verdict：`A：通过`
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- real/debug：存在分叉，首分叉层=`window_scope_filter`

## 最小事实摘录

- real runtime 连续样本：
  - 启动窗 `wait_next_window_after_start + NOOP`；
  - 下一新窗出现 `PLACE_LADDER(...)`；
  - 同窗后续出现撤单决策（`up_cancel_before_end`），无新增订单；
  - 再切下一窗后窗口字段与订单显示继续一致。
- 对账表字段齐全：
  - `timestamp/current_window_id/last_window_id/active_window_id/decision_reason/decision_intents/open_orders_count/current_window_orders_count/current_window_tp_count/completed_summary_window_id/completed_summary_filled_total`
- 重点检查：
  - 非 PLACE tick 不新增订单；
  - 同窗撤单后不误重挂；
  - running 窗口未混入 completed summary。

## 范围确认

- 未改业务语义
- 仅新增审计脚本与证据文件
