# 主链口径绑定图（C1-3）

## 作用说明

- 本绑定图的作用是把总口径变成可开发、可验收、可追责的真源索引。
- 任何高风险口径若缺少绑定项，不应视为“已被工程化掌控”。
- 触碰这些口径时，不能只做模块验收，仍需整链验收。

## 首批 6 条口径绑定表

| 口径名 | 代码锚点（文件/模块） | 主要 API / 对外面 | 主要 UI 消费点 | verify / runtime 证据入口 | 是否触发整链验收 |
|--------|------------------------|-------------------|----------------|----------------------------|------------------|
| `anchor_btc` | `strategies/crypto_binary/bot_state.mjs`（`createWindowInitPatch`）；`strategies/crypto_binary/bot_runner.mjs`（同窗冻结与 gate） | `GET /bot/context`、`GET /bot/status` | `ui/js/strategy-editor.js`（`anchor=`、状态概览） | `scripts/verify_anchor_bounds_lifecycle.mjs`；`scripts/collect_anchor_bounds_runtime.mjs` | 是 |
| `upper_bound / lower_bound / bounds_ready` | `bot_state.mjs`（bounds 计算）；`bot_runner.mjs`（`gate_context_not_ready_bounds`、`gate_bounds_ready`） | `GET /bot/context`、`GET /bot/status` | `ui/js/strategy-editor.js`（边界提示与状态展示） | `verify_anchor_bounds_lifecycle.mjs`、`verify_window_lifecycle.mjs`；`collect_anchor_bounds_atr_transition_runtime.mjs` | 是 |
| ATR 缺失时系统行为 | `bot_runner.mjs`（ATR 缺失下 readiness/gate 分支）；`market_scanner.mjs`（ATR 供给侧） | `GET /bot/context`、`GET /bot/status`、`POST /bot/runner/tick`（受控核验） | `strategy-editor.js`（context 轮询与 not-ready 展示） | `verify_anchor_bounds_lifecycle.mjs`；`collect_anchor_bounds_atr_transition_runtime.mjs`；`docs/truth_audit_anchor_bounds_P0A.md` | 是 |
| `current / active / last` | `bot_state.mjs`（`current_window_id`/`last_window_id` 切换）；`bot_runner.mjs`（生命周期推进）；`server.mjs`（状态对外重写） | `GET /bot/status`、`GET /bot/context` | `strategy-editor.js`（`window=`、活动窗口、上一窗口展示） | `verify_window_lifecycle.mjs`、`verify_order_scope_and_status.mjs`；运行态 timeline 采样 | 是 |
| `filled_total` | `strategies/crypto_binary/bot_order_ledger.mjs`（summary 统计）；`server.mjs`（summary/postmortem/performance 链） | `GET /bot/orders`、`GET /bot/status`、`GET /bot/postmortem/latest`、`GET /bot/performance/summary` | `strategy-editor.js`（`se-prev-filled-total`、`se-last-filled-total`、`se-perf-filled-total`） | `verify_executor_idempotency.mjs`、`verify_result_chain_consistency.mjs`；`collect_filled_total_runtime_reconcile.mjs` | 是 |
| PNL 分区口径 | `server.mjs`（`postmortem` 持久化与 `performance summary` 聚合）；结果链相关模块 | `GET /bot/postmortem/latest`、`GET /bot/performance/summary` | `strategy-editor.js`（上一窗口 PNL vs 总计PNL 区块） | `verify_pnl_chain_consistency.mjs`、`verify_runtime_to_business_result.mjs`；`docs/RESULTS_PNL_CONTRACT.md` 对账规则 | 是 |

## 绑定使用规则（最小）

- 绑定图优先回答“谁生产、经什么接口暴露、由哪里消费、靠什么验收”。
- 若某口径缺少代码/API/UI/verify-runtime 任一关键绑定，按“未受控口径”处理。
- 本文档为 C1-3 索引，不替代 `BTCQDD_CORE_SEMANTICS.md` 的口径定义正文。
