# TraeTask_260330_022 实施记录（结果块跨窗未刷新定位）

## 范围与方式

- 本单仅做定位，不做业务修复。
- 未改业务逻辑、执行链、结算计算、UI 文案布局、账户链与三大文档结构。

## 审计脚本

- 新增：`scripts/truth_audit_result_refresh_stale_260330_022.mjs`
- 护栏：
  - `MAX_WALL_TIME=25min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=120`
- 覆盖：
  - real runtime：A 结束 -> B 完整周期 -> C 起始三时点
  - debug control：受控对照快照
  - 窗口级对账表（UI 值 + 底层值 + 刷新标记）

## 关键定位结果

- real 样本中窗口推进正常：
  - `current_window_id` 从 `...6300 -> ...6600 -> ...6900` 推进；
  - `last_window_id` 同步推进。
- 但底层结果链未推进：
  - `postmortem_window_id` 在 A_end/B_end/C_start 三点均固定为 `debug-fill-yes-path-v1-w1`；
  - `summary_window_count` 与 `summary_realized_gross_pnl_total` 同样未变。
- 两块 UI 值也保持不变，与底层“未推进”一致，不是单纯 DOM 投影单点异常。

## 定位结论

- verdict：`C：存在断裂`
- 唯一 first_break_layer：`last_window_partition`
- real/debug 分叉：`last_window_partition`
- 定性：
  - 主因是“上一窗口归属推进未到位（底层未推进）”；
  - 不是“底层已更新但 DOM 未刷新”的类型。
