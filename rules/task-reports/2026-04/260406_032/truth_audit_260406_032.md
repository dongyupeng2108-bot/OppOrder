# truth_audit_260406_032

## 结论块
- verdict: A（通过）
- first_break_layer: NONE_CHAIN_PASS
- 业务结论: 已修复 `window_initialized_at` 丢失导致的挂单门控误触发
- 治理结论: bounds 已就绪时初始化状态可自愈回填，避免窗口开始后持续 NOOP

## 核查项
- [PASS] 存在 bounds-ready + init-null 的回填逻辑
- [PASS] 门控使用派生 `windowInitialized` 判定
- [PASS] 诊断字段同步使用派生初始化状态
- [PASS] machine-readable truth_audit JSON 已产出
