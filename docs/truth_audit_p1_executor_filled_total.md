# P1 Truth Audit — 执行层幂等与 `filled_total` 真值链（Task3）

**CODE+RUNTIME backlog**：对应 **Task3**。见 [`BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md)。

**Owner 记账（当前）**：

- **认可**：**文档项完成** + **测试辅助完成**。  
- **不认可**：**业务闭环完成**（须另行验收；**不把** verify PASS 或脚本单独当生产闭环）。  
- **在未获 Owner 认可业务闭环前**：**不得开启新任务**（本仓库内不另起并行任务线）。

---

## 1. 与 MASTER PLAN P1 对齐（代码链）

| 环节 | 锚点 | 说明 |
|------|------|------|
| 账本 | [`bot_order_ledger.mjs`](../strategies/crypto_binary/bot_order_ledger.mjs) | `getSummary().filled_total`：**FILLED 订单条数**；`getPaperSummary().filled_total` 为 **另一口径**（entry/exit 计数，见同文件） |
| Runner | [`bot_runner.mjs`](../strategies/crypto_binary/bot_runner.mjs) | `RUNNER_TICK` 日志 `data.filled_total` 来自 `getSummary()` |
| HTTP 汇总 | [`server.mjs`](../strategies/crypto_binary/server.mjs) | `GET /bot/paper/summary`：`getBotPaperSummaryScoped()` 覆盖 `filled_total` 为 **窗口内唯一 FILLED `order_id` 数** |
| 持久化 / 绩效 | `server.mjs` + DB | `last_run_snapshot`、`postmortem`、`performance` 行内 `filled_total` |

---

## 2. 测试辅助（整包回归）

```text
node scripts/verify_executor_idempotency.mjs
```

其中 `filled_total_chain_pass` 与 `captureFillPath` 断言一致（多场景串联）。

---

## 3. 运行态 / API 对账事实块（**最小、可复核**）

**目的**：在 **单一场景**（`fill_yes_path_v1`）结束后的**同一瞬间**，对五端 HTTP 做字段对账，产出 **JSON 事实文件**（与 `verify_executor` 内 `captureFillPath` **同源**，不依赖「verify 跑完后」的偶然进程状态）。

### 3.1 复现命令

```text
node scripts/collect_filled_total_runtime_reconcile.mjs --base_url=http://localhost:53123 --spawn_server=true
```

- `--spawn_server=false`：使用已启动的服务（端口与 `base_url` 一致）。  
- 成功时 **退出码 0** 且 `filled_total_chain_pass: true`；失败时仍写 JSON（`exit 1`）便于排障。

### 3.2 五端 GET（对账字段）

| 顺序 | 方法 | 路径 | 参与 `filled_total` 的字段 |
|------|------|------|-----------------------------|
| 1 | GET | `/bot/orders` | `window_orders[]` 中 `status===FILLED` 的 **唯一 `order_id` 数**（记为 **N**） |
| 2 | GET | `/bot/paper/summary` | `filled_total` 应等于 **N** |
| 3 | GET | `/bot/status` | `last_run_snapshot.filled_total` 应等于 **N** |
| 4 | GET | `/bot/postmortem/latest` | `postmortem.filled_total` 应等于 **N** |
| 5 | GET | `/bot/performance/summary?preset=today&detail=1` | 与当前窗口 `window_id` 匹配的最新行 `filled_total` 应等于 **N** |

### 3.3 样本事实文件（仓库内）

| 字段 | 示例值（一次成功跑） |
|------|----------------------|
| 证据文件 | `data/crypto_binary/runtime_samples/filled_total_runtime_reconcile_1774622773068.json` |
| `table.unique_filled_order_id_count` | `1` |
| 各端 `filled_total` | 均为 `1` |
| `filled_total_chain_pass` | `true` |

（复跑会生成新文件名；以最新 JSON 为准。）

### 3.4 与「仅 GET 快照」的区别

[`collect_filled_total_chain_runtime.mjs`](../scripts/collect_filled_total_chain_runtime.mjs) 只对**当前**状态做 GET，**不**驱动 fill 场景；**严格链对齐**请用 **`collect_filled_total_runtime_reconcile.mjs`**。

---

## 4. 诚实记账

- **文档项完成**：本稿 + 事实块 §3。  
- **测试辅助完成**：`verify_executor_idempotency` + `collect_filled_total_runtime_reconcile`（可复跑）。  
- **业务闭环**：**未完成**（Owner 当前不认可）；生产对账仍以 Owner 为准。  
- **未合并，等待 Owner 审核**；**不自合并**。
