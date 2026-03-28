# TraeTask_260328_014 Truth Audit（PM 信息块）

## 三字段结论表

| 字段名 | 是否存在稳定真值源 | 当前来源位置 | 当前消费位置 | 是否可直接用于 UI 展示 | 风险等级 | first_break_layer |
|---|---|---|---|---|---|---|
| PM账号名 | 否 | `status.saved_config.pm_account_name` / `status.active_runtime_snapshot.config.pm_account_name`（UI候选） | `ui/js/strategy-editor.js` `se_renderPmAccountInfo` | 否（当前仅能占位） | 高 | 执行主链配置白名单（server 仅允许 5 个配置字段） |
| 余额（USD） | 否 | `status.saved_config.pm_balance_usd` / `status.active_runtime_snapshot.config.pm_balance_usd`（UI候选） | `ui/js/strategy-editor.js` `se_renderPmAccountInfo` | 否（当前仅能占位） | 高 | 执行主链配置白名单（server 仅允许 5 个配置字段） |
| 今日盈亏 | 有（但为策略结果口径） | `/bot/performance/summary?preset=today&detail=0 -> summary.realized_gross_pnl_total` | `ui/js/strategy-editor.js` `se_renderPmAccountInfo` | 有（可稳定展示为“策略今日已实现盈亏”） | 中 | 无（源可达）；但与“账户今日盈亏”语义非同一口径 |

## 总结论

- 结论：**B**（不可直接把占位全部替换为真实“账户信息”值；需要单独补账户信息链路）。
- 原因：账号名与余额当前在后端配置白名单中无生产链，UI 读取路径存在但无稳定供给；今日盈亏当前是策略结果链口径，不是账户余额日变化口径。
