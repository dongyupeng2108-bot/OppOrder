# Bot HTTP 契约（薄表）

> **静态说明**：本文为**静态**字段表与示例，**不等于**已对运行中服务做 HTTP 运行态验证。降级记账见 [`DELIVERY_REPORT_DOC_GOVERNANCE.md`](DELIVERY_REPORT_DOC_GOVERNANCE.md)。

**来源代码**：[`strategies/crypto_binary/server.mjs`](../strategies/crypto_binary/server.mjs)（`/bot/context`、`/bot/status`）。字段以**实现为准**；本文用于 UI、脚本与排障对齐。

**示例 JSON**（静态、便于 diff）：[`examples/bot_context.example.json`](examples/bot_context.example.json)、[`examples/bot_status.example.json`](examples/bot_status.example.json)。  
**最小结构校验**：`npm run verify:doc-contracts`（见 [`scripts/verify_doc_contract_examples.mjs`](../scripts/verify_doc_contract_examples.mjs)）。

---

## `GET /bot/context`

成功时 **200**，body 为**单层对象**（非 `{ ok: true, data }`）。失败时可能为 `{ ok: false, error }`（与其它路由一致）。

| 字段 | 类型 | null 语义 |
|------|------|-----------|
| `window_id` | string \| null | 当前扫描到的窗口 slug |
| `last_window_id` | string \| null | 状态中的上一窗口 id |
| `slug` | string \| null | 通常与 `window_id` 一致 |
| `period` | string \| null | 从 slug 推断，如 `5m` / `15m` |
| `remaining_sec` | number \| null | 距窗口结束的秒数；无结束时间则为 null |
| `btc_price` | number \| null | 解析后 BTC 价；无则 null |
| `anchor_btc` | number \| null | **状态冻结**锚定价；未 init 为 null |
| `atr_5m` | number \| null | 波动输入；缺失时 bounds 可能未就绪 |
| `upper_bound` / `lower_bound` | number \| null | 边界；未就绪为 null |
| `bid_yes` / `ask_yes` / `bid_no` / `ask_no` | number \| null | 订单簿侧；无快照为 null |
| `tick_size` | number \| null | |
| `stale` | boolean | 订单簿是否陈旧，默认 true |
| `updated_at` | string | ISO 时间 |
| `_btc_source_trace` | object | 调试：行情源 init/feed/cache 轨迹 |

**UI 绑定提示**（与 PROJECT_RULES 一致）：BTC 价格 ← `btc_price`；UPDOWN 概率优先 `bid_yes`/`bid_no`，可 fallback `ask_*`；波动值 ← `atr_5m`。

---

## `GET /bot/status`

成功时 **200**，body 为 **`botState` 展开** + 下列附加字段。

### 与 `getState()` 一致的字段（`bot_state.mjs`）

| 字段 | 类型 | 备注 |
|------|------|------|
| `mode` | string | 如 `paper-staging` |
| `phase` | string | `IDLE` / `WAIT_WINDOW_INIT` / `WAIT_CONTEXT_READY` 等 |
| `running` | boolean | |
| `debug_*` | mixed | 调试场景用 |
| `tick_interval_ms` / `last_tick_at` | number \| string \| null | |
| `last_window_id` / `current_window_id` | string \| null | **语义高风险区**，见 PROJECT_RULES |
| `window_initialized_at` | string \| null | 窗口已 init 的时间戳 |
| `remaining_sec` | number \| null | |
| `anchor_btc` / `atr_5m` / `upper_bound` / `lower_bound` | number \| null | |
| `ladder_posted` / `yes_cancelled` / `no_cancelled` | boolean | |
| `yes_order_ids` / `no_order_ids` | string[] | |
| `last_reason` / `last_intents` | string / array | |
| `updated_at` | string | |

### `server` 覆盖与附加

| 字段 | 说明 |
|------|------|
| `current_window_id` | **重写**：仅当 `running === true` 时为真实 `current_window_id`，否则响应中为 **null**（避免停止态误显活动窗口） |
| `saved_config` | 已保存的 Bot 配置快照 |
| `last_run_snapshot` | 上次运行摘要（若存在） |
| `active_runtime_snapshot` | 仅 `running === true` 时非 null：`config`、`phase`、`current_window_id`、`anchor_btc`、`upper_bound`、`lower_bound` |

---

## 与其它端点（索引）

| 端点 | 用途 |
|------|------|
| `GET /bot/orders` | 订单列表 + `window_scope` + summary |
| `GET /bot/postmortem/latest` | `{ ok, postmortem }` |
| `GET /bot/performance/summary` | `{ ok, summary }`，`detail=1` 含行明细 |
| `GET /bot/decision-preview` | 决策预览（查询参数见实现） |

完整路由实现见 `server.mjs` 中 `if (req.method === 'GET' && req.url === '/bot/...')` 各分支。
