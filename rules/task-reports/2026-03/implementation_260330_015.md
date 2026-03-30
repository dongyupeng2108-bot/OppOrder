# TraeTask_260330_015 实施记录（执行层幂等 / 窗口隔离复验）

## 范围与方式

- 本单仅做真值定位，不做业务修复。
- 未改：
  - 下单/撤单业务逻辑
  - anchor/bounds/tp 语义
  - UI/日志展示
  - PNL/账户链

## 审计脚本

- 新增：`scripts/truth_audit_executor_isolation_260330_015.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=120`
- 采样：
  - real runtime：覆盖启动后下一窗挂单、同窗后续 tick、同窗撤单、再切下一窗显示
  - debug control：3 步受控对照（同窗 place -> 同窗非 place -> 切窗）

## 对账表字段

- 已输出 `timestamp / current_window_id / last_window_id / active_window_id / decision_reason / decision_intents / open_orders_count / current_window_orders_count / current_window_tp_count / completed_summary_window_id / completed_summary_filled_total`

## 定位结论

- verdict：`A：通过`
- first_break_layer：`NONE_CHAIN_PASS`
- 说明：
  - real runtime 六层候选均通过；
  - real/debug 存在分叉，首分叉层为 `window_scope_filter`（debug 受控路径对该层仅作最小对照，不构成 real 断裂）。
