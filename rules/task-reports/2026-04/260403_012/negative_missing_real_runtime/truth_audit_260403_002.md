## TraeTask_260403_002 验收摘要（today rollup 口径修复）

### 结论块
- 结论：通过（Fail -> Pass）
- 唯一 first_break_layer：`NONE_CHAIN_PASS`
- 修复范围：仅 today UTC 起点归属口径

### Fail -> Pass 关键值
- 修前 today（来自 260403_001）：`window_count=0, filled_total=0, realized=0`
- 修后 today：`window_count=46, filled_total=413, realized=240.3914`
- last_7d 未回退：`window_count≈1476, realized≈1494.9660`

### 两个真实窗口对账
- btc-updown-5m-1775138700（2026-04-02T14:09:41.423Z）
  - 应纳入 today：是
  - 修前纳入：否
  - 修后纳入：是
- btc-updown-5m-1775134200（2026-04-02T12:50:44.239Z）
  - 应纳入 today：是
  - 修前纳入：否
  - 修后纳入：是

### 最小事实块
- /bot/performance/summary?detail=1 修前 today 关键行：`window_count=0, realized=0`
- /bot/performance/summary?detail=1 修后 today 关键行：`window_count=46, realized=240.3914`
- last_7d 修前/修后关键行：`window_count≈1478->≈1476（范围内波动），realized≈1494.9660 保持`
- server healthcheck：`GET / = 200`，`GET /pairs = 404`

