# truth_audit_260406_031

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 胜率口径已从窗口胜率切换为订单胜率
- 治理结论: 分母为总成交订单、分子为盈利订单的口径已在服务端与UI一致

## 核查项
- [PASS] UI 标签改为“订单胜率”
- [PASS] 服务端 summary 输出 `winning_order_total` 与 `order_win_rate`
- [PASS] UI 计算按 `winning_order_total / filled_total`
- [PASS] machine-readable truth_audit JSON 已产出
