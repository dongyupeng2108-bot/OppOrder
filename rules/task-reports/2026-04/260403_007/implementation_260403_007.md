## TraeTask_260403_007 实施记录（Truth Audit，heavy）

### 范围与约束
- 仅定位，不修改业务生产逻辑（server/统计/执行/UI 逻辑均未改）。
- 只审计主链：PM官方结算 -> completed窗口 -> today纳入 -> 前端投影。

### 新增脚本
- `scripts/truth_audit_today_chain_260403_007.mjs`
  - 读取真实运行日志 `data/crypto_binary/logs/bot_2026-04-02.jsonl`
  - 抽取 `2026-04-02T13:59:00Z` 之后的真实 `BOT_FILL` 窗口样本（至少2个）
  - 对账 `/bot/performance/summary?preset=today&detail=1` 与 `last_7d`
  - 对账前端文案投影（`ui/js/strategy-editor.js`）
  - 输出唯一 `first_break_layer`

### 样本
- `btc-updown-5m-1775138400`
- `btc-updown-5m-1775138700`

### 运行
- `node --check scripts/truth_audit_today_chain_260403_007.mjs`：通过
- `node scripts/truth_audit_today_chain_260403_007.mjs ...`：通过，产出审计 JSON/LOG

