# BTCQDD 本地开发入口

本文档是 **执行机器人（53123）** 的快速入口；治理与不变量以 [`rules/rules/`](../rules/rules/) 为准。

**文档/治理铺底项与业务闭环的划界**：见 [`DELIVERY_REPORT_DOC_GOVERNANCE.md`](DELIVERY_REPORT_DOC_GOVERNANCE.md)。  
**Cursor 审核与合并（无自合并）**：见 [`CURSOR_REVIEW_MERGE.md`](CURSOR_REVIEW_MERGE.md)。  
**Cursor 执行与回报（完成类型 / 证据 / 防幻觉）**：见 [`CURSOR_EXECUTION_REPORTING.md`](CURSOR_EXECUTION_REPORTING.md)。

## 身份

- **项目主身份**：BTCQDD（非 Opportunity Radar 产品主线）。
- **本页范围**：`strategies/crypto_binary/` + 控制台 UI + `scripts/verify_*.mjs`。

## 启动（沿用仓库现状）

主服务入口为 [`strategies/crypto_binary/server.mjs`](../strategies/crypto_binary/server.mjs)（默认端口 **53123**，可用 `--port=` 覆盖；可用 `--strategy=` 启动旧实例体系）。

在仓库根目录（`E:\OppRadar`）示例：

```bash
node strategies/crypto_binary/server.mjs
```

若根目录 `package.json` 中已有封装脚本，**优先使用已有脚本**，勿另造一套启动链。

## 控制台 URL

- 页面：`http://localhost:53123/ui/strategy-editor.html`（以实际端口为准）

## 环境与行情

- 本地网络可能不稳定；**Binance REST 可能 451**；项目已含 **Coinbase 等备源**，请勿擅自删除。
- 需要时配置 **`HTTPS_PROXY` / `HTTP_PROXY`**（与 `server.mjs` 中 klines/代理逻辑一致）。

## 最小完成检查（改 UI / API 后）

1. 服务能启动，页面能打开。
2. 点击「启动」后：`GET /bot/status`、`GET /bot/context` 响应合理；关键字段无异常 `NaN` / 乱显（字段含义见 [`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md)）。
3. 当前窗口区可见：**BTC 价格**、**UPDOWN 概率**、**波动值**（字段来源见 `PROJECT_RULES` §9 与 [`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md)）。
4. 实时日志刷新；**版本测试**按钮行为正常。
5. 证据优先：**DOM 文本 / 接口 JSON / 日志 / 测试结果**，非截图中心。
6. 契约示例与最小结构校验：`npm run verify:doc-contracts`（不启动服务）。

## 权威文档索引

| 文档 | 路径 |
|------|------|
| 项目规则 | [`rules/rules/PROJECT_RULES.md`](../rules/rules/PROJECT_RULES.md) |
| 工作流 | [`rules/rules/WORKFLOW.md`](../rules/rules/WORKFLOW.md) |
| 主计划 | [`rules/rules/PROJECT_MASTER_PLAN.md`](../rules/rules/PROJECT_MASTER_PLAN.md) |
| Owner 摘要 | [`OWNER_BTCQDD_ONE_PAGER.md`](OWNER_BTCQDD_ONE_PAGER.md) |
| 模块地图 | [`MODULE_MAP.md`](MODULE_MAP.md) |
| P0 工作流 | [`P0_WORKSTREAM.md`](P0_WORKSTREAM.md) |
| Bot HTTP 契约 | [`BOT_HTTP_CONTRACT.md`](BOT_HTTP_CONTRACT.md) |
| 版本测试分流 | [`VERIFY_PLAYBOOK.md`](VERIFY_PLAYBOOK.md) |
| Live 闸门（未来） | [`LIVE_GATES.md`](LIVE_GATES.md) |
| 搁置范围 | [`DEFERRED_SCOPE.md`](DEFERRED_SCOPE.md) |
| Cursor 规则 | [`../.cursor/rules/btcqdd.mdc`](../.cursor/rules/btcqdd.mdc) |

## 根目录其他说明

- [`CLAUDE.md`](../CLAUDE.md) 含仓库级约定（含 53122）；**BTCQDD 日常以本文 + `rules/rules` + `.cursor/rules/btcqdd.mdc` 为主**。
