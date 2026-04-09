# implementation_260406_035

## 任务信息
- task_id: `260406_035`
- 类型: 业务实现任务（修复）
- 目标: 订单胜率分子分母排除平仓单，仅统计开仓成交

## 实施内容
- 修改：
  - `strategies/crypto_binary/server.mjs`
  - 增加并落库 `bot_entry_filled_total`
  - 订单胜率分母改为 `entry_filled_total`
  - 分子改为 `winning_entry_order_total`
- 修改：
  - `ui/js/strategy-editor.js`
  - 胜率计算改为基于 `entry_filled_total`
  - 文案明确“平仓单不计入”
- 新增修复审计脚本：
  - `scripts/truth_audit_order_win_rate_entry_only_260406_035.mjs`
