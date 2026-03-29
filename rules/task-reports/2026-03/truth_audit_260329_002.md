# TraeTask_260329_002 验收摘要（当前窗口展示名）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：当前窗口展示已切换为PM标签优先并保留debug回退`
- first_break_layer：`null`

## 最小事实摘录

- 修复前：
  - 当前窗口展示直接绑定原始 `window_id`。

- 修复后（真实 PM 窗口）：
  - 输入：`btc-updown-5m-1774796100`
  - 输出：`March 29, 10:55-11AM ET`

- 修复后（debug/非标准窗口）：
  - 输入：`debug-fill-yes-path-v1-w1`
  - 输出：`debug-fill-yes-path-v1-w1`（保持原始名）

- 格式化逻辑：
  - 前端推导实现于 `se_formatWindowDisplayName(windowId)`。
  - “当前窗口”字段使用该函数进行展示赋值。

- 说明：
  - 未改执行主链
  - 未改 signer/余额链
  - 未改 PNL/today
