# Phase A — Truth Audit（单主题：anchor / bounds）

**任务类型**：定位（Truth Audit），**不重写业务代码**。  
**完成类型**：DOC + 审计结论（**非 RUNTIME 闭环**；见文末未覆盖项）。  
**证据类型**：CODE（静态通读）+ 文档化样本表模板。

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

以下为 **Owner 在 real runtime 下填写** 用的模板；本审计**未**代填实测数据。

| 时刻/tick | window_id | btc_price | atr_5m | state.anchor_btc | state.upper/lower | window_initialized_at | 备注 |
|-----------|-------------|-----------|--------|-------------------|---------------------|-------------------------|------|
| T0 | | | | | | | Bot running，当前窗口 |
| T1 | | | | | | | ATR 仍 null 时 |
| T2 | | | | | | | ATR 到达后首 tick |

**采集接口**：`GET /bot/status`、`GET /bot/context`；日志事件 `BOT_WINDOW_INITIALIZED`、`BOT_DECISION_GATED`（gate_context_not_ready_bounds 等）。

---

## 4. 结论块

1. **代码静态审查**：`createWindowInitPatch` 与 `runSingleTick` 的 anchor/bounds/init 分支**未发现**与「同窗 anchor 只冻一次、ATR 缺失不反复 init、bounds 后算」相矛盾的逻辑。  
2. **未证明**：真实网络下长期运行无漂移；需上表 **RUNTIME** 填充。  
3. **建议**：在持续观测前，可运行 [`scripts/verify_anchor_bounds_lifecycle.mjs`](../scripts/verify_anchor_bounds_lifecycle.mjs)（受控 + real 样本）作为 **TEST** 辅助，**不替代**上表 real runtime。

---

## 5. 未覆盖边界（诚实记账）

- **RUNTIME**：未在本任务中启动 53123、未采集真实连续样本。  
- **Phase B**：本文件**不**隐含「已修复代码」；若需改代码，须**单独**开 Phase B 任务与范围锁。

---

*审计日期：以提交日为准；主题：仅 anchor/bounds。*
