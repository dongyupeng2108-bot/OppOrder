# implementation_260406_022

## 任务信息
- task_id: `260406_022`
- 类型: 业务实现任务（定位）
- 目标: 定位 max_spread_bps 参数保存链路契约漂移

## 实施内容
- 新增定位审计脚本：
  - `scripts/truth_audit_t1_contract_drift_260406_022.mjs`
- 定位范围：
  - 后端 `/bot/config` 校验链
  - UI 字段白名单、表单透传、输入项暴露
- 结论属性：
  - 仅定位，不修复
