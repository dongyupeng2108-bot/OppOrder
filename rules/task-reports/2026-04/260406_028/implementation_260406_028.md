# implementation_260406_028

## 任务信息
- task_id: `260406_028`
- 类型: 业务实现任务（修复）
- 目标: T3 二次补强窗口级关键日志诊断

## 实施内容
- 修改：
  - `ui/js/strategy-editor.js`
  - 关键模式新增 `BOT_DECISION + window_id` 补拉
  - 合并日志后按 `ts` 升序稳定排序
- 新增修复审计脚本：
  - `scripts/truth_audit_t3_fix_log_gap_phase2_260406_028.mjs`
