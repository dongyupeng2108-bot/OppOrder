# TraeTask_260330_013 实施记录（atr_input 修复）

## 唯一 first_break_layer

- `atr_input`
- 目标：修复 real runtime 跨窗后 ATR 长期缺失，恢复 `atr_5m -> bounds -> bounds_ready` 合法时序。

## 最小修复

- 文件：`strategies/crypto_binary/bot_context_adapter.mjs`
- 变更：
  - 保留原优先级：`window.atr_5m / window.atr / state.atr_5m`
  - 仅在 `resolvedAtr===null && state.running===true` 时，新增 **Binance klines ATR(绝对值)** 回补路径
  - 引入短 TTL 缓存（8s）与 in-flight 去重，避免频繁拉取
  - 增加诊断 trace 字段：`resolution_kind/latest_fallback_*`

## 语义边界

- 未改 anchor 冻结逻辑
- 未改 upper/lower 公式与 atr_multiple 语义
- 未改下单/撤单/tp/UI/PNL/账户链
- 未通过放宽 `price_or_bounds_null` 或伪造固定 ATR 值过验

## 验证摘要

- Fail->Pass：
  - 修前（260330_011 真实样本）：跨窗后 `atr_5m=null/upper=null/lower=null`，`price_or_bounds_null + NOOP`
  - 修后（本单 real runtime）：跨窗后 `atr_5m` 到位，随后 `upper/lower` 出现，`bounds_ready=true`，进入 `PLACE_LADDER(...)`
- 不回退：
  - 同窗 anchor 只冻结一次
  - 启动窗口仍不挂单
