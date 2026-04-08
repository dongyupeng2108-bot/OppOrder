# implementation_260406_030

## 任务信息
- task_id: `260406_030`
- 类型: 业务实现任务（修复）
- 目标: 修复条件挂梯语义对外澄清不足问题

## 实施内容
- 修改：
  - `ui/js/strategy-editor.js`
  - `docs/BOT_HTTP_CONTRACT.md`
  - 新增“条件挂梯，不是每窗口无条件挂梯”显式澄清
  - 补充阻断 reason 与按窗口对账建议
- 新增修复审计脚本：
  - `scripts/truth_audit_t4_fix_semantics_clarification_260406_030.mjs`
