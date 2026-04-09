# implementation_260406_033

## 任务信息
- task_id: `260406_033`
- 类型: 业务实现任务（修复）
- 目标: 修复挂梯单撮合口径，分离 maker/taker 成交语义

## 实施内容
- 修改：
  - `strategies/crypto_binary/bot_order_ledger.mjs`
  - 为订单增加 `post_mode` 与 `posted_price`
  - 挂梯默认 `post_mode=resting_maker`
  - ENTRY 成交时：maker 按 `posted_price`，taker 按盘口价
- 新增修复审计脚本：
  - `scripts/truth_audit_maker_taker_fill_semantics_260406_033.mjs`
