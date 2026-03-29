# TraeTask_260328_030 Truth Audit（窗口边界与状态重置可靠性）

## 结论

- 唯一结论：**A：窗口边界与状态重置可靠**
- first_break_layer：**无**

## 030-A~D 审计结果

- 030-A：窗口 A 触发一次公式撤单，窗口 B 可再次触发一次 -> PASS
- 030-B：旧窗口订单/状态不串扰新窗口 -> PASS
- 030-C：结束前后 1~2 秒连续采样，无同 tick 双窗口动作 -> PASS
- 030-D：旧窗口取消状态不污染新窗口首次决策 -> PASS

## 最小事实摘录

- 健康检查：
  - `GET / => 200`
  - `GET /pairs => 404`

- 030-A（防抖重置）：
  - `A2 reason=up_cancel_formula`
  - `A3 reason=within_bounds_or_no_trigger`（同窗口未重复触发）
  - `B2 reason=up_cancel_formula`（新窗口再次触发一次）

- 030-B（旧窗口串扰）：
  - 窗口 A：`state_after.no_order_ids_len=2`（旧窗口留有未成交 NO）
  - 窗口 B 首次：`state_before.no_order_ids_len=0` 且 `reason=ladder_not_posted`

- 030-D（取消状态重置）：
  - 窗口 A 触发后：`yes_cancelled=true, up_formula_cancelled=true`
  - 窗口 B 首次前：`yes_cancelled=false, up_formula_cancelled=false`

- 030-C（real runtime 临界秒连续样本）：
  - 旧窗口末端：`remaining_sec=2 -> 1 -> 0`，`window_id=btc-updown-5m-1774770900`
  - 新窗口起始：`window_id=btc-updown-5m-1774771200`，`remaining_sec=298 -> 297 -> 295`
  - 判定：`dual_tick_window_action=false`（未见同 tick 双窗口动作）
