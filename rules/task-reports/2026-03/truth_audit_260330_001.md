# TraeTask_260330_001 验收摘要（订单状态与概率显示一致性）

## 结论

- 验收结论：**PASS**
- 唯一结论：`A：当前窗口订单状态与UP/DOWN概率显示口径已收口`
- 修前唯一断裂层：`4. 概率显示快照层`
- first_break_layer：`null`

## 最小事实摘录

- 修前（Fail）：
  - 旧 UI 头部概率仅取 live context，不取订单同 tick 快照，存在“同屏不同刻度”的不自洽风险。
  - 旧 `/bot/orders` 未附带 context snapshot，前端无法对齐同 tick 口径。

- 修后（Pass）：
  - `/bot/orders` 返回 `context_snapshot/context_snapshot_at`。
  - UI 头部 BTC/UPDOWN/波动优先读取 `orders.context_snapshot`，与订单状态同口径。
  - owner 截图类组合场景回归脚本通过。

- real runtime 连续样本：
  - after_place：YES/NO ENTRY 挂单建立
  - after_fill：NO 侧 ENTRY 成交 + NO TP OPEN + YES 仍 OPEN
  - after_stable：同口径显示保持一致

- 不回退：
  - 260329_004：`wait_next_window_after_start` 仍可观测
  - 260329_007：当前窗口过滤不混错窗
  - 260329_008：分方向撤单优先级检查仍成立

- 诊断（改 server）：
  - `GET / => 200`
  - `GET /pairs => 404`
