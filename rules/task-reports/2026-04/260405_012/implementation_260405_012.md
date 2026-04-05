# implementation_260405_012

## 任务信息
- task_id: `260405_012`
- 类型: 影子模式入口任务（S5 / M2）
- 目标: 落地 shadow-only 入口且不接管真实执行副作用

## 实施内容
- `server.mjs` 配置新增 `shadow_only`：
  - 默认值为 `false`
  - 支持 `/bot/config` 校验、恢复、快照与 runner 内部配置同步
- `bot_runner.mjs` 增加 shadow-only 分支：
  - 仅输出 `BOT_SHADOW_DECISION` 与 `RUNNER_TICK` 审计事件
  - 不调用 `applyIntents/applyFills`，不写业务状态补丁
  - 定义并输出幂等键 `event_id + window_id + context_version`
- 新增真值审计脚本：
  - `scripts/truth_audit_m2_shadow_only_entry_260405_012.mjs`
