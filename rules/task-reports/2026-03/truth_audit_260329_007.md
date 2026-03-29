# TraeTask_260329_007 验收摘要（Owner 手工场景组合链路）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：组合链路已收口（新窗口挂单/当前窗口状态/tp=1展示）`
- 修前唯一断裂层：`2. 窗口订单归档/过滤层`
- first_break_layer：`null`

## 最小事实摘录

- 修前（Fail）：
  - 旧展示逻辑“有 OPEN 仅显示 OPEN”，可出现“只见 UP / 缺边”。
  - 旧归档依赖推断窗口且缺显式 `window_id`，存在旧 TP 混入当前窗口风险。

- 修后（Pass）：
  - 新窗口可见 4 条 ENTRY（YES 0.1/0.2，NO 0.9/0.8）。
  - 当前窗口无 TAKE_PROFIT 混入（tp=1 不预挂 TP）。
  - 切到下一窗口后，当前窗口状态仅显示新窗口订单。
  - `tp=1` 平仓价统一展示“等待结算 / tp:1.000”。

- real runtime 连续样本：
  - `initial_window_id=btc-updown-5m-1774810500`
  - `switched_window_id=btc-updown-5m-1774810800`
  - `next_window_id=btc-updown-5m-1774811100`
  - `one_side_triggered=true`

- 不回退：
  - 保持 `wait_next_window_after_start`（260329_004）
  - 保持 `tp=1` 不生成 TP 行（260329_005）

- 诊断（改 server）：
  - `GET / => 200`
  - `GET /pairs => 404`
