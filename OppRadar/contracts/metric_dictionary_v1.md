# Metric Dictionary v1

**Version**: v1
**Date**: 260301
**Scope**: M4 OpportunityCard extensions — field semantic reference for all downstream modules.

---

## Field Definitions

| 字段名 | 类型 | 语义说明 | 取值规则 | 填写责任方 |
|--------|------|----------|----------|------------|
| `opp_id` | `string` | 机会唯一标识，用于跨快照追踪同一机会的生命周期。区别于 `id`（run 级别），`opp_id` 在多次 scan 中保持稳定。 | 格式同 OpportunityCard `id`（`op_[a-z0-9]{8}`）；首次出现时由 llm_gateway 分配，后续 scan 复用。 | `llm_gateway.mjs` |
| `snapshot_type` | `"draft" \| "deep"` | 标记该卡片来自草案扫描还是深挖快照。`draft` 为快速初筛，`deep` 为带完整证据的精细分析。 | 枚举值二选一；策略插件在 `run()` 输出时指定；缺省视为 `draft`。 | `strategy/<plugin>.mjs` |
| `model_used` | `string` | 生成该卡片时调用的 LLM 模型标识符，用于审计与可复现性。 | 与 `llm_provider.mjs` 返回的 `meta.model_used` 对齐，例如 `"mock-v1"`、`"gpt-4o"`。 | `llm_provider.mjs` → `llm_gateway.mjs` |
| `p_range` | `{ low: float, high: float }` | 概率区间，表示对该机会实现概率的置信区间。`low` 为悲观估计，`high` 为乐观估计，均属 [0,1]。 | `low ≤ high`（应用层强制，JSON Schema 不跨字段校验）；`low` 和 `high` 均为 0–1 浮点数。 | `rank_v2_provider.mjs` |
| `confidence` | `"High" \| "Med" \| "Low"` | 信息质量评估，反映生成该卡片所依据的证据丰富程度与可信度。 | 枚举三档：`High`（多源验证）、`Med`（单源或部分验证）、`Low`（推测为主）。由 LLM 评估步骤填写。 | `llm_gateway.mjs` |
| `risk_triggers` | `string[]`，maxItems: 3 | 风险触发标签列表，最多 3 个，标记在评估过程中识别出的主要风险维度。 | 自由字符串标签，建议使用标准化词汇（如 `"regulatory"`、`"liquidity"`、`"timing"`）；超过 3 项时截取前 3。 | `scan_filter.mjs` / `llm_gateway.mjs` |
| `veto` | `object` | 硬门禁决策对象，记录 veto 引擎的最终裁定及触发依据。 | `decision` 为 `ALLOW / DEGRADE / BLOCK` 之一；`labels` 最多 3 个解释标签；`rule_facts` 为触发规则的键值事实快照。 | `scan_filter.mjs`（veto 引擎） |
| `evidence_refs` | `string[]` | 支持该机会的证据指针列表，可为 URL、文件路径或内部 ID，用于追溯分析依据。 | 无长度上限；建议每项为可解析的引用（URL 或 `data/...` 相对路径）；由 news_provider 和策略插件共同填充。 | `news_provider.mjs` / `strategy/<plugin>.mjs` |

---

## Notes

- 所有 M4 新增字段均为 **optional**，`required` 数组不变（保持 M3 兼容性）。
- `p_range.low ≤ p_range.high` 约束由应用层（`rank_v2_provider.mjs`）在写入前校验，schema 层仅约束各自 [0,1] 范围。
- `model_used` 与 `provider` 字段语义不同：`provider` 为服务商（如 `"openai"`），`model_used` 为具体模型版本。
