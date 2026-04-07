# implementation_260406_018

## 任务信息
- task_id: `260406_018`
- 类型: 业务实现任务
- 目标: 增强 `/bot/logs` 查询过滤能力

## 实施内容
- 修改：
  - `strategies/crypto_binary/server.mjs`
  - `GET /bot/logs` 支持 `event` 与 `window_id` 过滤
  - `docs/BOT_HTTP_CONTRACT.md` 同步过滤参数说明
- 新增真实运行审计脚本：
  - `scripts/truth_audit_bot_logs_filters_260406_018.mjs`
