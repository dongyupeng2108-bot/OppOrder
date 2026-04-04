## TraeTask_260404_003 实施记录（completed 单成交窗口结算收益投影修复）

### 范围与约束
- 仅修改 `strategies/crypto_binary/server.mjs` 的窗口级 realized 投影链。
- 未改 UI、PM probe/VPN、today reset 机制本身、订单 fill 采集链、verify_all_manual、三大文档。

### 修复内容
- `getScopedRealizedGrossPnlTotalForState` 增加 `settlement_outcome` 输入：
  - 对 `completed` 且存在 ENTRY 但无 EXIT 的 side，按终态结算投影 realized：
    - 胜：`1 - entry_notional`
    - 负：`0 - entry_notional`
  - 有 EXIT 的 side 维持原口径（EXIT-ENTRY）。
- `finalizeBotRunSnapshot` 改为异步：
  - 优先尝试官方结果（Polymarket event resolved outcome）。
  - 官方不可用时，使用内部结果推断（优先 anchor vs last btc_price，兜底盘口阈值）。
  - 将 outcome 传给窗口 scoped realized 计算，不写 summary 级值。
- postmortem 增加 outcome 证据字段并在 summary rows 暴露：
  - `settled_outcome_official`
  - `settled_outcome_internal`

### 修复后核心结果
- reset 后新 completed 且 `filled_total=1` 的真实窗口：
  - `btc-updown-5m-1775312400`：entry YES@0.29，internal DOWN，row/truth=`-0.29`
  - `btc-updown-5m-1775312100`：entry YES@0.01，internal UP，row/truth=`0.99`
- 不再出现“single fill completed 但 row realized=0”污染。

### 不回退检查
- running window 仍不提前计入 today/completed。
- stop 语义保持：仅停策略，不停统计链；stop 后 summary 可继续查询。
- 有 EXIT 的窗口口径未改坏（row/truth 一致）。
