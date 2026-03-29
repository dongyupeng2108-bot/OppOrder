# TraeTask_260329_008 验收摘要（分方向撤单优先级）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：分方向撤单优先级已收口（NO=60, YES=120）`
- 修前唯一断裂层：`2. 旧全局 cancel_all_remaining_sec 优先级层`
- first_break_layer：`null`

## 最小事实摘录

- 修前（Fail）：
  - 在 NO=60、YES=120、全局=100 场景下，旧策略 `remaining=100` 返回 `CANCEL_OPEN(ALL)`，理由 `remaining_sec<=cancel_all_remaining_sec`。

- 修后（Pass）：
  - `remaining=120`：YES 侧触发 `up_cancel_before_end`，NO 仍保留 OPEN。
  - `remaining=100`：不再触发全局 cancel 覆盖 NO。
  - `remaining=60`：NO 侧触发 `down_cancel_before_end`。
  - reason/intents 已区分分方向撤单路径，不再误落全局路径。

- real runtime 连续样本（新窗口挂单 -> 120 -> 100 -> 60）：
  - after_place_250：open_yes=2，open_no=2
  - after_cancel_120：open_yes=0，open_no=2，reason=`up_cancel_before_end`
  - after_global_100_boundary：open_no=2（未被全局提前撤）
  - after_cancel_60：open_no=0，reason=`down_cancel_before_end`

- 不回退：
  - 260329_004：`wait_next_window_after_start` 仍可观测
  - 260329_007：当前窗口 orders 全部为 `resolved_window_id=w-cancel`，无错窗混入

- 诊断（改 server 只读证据）：
  - `GET / => 200`
  - `GET /pairs => 404`
