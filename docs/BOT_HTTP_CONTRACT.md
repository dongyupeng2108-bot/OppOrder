# Bot HTTP 契约（薄表）

> **静态说明**：本文为**静态**字段表与示例，**不等于**已对运行中服务做 HTTP 运行态验证。降级记账见 [`DELIVERY_REPORT_DOC_GOVERNANCE.md`](DELIVERY_REPORT_DOC_GOVERNANCE.md)。

**来源代码**：[`strategies/crypto_binary/server.mjs`](../strategies/crypto_binary/server.mjs)（`/bot/context`、`/bot/status`）。字段以**实现为准**；本文用于 UI、脚本与排障对齐。

**示例 JSON**（静态、便于 diff）：[`examples/bot_context.example.json`](examples/bot_context.example.json)、[`examples/bot_status.example.json`](examples/bot_status.example.json)、[`examples/bot_runner_last_summary.example.json`](examples/bot_runner_last_summary.example.json)。  
**最小结构校验**：`npm run verify:doc-contracts`（见 [`scripts/verify_doc_contract_examples.mjs`](../scripts/verify_doc_contract_examples.mjs)）。

---

## `GET /bot/context` — 最小契约 / API 事实块

以下供脚本对账、排障与 RUNTIME 摘录使用；**仍以 `server.mjs` + 实机响应为准**。

| 项 | 事实 |
|----|------|
| **方法 / 路径** | `GET /bot/context` |
| **默认服务** | 与 Bot 策略 HTTP 一致，默认端口 **53123**（可用 `--port=<n>`） |
| **成功** | **HTTP 200**，`Content-Type: application/json`，body 为**顶层扁平 JSON 对象**（**不是** `{ ok: true, data: {...} }` 包装） |
| **失败** | **HTTP 500**（或实现中其它 5xx），body 通常为 `{ "ok": false, "error": "<message>" }`；客户端应同时检查 HTTP 状态与 body |
| **稳定键（建议脚本依赖）** | `window_id`、`btc_price`、`anchor_btc`、`atr_5m`、`upper_bound`、`lower_bound`、`bid_yes`、`ask_yes`、`bid_no`、`ask_no`、`stale`、`updated_at` |
| **诊断 / 扩展键** | `_btc_source_trace`（含 `price_resolution`：BTC 价选用 cache / strike / anchor；`atr_resolution`：ATR 选用；**不参与**订单语义，仅可观测性） |
| **缓存** | 实现未强制 `Cache-Control`；客户端应视为**每次请求即时快照** |

**最小 curl（事实块复现）**：

```bash
curl -sS http://localhost:53123/bot/context
```

---

## `GET /bot/context` — 字段表

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
| `_btc_source_trace` | object | 调试：行情源 init/feed/cache 轨迹；含 `price_resolution`（`kind`：`cache` \| `strike` \| `anchor` \| `none`，及原始 `used_*`）；含 `atr_resolution`（`window_atr_5m_raw`、`window_atr_raw`、`state_atr_5m_raw`、`resolved_atr_5m`） |

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
| `last_tick_summary` | object \| null | 最近一次 tick 摘要（`version`、`reason`、`intents_summary`、`window_id`、`mode`） |
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
| `active_runtime_snapshot` | 仅 `running === true` 时非 null：`config`、`phase`、`current_window_id`、`anchor_btc`、`upper_bound`、`lower_bound`、`last_tick_summary` |

---

## 与其它端点（索引）

| 端点 | 用途 |
|------|------|
| `POST /bot/runner/tick` | 单次 `runSingleTick`；body 可选 `context_override`、`state_override`（对象）；成功时除 runner 输出外新增 `tick_summary`（`version`、`reason`、`intents_summary`、`window_id`、`mode`） |
| `GET /bot/runner/last-summary` | 获取最近一次 tick 摘要：`{ ok, last_tick_at, last_tick_summary }` |
| `GET /bot/logs` | 日志尾部列表；支持 `limit`，并支持可选过滤 `event`、`window_id` |
| `GET /bot/orders` | 订单列表 + `window_scope` + summary |
| `GET /bot/postmortem/latest` | `{ ok, postmortem }` |
| `GET /bot/performance/summary` | `{ ok, summary }`，`detail=1` 含行明细 |
| `GET /bot/decision-preview` | 决策预览（查询参数见实现） |

完整路由实现见 `server.mjs` 中 `if (req.method === 'GET' && req.url === '/bot/...')` 各分支。

---

## 挂梯语义澄清

- 当前实现为**条件挂梯**，不是“每窗口无条件挂梯”。
- 常见阻断原因包括：
  - `pre_open_or_open_not_open_delay`（open_delay 未到）
  - `spread_too_wide_for_entry`（点差超阈值）
  - `ladder_not_posted_all_sides_cancelled`（窗口方向已取消）
- 排障建议：结合 `GET /bot/logs?event=RUNNER_TICK&window_id=<id>` 与 `GET /bot/runner/last-summary` 对账“未挂单原因”。
