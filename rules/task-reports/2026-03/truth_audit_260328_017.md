# TraeTask_260328_017 Truth Audit（/bot/account pm_balance_usd）

## 结论

- first_break_layer：**A — SIGNER_NOT_RUNNING**
- 结论依据：本机 `127.0.0.1:53199` 未监听，TCP 直连超时，`/health` 与账户只读端点全部超时，尚未进入“接口契约匹配”或“上游代理”层。

## 关键事实

1. 端口层：
   - `PORT_53199_LISTENING=false`（netstat）
   - `TCP_53199_CONNECT=TIMEOUT`（TcpClient）
   - `curl --max-time 2 http://127.0.0.1:53199/health -> timeout`

2. 端点层（在端口不可达前提下）：
   - `/health /account /balance /wallet /pm/account /pm/balance /clob/account /clob/balance` 全部超时。

3. 历史 /trading/account 链路：
   - `OppRadar/trading_routes.mjs` 的 `GET /trading/account` 从 `global_config.virtual_notional` 读取 paper 余额，不依赖 signer 53199。

4. 代理注入相关：
   - 仓库内外网请求统一代理注入入口是 `proxy_agent.mjs`（undici global dispatcher）。
   - BTCQDD live 执行链通过 `../../OppRadar/trading_executor_live.mjs` 访问 signer（`SIGNER_URL=127.0.0.1:53199`）。
   - signer-agent 本体不在本仓库（`**/*signer*.*` 无结果），无法在本任务内直接核对其是否注入代理访问 PM 外网。

## 下一步最小修复建议（仅 1 条）

- 先在本机拉起并确认 signer-agent 本体（`127.0.0.1:53199`）稳定监听，再复跑同一端点探测；若端口恢复但账户端点仍无效，再进入 B（接口契约不匹配）分流。
