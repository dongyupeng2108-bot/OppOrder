# implementation_260406_031

## 任务信息
- task_id: `260406_031`
- 类型: 业务实现任务（修复）
- 目标: 将窗口胜率改为订单胜率

## 实施内容
- 修改：
  - `strategies/crypto_binary/server.mjs`
  - `ui/js/strategy-editor.js`
- 服务端新增：
  - `winning_order_total`
  - `order_win_rate`
- UI 调整：
  - 标签改为“订单胜率”
  - 计算口径改为 `winning_order_total / filled_total`
- 新增修复审计脚本：
  - `scripts/truth_audit_t5_order_win_rate_260406_031.mjs`
