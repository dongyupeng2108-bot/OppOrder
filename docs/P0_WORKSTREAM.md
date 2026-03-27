# P0 工作流：real runtime 就绪链与 anchor / bounds

> **文档性质**：本文仅描述 P0 相关**工作流与排查顺序**，**不表示** P0 real runtime 问题已在代码侧修复或验证闭环。完整记账说明见 [`DELIVERY_REPORT_DOC_GOVERNANCE.md`](DELIVERY_REPORT_DOC_GOVERNANCE.md)。

本文档将 [`PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) 中 **P0** 与 [`PROJECT_RULES.md`](../rules/rules/PROJECT_RULES.md) 的 **source chain / bounds readiness / anchor** 口径，落实为可执行任务顺序：**定位（Truth Audit）→ 修复验收 → 防回归**。

## P0 问题清单（与 MASTER PLAN 对齐）

| ID | 主题 | 说明 |
|----|------|------|
| P0-A | real runtime **就绪链** | `source init → feed → cache → context → ready`；未就绪不推进依赖动作 |
| P0-B | **窗口基准价** | `anchor_btc` 同一窗口只冻结一次，不随 `btc_price` 漂移 |
| P0-C | **边界与时序** | bounds readiness：`anchor_btc + atr_5m + atr_multiple` 后 `upper/lower`；ATR 缺失可 not ready，但**不得反复 window init**、不得重写 anchor |

## 任务类型与产出（WORKFLOW）

| 阶段 | 类型 | 必须产出 |
|------|------|----------|
| 1 | 定位任务 | real runtime **连续样本**、`first_break_layer`、对账表/结论块；可选 debug 对照 |
| 2 | 修复验收任务 | 最小修复、Fail→Pass、**real runtime 通过证据**、核心回归不回退 |
| 3 | 防回归任务 | 验证脚本或稳定入口、固化不变量路径 |

标准顺序：**先 1 → 再 2 → 再 3**。不在未定位时大面积改执行主链。

## 断裂层排查顺序（建议）

当「未 ready」或「bounds 异常」时，按 **source chain** 自上而下找 **first_break_layer**：

1. 行情源：init 错误、451、代理、备源是否生效（见 `context._btc_source_trace`）。
2. 窗口：`market_scanner` / slug 是否与当前市场一致（5m/15m 前缀）。
3. ATR：`atr_5m` 是否进入 context/state（缺失时允许 not ready，但不得错误 init）。
4. State：`window_initialized_at`、`anchor_btc`、`upper_bound`/`lower_bound` 是否与 PROJECT_RULES §9 一致。
5. Runner：`gate_*` 原因、`PLACE_LADDER` 幂等（非 PLACE_LADDER tick 不新增订单）。

## 相关代码锚点（非 exhaustive）

- 上下文：[`strategies/crypto_binary/bot_context_adapter.mjs`](../strategies/crypto_binary/bot_context_adapter.mjs)
- 状态与 init 补丁：[`strategies/crypto_binary/bot_state.mjs`](../strategies/crypto_binary/bot_state.mjs)
- Tick 与 gate：[`strategies/crypto_binary/bot_runner.mjs`](../strategies/crypto_binary/bot_runner.mjs)
- HTTP：`GET /bot/context`、`GET /bot/status` — 见 [`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md)

## 防回归入口

- 总入口：[`scripts/verify_all_manual.mjs`](../scripts/verify_all_manual.mjs)
- 与 bounds/anchor 强相关：`verify_anchor_bounds_lifecycle.mjs` 等（见 [`VERIFY_PLAYBOOK.md`](VERIFY_PLAYBOOK.md)）
