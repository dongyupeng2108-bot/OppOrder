# P0 Truth Audit — source chain（单主题，Task2）

**CODE+RUNTIME backlog 记账**：对应 **Task2**（与 anchor/bounds **二选一衔接**，非并行大礼包）。**整 plan 或 Task3 是否完成**不以本文档单独认定；见 [`BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md)。

**完成类型（本次交付）**：

- **文档项完成**：本稿 + [`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md) 字段说明 + [`collect_source_chain_runtime.mjs`](../scripts/collect_source_chain_runtime.mjs) 手顺。  
- **测试辅助完成**：`npm run verify:doc-contracts`（示例 JSON 结构）。  
- **业务闭环**：以 Owner 认可「source chain 可观测性足够 + RUNTIME 样本可复核」为准；**未合并，等待 Owner 审核**。

**范围锁**：仅 context 装配与可观测性（`_btc_source_trace`）；**不改**订单语义、不动 P1、不扩 decision gating / scanner 业务逻辑。

---

## 1. 代码锚点

| 组件 | 作用 |
|------|------|
| [`price_feed.mjs`](../strategies/crypto_binary/price_feed.mjs) | BTC 价 WS/REST，`subscribe` 快照带 `source`（如 `rest_coinbase`） |
| [`bot_context_adapter.mjs`](../strategies/crypto_binary/bot_context_adapter.mjs) | `getContext`、`_btc_source_trace`：`latest_cache_*`、`price_resolution`、`atr_resolution` |

---

## 2. first_break_layer（source chain）

就绪链：**init → feed → cache → context.btc_price**；未就绪时按序 fallback。

| 层级 | 说明 |
|------|------|
| **Feed** | `priceFeed.subscribe` 更新 `latestBtcPrice` / `latestPriceSource`；`source_init_error` 非空表示 init 失败。 |
| **解析** | `context.btc_price` = cache（正）→ 否则 `windowInfo.strike_price` → 否则（running 且同窗）`state.anchor_btc`。 |
| **可观测** | `price_resolution.kind`：`cache` \| `strike` \| `anchor` \| `none`，与上述解析**一致**；`atr_resolution` 区分 scanner / state 的 ATR。 |

若线上「价异常」，优先对照 **first_break_layer**：`source_init_error` → `latest_cache_source` → `price_resolution.kind` → `atr_resolution`。

---

## 3. CODE（最小）

- **`price_resolution`**（[`bot_context_adapter.mjs`](../strategies/crypto_binary/bot_context_adapter.mjs)）：与 `btc_price` 计算**同一分支**写出 `kind` + 原始 `used_strike_raw` / `used_anchor_fallback_raw`，避免口头描述与代码漂移。  
- **不改变** `btc_price` 数值语义（仅重构为单分支 + 诊断字段）。

---

## 4. RUNTIME 复验

1. 启动：`node strategies/crypto_binary/server.mjs`（默认 53123）。  
2. 采集：

```text
node scripts/collect_source_chain_runtime.mjs --base_url=http://localhost:53123 --ticks=8 --interval_ms=600
```

3. 检查 JSONL 每行 `trace.price_resolution.kind` 与 `trace.latest_cache_source`、`trace.atr_resolution` 是否合理。

**证据文件（RUNTIME 样本）**：`data/crypto_binary/runtime_samples/source_chain_1774621859140.jsonl`（`kind: cache`，`latest_cache_source: rest_coinbase`；由 `collect_source_chain_runtime.mjs` 生成，可复跑覆盖新文件）。

---

## 5. 结论块

1. **静态**：source chain 在 adapter 内可端到端映射到 `_btc_source_trace`。  
2. **RUNTIME**：以 Owner 认可的 JSONL 样本为准；**不把**脚本 PASS 单独当业务闭环。  
3. **Task2/整 plan**：Task2 **仅**覆盖 source chain；**不**自动完成 Task3。

---

*主题：仅 source chain（Task2）。*
