# CODE + RUNTIME backlog — 状态与分级记账

**用途**：`anchor/bounds → P0 单主题 → P1` 类 backlog 的**回报与验收口径**；与 [`CURSOR_EXECUTION_REPORTING.md`](CURSOR_EXECUTION_REPORTING.md) §10 一致。

**禁止用语**：勿用「Phase 完成」「计划内三项已全部落地」「todo completed」指代交付——改用 **文档项完成 / 测试辅助完成 / 业务闭环未完成** 及下文的 **情况 A / 情况 B**。

---

## 当前状态（Owner 更新）

| 项 | 状态 |
|----|------|
| **Task1** | **已闭环**（Owner 验收）。 |
| **Task2** | **已闭环**（Owner 验收）。 |
| **Task3（P1 / filled_total）** | **已闭环**（Owner 验收业务闭环）。材料见 [`truth_audit_p1_executor_filled_total.md`](truth_audit_p1_executor_filled_total.md)、`verify_executor_idempotency.mjs`、`collect_filled_total_runtime_reconcile.mjs`。 |
| **新任务 / 并行线** | **模块化 M1 门禁**以本文档（或 Owner 指定的**唯一**主线 backlog）中 **当前最新仍未闭环项** 为准；该项未获 Owner 认定前，**不得**另起与主线冲突的并行任务线（详见 [`MODULAR_ROADMAP.md`](MODULAR_ROADMAP.md) §M1）。**M1 若动 CODE** 仅允许**最小取证/辅助**；**M2 默认须 Owner 显式放行**（同文档 §M1 / §M2 硬约束）。 |
| **合并** | **仅 Owner**；Agent **不得自合并**。 |

**Owner 确认（流程 gate）**：Task1 / Task2 / Task3 **均已收口**；后续工作按 **主线 backlog 最新未闭环项** 滚动门禁（见 [`MODULAR_ROADMAP.md`](MODULAR_ROADMAP.md)）。

---

## 本 plan 何时算「完成」？

**仅以下两种之一**（由 **Owner** 认定；Agent **不得**自行拍板）：

### 情况 A：真正补齐样本（Task1 可闭环）

取得 **真实运行**可复核证据（JSONL / API 摘录 / 日志），能证明：

1. **同窗** `anchor_btc` **不漂移**（spot 变动下锚定价不变）；  
2. **`atr_5m` 缺失**时系统处于 **only not-ready**，**不反复** window init（例如 `window_initialized_at` 不无故重写）；  
3. **`atr_5m` 到位后** `upper` / `lower` 基于**冻结 anchor**出现（与 `atr_multiple` 公式一致）。

**说明**：现网 [`market_scanner.mjs`](../strategies/crypto_binary/market_scanner.mjs) **不返回** `atr_5m`，故 **仅** `GET /bot/context` 轮询时往往**无法**观测「ATR null→非空」。**情况 A** 允许使用 **`POST /bot/runner/tick`**（与 [`verify_anchor_bounds_lifecycle.mjs`](../scripts/verify_anchor_bounds_lifecycle.mjs) 受控段一致）采集 **同一服务端 runner** 上的状态迁移，见 [`truth_audit_anchor_bounds_P0A.md`](truth_audit_anchor_bounds_P0A.md) §3.2 与 [`collect_anchor_bounds_atr_transition_runtime.mjs`](../scripts/collect_anchor_bounds_atr_transition_runtime.mjs)。**不是** Agent 以「采不到」替代完成。

### 情况 B：明确证明「当前环境无法采到该段」+ Owner 认可改完成定义

**必须**由 **Owner 明确拍板**（收窄 Task1 定义、或接受「仅 GET + 无 scanner ATR」为不可达）。  
**禁止**：Agent 自行宣称「采不到所以也算完成」。

---

## 任务边界（历史 + 现行）

| 规则 | 说明 |
|------|------|
| **Task1** | **已闭环**（Owner 验收通过）。 |
| **Task2** | **已闭环**（Owner 验收通过）。 |
| **Task3** | **已闭环**（Owner 验收业务闭环）；文档项 + 测试辅助 + 运行态事实块见各审计稿与脚本。 |
| **整 plan（Task1–3）** | **三线任务已收口**；后续增量以 backlog **新行** 与 **M1 滚动门禁** 为准。 |

---

## 分级定义（与 §10 一致）

| 级别 | 含义 |
|------|------|
| **文档项完成** | 契约/审计稿/字段表/可复现步骤等**文字与示例**已更新且可审 |
| **测试辅助完成** | `verify_*`、示例 JSON 校验、受控场景等通过；**不单独**等于生产业务已证 |
| **业务闭环未完成** | 以 Owner 认定为准 |

---

## 三线任务（记账占位）

### Task 1 — anchor / bounds RUNTIME

- **业务闭环**：**Owner 验收通过**（情况 A，见 `truth_audit_anchor_bounds_P0A.md` §3.2）。  
- **文档项 / 测试辅助**：见该审计稿及 `collect_anchor_bounds_*`、`verify_anchor_bounds_lifecycle.mjs`。

### Task 2 — P0 单主题：**source chain**

- **业务闭环**：**Owner 验收通过**。  
- **材料**：[`truth_audit_source_chain_P0.md`](truth_audit_source_chain_P0.md)、`price_resolution`、`collect_source_chain_runtime.mjs`。

### Task 3 — P1 幂等与 `filled_total`

- **文档项完成**：**认可**（含 [`truth_audit_p1_executor_filled_total.md`](truth_audit_p1_executor_filled_total.md) §3 运行态/API 事实块）。  
- **测试辅助完成**：**认可**（`verify_executor_idempotency.mjs`；`collect_filled_total_runtime_reconcile.mjs`）。  
- **业务闭环**：**Owner 已认可**（与脚本/事实块一致；不得以单次 verify PASS 替代全链路 Owner 裁定历史）。  

---

**合并**：仅 Owner；Agent **不自合并**；每次交付写「**未合并，等待 Owner 审核**」直至合并完成。

---

## 后续任务回报（Agent）

- **门禁**：新开任务线前核对 [`MODULAR_ROADMAP.md`](MODULAR_ROADMAP.md) §M1 与上表 **当前最新未闭环项**（若有）。  
- **不得**宣称「因 verify PASS，生产业务闭环已证」（除非 Owner 已书面认定）。  
- **不得自合并**。
