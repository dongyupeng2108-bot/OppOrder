# truth_audit_260406_035

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 订单胜率已改为仅统计开仓单（平仓单不计入分子分母）
- 治理结论: ENTRY 与平仓单统计口径在胜率指标中完成隔离

## 核查项
- [PASS] summary 输出 `entry_filled_total` 与 `winning_entry_order_total`
- [PASS] 胜率按 `winning_entry_order_total / entry_filled_total`
- [PASS] UI 胜率口径与文案改为“平仓单不计入”
- [PASS] machine-readable truth_audit JSON 已产出
