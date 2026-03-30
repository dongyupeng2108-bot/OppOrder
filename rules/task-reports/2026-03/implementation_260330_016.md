# TraeTask_260330_016 实施记录（filled_total 真值链定位）

## 范围与基线

- 本单仅做真值定位，不做业务修复。
- 未改：
  - 订单执行/撤单逻辑
  - anchor/bounds/tp 语义
  - UI/日志展示
  - PNL/today/账户链

## 审计脚本

- 新增：`scripts/truth_audit_filled_total_chain_260330_016.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=120`
- real runtime：
  - 覆盖启动窗到下一窗；
  - 覆盖成交事件、FILLED 状态、filled_total 变化、stop 后 last_run/postmortem/performance 结果链。
- debug control：
  - `fill_yes_path_v1` 仅作对照。

## 对账表字段

- 已输出：
  - `timestamp`
  - `current_window_id`
  - `order_id`
  - `order_status`
  - `fill_event_seen`
  - `unique_filled_order_count`
  - `runtime_filled_total`
  - `current_window_filled_total`
  - `last_window_filled_total`
  - `completed_summary_filled_total`
  - `result_chain_filled_total`

## 定位结论

- verdict：`A：通过`
- first_break_layer：`NONE_CHAIN_PASS`
- 说明：
  - real runtime 下 filled_total 与“同口径窗口唯一 FILLED order_id 计数”一致；
  - 窗口分区、summary 聚合、result 投影链一致；
  - real/debug 存在分叉，首分叉层为 `fill_event_capture`（debug 对照路径中 fill 日志可见性与 real 时序不同，不构成 real 断裂）。
