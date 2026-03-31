# TraeTask_260330_028 实施记录（DOWN 时间撤单定位）

## 范围与方式

- 本单仅做定位，不做修复。
- 未改任何下单/撤单业务语义、UI、PNL、账户链。

## 审计脚本

- 新增：`scripts/truth_audit_down_cancel_window_260330_028.mjs`
- 采样护栏：
  - `MAX_WALL_TIME=20min`
  - `MAX_SILENCE=120s`
  - `LOG_TAIL=120`
- 采样内容：
  - active vs saved 撤单参数对照
  - remaining_sec 穿越 60 秒阈值前后连续样本
  - NO order_id 级状态链与 `decision_intents`
  - restart/cutover 影响链（含 stop/start 时间点）

## 关键事实

- `down_cancel_saved_before_end_sec=60`
- `down_cancel_active_before_end_sec=60`
- `saved_vs_active_mismatch=false`
- NO 单（`paper_cd6f29a1`）在 `remaining_sec=61` 时为 OPEN，`remaining_sec=20` 时仍为 OPEN
- 阈值后未见 `CANCEL_OPEN(NO)` 发出，未见撤单执行变化
- 同窗内大量 `decision_reason=wait_next_window_after_start`，且样本包含 restart 事件

## 结论

- verdict：`C：存在断裂`
- 唯一 first_break_layer：`restart_window_ownership`
- 解释：restart 后同窗决策被 startup gate 抑制，导致 DOWN 时间撤单责任链未落到该窗执行。
