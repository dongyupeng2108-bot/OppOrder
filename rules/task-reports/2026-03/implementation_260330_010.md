# TraeTask_260330_010 实施记录（ready 主链真值定位）

## 范围与方式

- 本单仅做定位，不做业务修复。
- 仅新增审计脚本与证据文档：
  - `scripts/truth_audit_ready_chain_locate_260330_010.mjs`
  - 本任务证据与摘要文件
- 未修改交易/挂撤单/窗口推进/ready 判定业务逻辑。

## 运行护栏落实

- `MAX_WALL_TIME=20min`（1200000ms）
- `MAX_SILENCE=120s`（120000ms）
- `LOG_TAIL=120`
- 命令采用可终止短样本脚本（单次执行自动结束），未启用无限循环。

## 真实运行与受控对照

- real runtime（真实运行）：
  - 启服后执行 `/bot/start`，连续采样 14 秒；
  - 每秒采集 `/bot/context`、`/bot/status`、`/bot/logs?limit=120`；
  - 覆盖 source init/feed/latest cache/context/readiness/bounds/decision 链路字段。
- debug control（受控样本）：
  - 使用 `/bot/runner/tick` + `state_override/context_override` 触发单次可控决策；
  - 对照同链路阶段矩阵。

## 唯一 first_break_layer

- 结论锁定：`context`
- 断裂特征：
  - real runtime 中持续 `BOT_DECISION_GATED: wait_next_window_after_start`
  - 同时 `decision_reason` 为空、`intents=NOOP`
  - debug control 可直接达到 `decision_reason=ladder_not_posted` 且有 `PLACE_LADDER(...)`
- 因此首个可复核分叉位于 context->ready 门控层，而非 source/bounds/decision 执行层。
