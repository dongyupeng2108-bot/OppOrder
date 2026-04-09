# implementation_260406_034

## 任务信息
- task_id: `260406_034`
- 类型: 业务实现任务（修复）
- 目标: 参数撤单不再误撤平仓单（TAKE_PROFIT/EXIT）

## 实施内容
- 修改：
  - `strategies/crypto_binary/bot_order_ledger.mjs`
  - 撤单逻辑限定为仅撤销 `ENTRY` 且 `OPEN` 的订单
  - `TAKE_PROFIT/EXIT` 不再被 `CANCEL_YES_OPEN` / `CANCEL_NO_OPEN` / `CANCEL_ALL_OPEN` 撤销
- 新增修复审计脚本：
  - `scripts/truth_audit_cancel_scope_entry_only_260406_034.mjs`
