# TraeTask_260328_034 实施记录（公式白名单与危险表达式边界修复）

## 根因定位

- 根因在策略层公式求值器：原实现使用 `Function(...keys, 'return (...)')` 动态执行。
- 当表达式含 `globalThis.process.pid > 0` 时，`globalThis` 未被限制在受控变量集合内，仍可从运行环境解析，导致危险表达式可驱动 `up_cancel_formula`。
- 断裂层定位：**变量白名单与危险表达式边界层（策略层）**，无需改 runner/server 接线。

## 修复范围

- 修改文件：
  - `strategies/crypto_binary/bot_strategy.mjs`
  - `scripts/truth_audit_formula_engine_fix_260328_034.mjs`
- 未修改：
  - `server.mjs`
  - `bot_runner.mjs`
  - UI / signer / 余额链 / PNL / today

## 修复内容

- 在 `bot_strategy.mjs` 内用受控表达式求值替代 `Function` 动态执行：
  - 引入严格 token 化 + 递归下降求值（仅支持受控运算符与括号）。
  - 拒绝对象访问（`.`）、构造器链、白名单外标识符。
- 固定最终白名单变量集合：
  - `secs_left`
  - `spread`
  - `volatility_ratio`
  - `has_open_up_orders`
  - `has_open_down_orders`
  - `btc_price`
  - `upper_bound`
  - `lower_bound`
- 安全失败可观测化：
  - diagnostics 增加 `up_formula_eval` / `down_formula_eval`，含 `ok/code/message/allowed_identifiers`。
  - 常见失败码：`INVALID_CHARACTER`、`IDENTIFIER_NOT_ALLOWED`、`SYNTAX_ERROR`、`FORMULA_TOO_LONG`。

## 验收结论

- 034 修复验收：`A：公式引擎健壮且边界可靠`
- 6/6 通过，危险表达式从 033 的可触发撤单，修复到 034 的安全失败且不触发该方向公式撤单。
