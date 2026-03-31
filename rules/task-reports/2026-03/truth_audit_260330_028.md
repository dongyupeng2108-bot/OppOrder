# TraeTask_260330_028 验收摘要（定位任务）

## 结论块

- 结论：**未通过（定位任务）**
- verdict：`C：存在断裂`
- 唯一 first_break_layer：`restart_window_ownership`

## 最小事实块

- active/saved 撤单参数：
  - `down_cancel_saved_before_end_sec=60`
  - `down_cancel_active_before_end_sec=60`
  - `saved_vs_active_mismatch=false`
- 窗口归属：
  - `current_window_id=btc-updown-5m-1774988700`
  - `last_window_id` 随后切窗推进
  - `active_window_id` 与当前窗一致
- remaining_sec 阈值前后：
  - 阈值前：`remaining_sec=61`，NO(`paper_cd6f29a1`) 状态 OPEN
  - 阈值后：`remaining_sec=20`，NO(`paper_cd6f29a1`) 状态仍 OPEN
- 决策/执行：
  - 阈值后未见 `CANCEL_OPEN(NO)` 发出
  - 未见撤单执行变化（cancel execution false）
- restart 影响：
  - 样本存在 stop/start 事件
  - 阈值区间反复出现 `wait_next_window_after_start`

## 健康检查

- `GET /` => `200`
- `GET /pairs` => `200`
