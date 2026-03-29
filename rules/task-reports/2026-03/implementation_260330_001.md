# TraeTask_260330_001 实施记录（订单状态 / 概率显示口径一致性）

## 定位结论

- 唯一 first_break_layer：**4. 概率显示快照层（probability snapshot display）**
- 次级影响链：
  - 订单状态使用 runner tick 结果窗口；
  - 头部 UP/DOWN 概率使用 `/bot/context` 即时值；
  - 两者在高波动下可能不同步，形成“同屏不自洽”。

## 修复范围

- `strategies/crypto_binary/server.mjs`
- `ui/js/strategy-editor.js`
- `scripts/truth_audit_order_prob_consistency_260330_001.mjs`

## 核心修复

- `/bot/orders` 新增：
  - `context_snapshot`（来自最近一次 tick 的 context 快照）
  - `context_snapshot_at`（对应 tick 时间）
- 前端 `se_renderContext` 调整为优先使用 `orders.context_snapshot` 渲染：
  - BTC 价格
  - UP/DOWN 概率
  - 波动值
- 保留旧行为兜底：若无 `context_snapshot` 则回退 `context`。

## 最小回归

- 新增 `scripts/truth_audit_order_prob_consistency_260330_001.mjs`：
  - 固化 owner 截图类场景（YES OPEN、NO FILLED、NO TP OPEN 与 UP/DOWN 显示组合）；
  - 验证头部概率与当前窗口订单状态/TP 状态同口径一致；
  - 含 real runtime 连续样本与不回退项检查。

## 结果

- 同一面板中的头部概率与订单状态统一到同一 tick 快照口径。
- 不再出现“订单表是 A 时刻、UP/DOWN 是 B 时刻”的误导展示。
- 260329_004 / 260329_007 / 260329_008 不回退。
