# implementation_260406_011

## 任务信息
- task_id: `260406_011`
- 类型: 业务实现任务
- 目标: 强化 `/bot/runner/tick` 请求契约校验

## 实施内容
- 修改：
  - `strategies/crypto_binary/server.mjs`
  - 增加 `validateTickOverrideContracts` 规则校验
- 新增真实运行审计脚本：
  - `scripts/truth_audit_runner_tick_contract_260406_011.mjs`
