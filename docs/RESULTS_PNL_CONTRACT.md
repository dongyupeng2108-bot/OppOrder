# 运行结果模块 PNL / 结果字段薄契约（M2-4）

## 一页结论

- 结果模块当前围绕三类对象：`postmortem`、`last_run_snapshot`、`performance_summary`。
- “上一窗口结果 PNL”与“近期表现摘要 总计PNL”是两条不同口径：前者单窗口，后者阶段汇总，禁止混用。
- 结果模块可按模块开发/验收，但只要改动触碰 PNL 分区口径或 summary 真值链，仍需整链验收。

## 1) 当前主要对象

- `postmortem`：单窗口结束后的结果对象，承载窗口级结果字段。
- `last_run_snapshot`：最近一次运行快照，承载运行态到结果态的衔接字段。
- `performance_summary`：阶段聚合结果，承载总计类统计字段（含总计PNL）。

## 2) “上一窗口结果 PNL”口径与来源

- 口径：仅表示“上一已结算窗口”的结果值，不等价于阶段累计。
- 来源：`postmortem.latest`（以及其在 `last_run_snapshot` 中的窗口结果映射）。
- 使用边界：用于展示“上一窗口结果”或窗口复盘，不得当作“近期表现总计”。

## 3) “近期表现摘要 总计PNL”口径与来源

- 口径：阶段范围内累计/聚合后的总计结果。
- 来源：`performance_summary.realized_gross_pnl_total`（UI 文案为“总计PNL”）。
- 使用边界：用于近期表现摘要，不得回填覆盖单窗口结果字段。

## 4) 单窗口 vs 阶段汇总（禁止混用）

- 单窗口结果字段只回答“某一窗口”的输赢与结果，不回答阶段累计。
- 阶段汇总字段只回答“一段周期”的累计表现，不回答单窗口细节。
- 任一改动若跨越这两类字段边界，必须补整链验收（API -> UI -> verify -> runtime）。

## 极简字段边界表

| 字段/区块 | 当前口径 | 来源接口/对象 | 主要消费者（UI/API） | 禁止的误用 |
|-----------|----------|---------------|----------------------|------------|
| 上一窗口结果 PNL | 单窗口结果值 | `postmortem.latest` / `last_run_snapshot` | 近期表现中的“上一窗口结果”展示 | 当作“阶段总计PNL” |
| `last_run_snapshot` 结果区块 | 最近一次运行快照（含窗口结果映射） | `last_run_snapshot` | 状态页、复盘页 | 用快照字段替代聚合摘要真值 |
| `postmortem.latest` | 单窗口结算结果真值 | `/bot/postmortem/latest` | 结果详情、复盘展示 | 直接累计成阶段总计而不经 summary |
| `performance_summary.realized_gross_pnl_total` | 阶段汇总总计PNL | `/bot/performance/summary` | 近期表现摘要、总览卡片 | 反向覆盖单窗口结果字段 |
| “总计PNL” 文案区块 | 阶段汇总展示名 | `performance_summary` 映射 | UI 摘要区块 | 与“上一窗口结果PNL”混标同义 |

## 使用规则（最小）

- 讨论结果口径时，先判定目标字段属于“单窗口结果”还是“阶段汇总”。
- 任何涉及 PNL 分区口径或 summary 真值链的变更，默认触发整链验收而非仅模块自测。
- 本文档为 M2-4 的薄契约说明，不替代 `PROJECT_RULES` 与 API 契约正文。
