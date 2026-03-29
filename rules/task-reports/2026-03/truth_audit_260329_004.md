# TraeTask_260329_004 验收摘要（启动时机语义）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：启动时机语义已修复（启动等待，下个窗口挂单）`
- 修前唯一断裂层：`runner 启动首 tick 层`
- first_break_layer：`null`

## 最小事实摘录

- 修复前（Fail）：
  - 启动后仍在 `debug-main-path-v1-w1` 立即出现挂单：
  - `last_reason=ladder_not_posted`，`open_yes=4`，`open_no=4`。

- 修复后（Pass，当前窗口不挂单）：
  - 启动后在 `debug-main-path-v1-w1` 连续多帧：
  - `last_reason=wait_next_window_after_start`，且 `open_yes=open_no=0`。

- 修复后（Pass，到下一个新窗口才挂单，real runtime）：
  - 启动窗口：`btc-updown-5m-1774804200`
  - 切换窗口：`btc-updown-5m-1774804500`
  - 切换前：`before_switch_no_orders=true`
  - 切换后：`after_switch_has_both=true`

- 健康检查：
  - `GET / => 200`
  - `GET /pairs => 404`

## 说明

- 最终语义：点击启动后若当前窗口已存在，先等待；到下一个新窗口才按配置挂单。
- 未改 UI，未改 signer/余额链，未改 PNL/today。
