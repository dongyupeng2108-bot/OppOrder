# TraeTask_260330_025 验收摘要（同窗 YES 重复挂单/成交）

## 结论块

- 验收结论：**未通过（定位任务）**
- verdict：`C：存在断裂`
- 唯一 first_break_layer：`terminal_state_guard`
- 三选一结论：`真实重复执行`
- real/debug：存在分叉，首分叉层=`terminal_state_guard`

## 最小事实块

- 异常窗口决策与新建 order_id 采样：
  - `decision_reason=wait_next_window_after_start`（异常段早期）
  - `decision_reason=within_bounds_or_no_trigger`（异常段后续）
  - 多个 tick 出现 `newly_created_order_ids_this_tick`，并在首个 YES 成交后继续出现新的 YES order_id
- 两条 YES 已成交对应 order_id：
  - `paper_e553a175`
  - `paper_474d88b8`
- `UP方向1单成交`之后是否又出现新 YES order_id：
  - 是，`post_fill_new_yes_order_ids=["paper_06a66cc4","paper_18c07d7a"]`
- 窗口信息：
  - `current_window_id=btc-updown-5m-1774977600`（异常段）
  - `last_window_id` 在切窗后推进为 `btc-updown-5m-1774977600`
- 右侧结果区对应底层值（采样）：
  - `postmortem_window_id=debug-fill-yes-path-v1-w1`
  - `summary_window_count=3`

## 范围确认

- 未改业务语义
- 仅新增定位脚本与证据文件
