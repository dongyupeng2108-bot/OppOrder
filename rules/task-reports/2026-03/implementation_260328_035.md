# TraeTask_260328_035 实施记录（观测与证据一致性审计）

## 审计范围与边界

- 仅新增只读审计脚本与本 task 证据文件。
- 未修改执行主链、UI、signer/余额链、PNL/today。

## 审计方法

- 035-A（real runtime 连续样本）：
  - 启动 bot 连续采样 `status + decision-preview + orders`。
  - 按 `last_tick_at` 去重，核对 `last_reason` 与 `preview.reason`。
  - 通过 summary 增量推断动作（PLACE / CANCEL_OR_CLOSE / NO_CHANGE）并做 reason-动作冲突检查。

- 035-B（三类对照）：
  - 用 `/bot/runner/tick` 构造 noop / place / cancel 三类 tick，对照 reason 与 intents 类型。

- 035-C（summary 对账）：
  - 用 `/bot/orders` 明细聚合统计值，对比 summary 的核心计数。

- 035-D（证据结构）：
  - 校验输出包含 `conclusion_block / key_counters / first_break_layer / evidence_index`。

## 结果

- 结论：`A：观测与证据一致`
- 4/4 检查通过。
