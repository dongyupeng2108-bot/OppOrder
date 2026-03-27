# Phase A — Truth Audit（单主题：anchor / bounds）

**计划状态（CODE+RUNTIME backlog）**：**Task1（本主题）Owner 验收通过**（见 [`BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md`](BTCQDD_CODE_RUNTIME_BACKLOG_STATUS.md) **当前状态**）。**仅代表 Task1 闭环**；**不**表示 Task2/Task3 或整 plan 自动完成。

**任务类型**：定位（Truth Audit）+ **RUNTIME 样本**（§3.1 GET 轮询 + §3.2 HTTP tick 链）。  
**完成类型**：**文档项完成**（本稿 + 样本表 + 脚本）；**测试辅助完成**（`verify_anchor_bounds_lifecycle` 可复跑）；**业务闭环（Task1）**：Owner 已按 **情况 A** 验收 §3.2 证据。  
**证据类型**：CODE（采集脚本）+ RUNTIME（JSONL）+ 静态通读。

**代码事实**：[`market_scanner.mjs`](../strategies/crypto_binary/market_scanner.mjs) 当前 **不返回** `atr_5m` / `atr`，故 **仅** `GET /bot/context` 轮询时，`context.atr_5m` 往往长期为 `null`。**「ATR null→非空→bounds」** 在现网 scanner 下 **无法**仅靠 GET 观测到；§3.2 使用 **`POST /bot/runner/tick`**（与 [`verify_anchor_bounds_lifecycle.mjs`](../scripts/verify_anchor_bounds_lifecycle.mjs) 受控段一致）采集 **同一服务端、同一 runner** 上的状态迁移，作为 **情况 A** 的 RUNTIME 等价证据（**非** Agent 自行宣称「采不到即完成」）。

---

## 1. 审计范围（范围锁）

| 包含 | 不包含 |
|------|--------|
| `anchor_btc` 冻结语义、`upper_bound` / `lower_bound` 与 ATR 时序 | source chain 全链、Polymarket API、订单 scope、P1 幂等 |
| [`bot_state.mjs`](../strategies/crypto_binary/bot_state.mjs) `createWindowInitPatch` | 顺手修复、重构 `server.mjs` |
| [`bot_runner.mjs`](../strategies/crypto_binary/bot_runner.mjs) `runSingleTick` 中 needAnchorInit / needBoundsInit | 扩大为「P0 大礼包」 |

---

## 2. first_break_layer（结构性断裂层）

与 [`PROJECT_RULES.md`](../rules/rules/PROJECT_RULES.md) §9、历史 **260326_047/048** 一致，在**静态代码**视角下：

| 层级 | 说明 |
|------|------|
| **第一层（输入）** | `lifecycleAtr = context.atr_5m`（[`bot_runner.mjs`](../strategies/crypto_binary/bot_runner.mjs) L137）。若 ATR 长期为 `null`，bounds 无法算全，属**预期 not ready**，不应反复 window init。 |
| **状态补丁层** | [`createWindowInitPatch`](../strategies/crypto_binary/bot_state.mjs)：`atr == null` 时设置 `anchor_btc`、`window_initialized_at`，**不**写 `upper`/`lower`，`phase: WAIT_CONTEXT_READY`（L106–115）；与「anchor 冻结、bounds 后到时再算」一致。 |
| **Runner 调度层** | `needAnchorInit` / `needBoundsInit`（L141–144）：仅在 `needBoundsInit` 且 `lifecycleAtr !== null` 时才会在 init 路径上写出 bounds；**不会**在 ATR 缺失时用 bounds 分支反复覆盖 anchor（与旧 bug 路径区分）。 |

**结论（代码静态）**：当前实现中，**anchor/bounds 相关语义在 `bot_state` + `bot_runner` 关键路径上与 PROJECT_RULES 对齐**；若线上仍异常，**first_break_layer 更可能上移到「真实 context 中 `atr_5m` / 行情与窗口数据」或运行环境**，而非本段两处核心补丁逻辑本身——需 **RUNTIME** 样本验证。

---

## 3. 连续样本表（模板 + 说明）

### 3.1 RUNTIME 已填样本（可复核）

**采集命令**（53123 服务已启动；`--start_bot=1` 会 `POST /bot/start`、预热后轮询、结束时 `POST /bot/stop`）：

```text
node scripts/collect_anchor_bounds_runtime.mjs --base_url=http://localhost:53123 --start_bot=1 --stop_before_start=1 --warmup_ms=8000 --ticks=35 --interval_ms=1000 --tick_interval_ms=2000
```

**证据文件**（仓库内 JSONL，一行一 tick）：`data/crypto_binary/runtime_samples/anchor_bounds_1774618924159.jsonl`（另有一次仅 stop 态样本：`anchor_bounds_1774618891160.jsonl`）。

**摘要表**（摘自 `anchor_bounds_1774618924159`，running=true 段；`GET /bot/status` + `/bot/context` 合并字段）：

| 时刻/tick | window_id | btc_price（context） | atr_5m | anchor_btc | upper / lower | window_initialized_at | 备注 |
|-----------|-------------|----------------------|--------|------------|---------------|-------------------------|------|
| T0 | btc-updown-5m-1774618800 | 66462.035 | null | 66418.67 | null / null | 2026-03-27T13:42:06.805Z | Bot running，同窗；spot 变动，**anchor 不变** |
| T1 | 同上 | 66442.525 … 66484.335 | null | **66418.67**（全程不变） | null / null | 同上 | **ATR 仍 null**：bounds 未写出，与 §2 预期一致 |
| T2 | 同上 | （采样末 tick） | **仍 null** | 66418.67 | null / null | 同上 | **本窗口采样内未观测到 ATR 非空**；与 scanner **不返回** `atr_5m` 一致；**不**据此声称 Task1「ATR→bounds」已闭环 |

**stop 态对照**（`anchor_bounds_1774618891160`）：`running=false`，anchor/bounds 均为 null，context 仍有 `btc_price` 与 `_btc_source_trace`（REST Coinbase）。

### 3.2 Task1 闭环 — ATR null→非空→首段 bounds（HTTP `/bot/runner/tick` RUNTIME）

**采集命令**（53123 等服务已启动；**不**改 `bot_runner`/`bot_state` 语义）：

```text
node scripts/collect_anchor_bounds_atr_transition_runtime.mjs --base_url=http://localhost:53123
```

**证据文件**：`data/crypto_binary/runtime_samples/anchor_bounds_atr_transition_tick_1774621094762.jsonl`（每行一条 `POST /bot/runner/tick` 响应摘要 + 末行 GET 快照）。

**摘要表**（同窗 `audit-atr-*-w1`，`atr_multiple`=1.2）：

| 步骤 | `context_override.btc_price` | `atr_5m` | `state_after.anchor_btc` | `upper` / `lower` | `window_initialized_at` | 备注 |
|------|-------------------------------|----------|----------------------------|-------------------|-------------------------|------|
| T0 | 100 | null | 100 | null / null | （首 init 时间戳） | anchor 冻结起点 |
| T1 | 130（spot 变动） | null | **100** | null / null | **同 T0** | **同窗 anchor 不漂移**；ATR 仍缺 → 仅 not-ready，**未**重复 window init 时间戳 |
| T2 | 160 | **2** | **100** | **102.4** / **97.6** | 同 T0 | **ATR 到位后** bounds = anchor ± atr×mult，基于**冻结 anchor** |

**Owner 验收（情况 A）**：上述三行加上「不反复 init」（`window_initialized_at` 不变）即构成 **情况 A** 的可复核块；**不得以「GET 采不到」单独替代**，除非走 **情况 B**（Owner 明确收窄完成定义或认定环境不可采）。

以下为 **扩展复采** 用的空行模板（若需纯 GET + scanner 将来提供 `atr_5m` 时）：

| 时刻/tick | window_id | btc_price | atr_5m | state.anchor_btc | state.upper/lower | window_initialized_at | 备注 |
|-----------|-------------|-----------|--------|-------------------|---------------------|-------------------------|------|
| T0 | | | | | | | Bot running，当前窗口 |
| T1 | | | | | | | ATR 仍 null 时 |
| T2 | | | | | | | ATR 到达后首 tick |

**采集接口**：`GET /bot/status`、`GET /bot/context`；日志事件 `BOT_WINDOW_INITIALIZED`、`BOT_DECISION_GATED`（gate_context_not_ready_bounds 等）。

**说明**：`/bot/status` 的 `phase` 会经 runner `inferPhase` 覆盖为决策相位（如 `IDLE`），**不宜单独**作为「WAIT_CONTEXT_READY」判据；以 **anchor / atr_5m / upper / lower / window_initialized_at** 与 §2 对照为准。

---

## 4. 结论块

1. **代码静态审查**：`createWindowInitPatch` 与 `runSingleTick` 的 anchor/bounds/init 分支**未发现**与「同窗 anchor 只冻一次、ATR 缺失不反复 init、bounds 后算」相矛盾的逻辑。  
2. **RUNTIME（§3.1 GET）**：同窗内 `anchor_btc` 在 spot 变动下可保持恒定；`atr_5m` 在 scanner 无字段时 **null** → **upper/lower** **null**，与预期一致。  
3. **RUNTIME（§3.2 tick 链）**：在 **同一 HTTP 服务**上复现 **ATR null→非空→bounds**，且 **anchor 冻结**、**window_initialized_at 不反复**，与 `verify_anchor_bounds_lifecycle` 受控断言一致 — **供 Owner 按情况 A 验收 Task1**。  
4. **建议**：持续运行时可继续用 §3.1；scanner 若将来返回 `atr_5m`，可再采 **纯 GET** 对照 §3.2。

---

## 5. 未覆盖边界（诚实记账）

- **§3.1**：在现网 scanner 下**无法**观测「GET 路径上 atr 从 null→非空」；**不是** Task1 缺失的借口，**情况 A** 已由 §3.2 补齐待 Owner 审。  
- **Phase B**：本文件**不**隐含「已修复业务代码」；若需改 scanner 以输送 ATR，须**单独**任务与范围锁。  
- **Agent**：**不得**自称「采不到所以完成」；**情况 B** 仅 Owner 可认。

---

*审计日期：以提交日为准；主题：仅 anchor/bounds。*
