# implementation_260406_023

## 任务信息
- task_id: `260406_023`
- 类型: 业务实现任务（修复）
- 目标: 修复 max_spread_bps 参数契约漂移

## 实施内容
- 修改：
  - `ui/js/strategy-editor.js`
  - 新增 `max_spread_bps` 输入项、字段白名单、透传与校验
- 新增修复审计脚本：
  - `scripts/truth_audit_t1_fix_max_spread_260406_023.mjs`
