# implementation_260405_002

## 任务信息
- task_id: `260405_002`
- 类型: 修复验收任务（Fix + Acceptance，heavy）
- 目标: 修复跨窗口成交，确保旧窗口订单不会在新窗口成交

## 实施内容
- 执行层修复：
  - `strategies/crypto_binary/bot_order_ledger.mjs`
  - `strategies/crypto_binary/bot_runner.mjs`
- 新增真值审计脚本：
  - `scripts/truth_audit_cross_window_fill_fix_260405_002.mjs`
- 更新任务指针：
  - `rules/LATEST.json` -> `260405_002`

## 修复摘要
- 在 `applyFills` 增加当前窗口约束：若订单 `window_id` 与 `context.window_id` 不一致，则阻断该成交候选
- 返回 `blocked_cross_window_candidates` 审计字段
- 在 runner 中输出 `BOT_CROSS_WINDOW_FILL_BLOCKED` 事实事件
- `BOT_FILL` 增补 `kind` 与 `order_window_id` 字段，便于审计复核
