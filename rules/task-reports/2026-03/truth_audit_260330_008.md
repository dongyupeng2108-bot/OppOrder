# TraeTask_260330_008 验收摘要（同窗撤单后重挂/误报 + 日志表一致性）

## 结论

- 验收结论：**PASS**
- 结论：120/60 方向撤单后，同窗不再重挂，不再误报挂梯队；关键日志与左侧订单状态保持一致。
- 唯一 first_break_layer：`1）同窗口撤单后终态/防重挂判定层`

## 最小事实摘录

- 修前：
  - 120/60 后在同窗再次出现 `ladder_not_posted + PLACE_LADDER(...)`；
  - 同时 open_yes/open_no=0，形成“日志挂单、表里无新增挂单”分叉。
- 修后：
  - 120/60 后 reason 变为 `window_cancel_terminal_after_directional_before_end`，intents=`NOOP`；
  - open_yes/open_no 维持 0，无重挂，无误报。
- real runtime 连续样本：
  - `新窗口挂单 -> YES成交 -> 120 -> 60 -> 撤单后观察>=10秒` 完成。
- 不回退：
  - 260329_004 / 260329_007 / 260329_008 + 260330_006 / 260330_005 均保持。
