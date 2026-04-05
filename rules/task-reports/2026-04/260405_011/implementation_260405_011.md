# implementation_260405_011

## 任务信息
- task_id: `260405_011`
- 类型: Debug 回修任务（Fix）
- 目标: 清理 260405_010 顶层 notify 的整份历史失败噪音

## 实施内容
- 修复 `scripts/assemble_evidence.mjs`：
  - DOD 输入若为整份历史 notify，先提取标准 `DOD_EVIDENCE_STDOUT` 块
  - 过滤历史失败噪音（Report Block / Missing block / Heavy mandatory evidence incomplete）
  - `LOG_HEAD/LOG_TAIL` 同步过滤历史失败噪音
- 新增回修审计脚本：
  - `scripts/truth_audit_notify_full_cleanup_260405_011.mjs`
- 重建顶层 notify：
  - `rules/task-reports/2026-04/notify_260405_010.txt`
- 更新任务指针：
  - `rules/LATEST.json` -> `260405_011`
