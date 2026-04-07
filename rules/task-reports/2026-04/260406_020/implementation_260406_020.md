# implementation_260406_020

## 任务信息
- task_id: `260406_020`
- 类型: 业务实现任务
- 目标: 增加业务可配置点差门限 `max_spread_bps`

## 实施内容
- 修改：
  - `strategies/crypto_binary/server.mjs`
  - `strategies/crypto_binary/bot_strategy.mjs`
  - 新增 `max_spread_bps` 配置项并接入 runner
- 策略行为：
  - 宽点差超过阈值时，首次挂梯被拦截（`spread_too_wide_for_entry`）
  - 放宽阈值后恢复挂梯流程
- 新增真实运行审计脚本：
  - `scripts/truth_audit_max_spread_guard_260406_020.mjs`
