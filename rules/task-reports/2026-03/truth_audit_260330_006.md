# TraeTask_260330_006 验收摘要（分方向 before_end 撤单）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：120/60 分方向 before_end 撤单语义已恢复`
- first_break_layer：`3. runner tick 执行顺序层`

## 最小事实摘录

- 修前（Fail）：
  - 120/60 配置存在，但 120/100/60 时刻 open_yes/open_no 均未按预期下降，表现为不撤单。
  - 根因断点唯一：`state_override` 未持久化，下一 tick 丢失窗口初始化状态，导致 open id 归零。

- 修后（Pass）：
  - 120：YES 撤单（open_yes=0）
  - 100：NO 仍保留（open_no>0）
  - 60：NO 撤单（open_no=0）
  - reason/intents 已按方向区分：`up_cancel_before_end` / `down_cancel_before_end`

- real runtime 连续样本：
  - 新窗口挂单 -> 120 -> 100 -> 60 已连续覆盖。

- 不回退：
  - 260329_004：wait_next_window_after_start 语义存在
  - 260329_007：当前窗口过滤链路存在
  - 260329_008：全局 fallback 优先级不覆盖分方向撤单

- server 健康检查：
  - `GET / => 200`
  - `GET /pairs => 404`
