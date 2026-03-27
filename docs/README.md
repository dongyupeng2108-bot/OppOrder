# docs/ 索引（BTCQDD）

**本次批量新增/更新的记账性质**：见 **[`DELIVERY_REPORT_DOC_GOVERNANCE.md`](DELIVERY_REPORT_DOC_GOVERNANCE.md)**（文档/治理铺底，非业务闭环）。

| 文档 | 说明 |
|------|------|
| [README_BTCQDD.md](README_BTCQDD.md) | 本地启动、URL、最小验收、权威文档链接 |
| [OWNER_BTCQDD_ONE_PAGER.md](OWNER_BTCQDD_ONE_PAGER.md) | Owner 边界：Bot 主面 vs 旧 strategy 承载层 |
| [MODULE_MAP.md](MODULE_MAP.md) | 五模块 + 子模块 + 排障归因 |
| [P0_WORKSTREAM.md](P0_WORKSTREAM.md) | P0：就绪链 / anchor / bounds，定位→修复→防回归 |
| [BOT_HTTP_CONTRACT.md](BOT_HTTP_CONTRACT.md) | `GET /bot/context`、`GET /bot/status` 字段与 null 语义 |
| [examples/](examples/) | 契约示例 JSON（与 `npm run verify:doc-contracts` 联动） |
| [VERIFY_PLAYBOOK.md](VERIFY_PLAYBOOK.md) | `verify_all_manual`、失败分流、相关脚本索引 |
| [LIVE_GATES.md](LIVE_GATES.md) | Live 闸门（未来阶段，默认不开启） |
| [DEFERRED_SCOPE.md](DEFERRED_SCOPE.md) | 显式不排期：Radar 产品、通用平台、策略生成/回测 |
| [DELIVERY_REPORT_DOC_GOVERNANCE.md](DELIVERY_REPORT_DOC_GOVERNANCE.md) | **交付说明**：DOC/TEST-light 铺底 vs 业务闭环划界 |
| [CURSOR_REVIEW_MERGE.md](CURSOR_REVIEW_MERGE.md) | **Cursor**：审核与合并流程（无自合并、回报格式） |

治理真源始终在 **[`rules/rules/`](../rules/rules/)**。
