# TraeTask_260330_002 实施记录（模块1黄金场景回归包 v1）

## 范围结论

- 本单仅建设测试资产与接线：
  - `scripts/verify_module1_strategy_input.mjs`
  - `scripts/verify_module1_golden_scenarios_v1.mjs`（新增）
- 未修改业务逻辑文件：
  - `bot_strategy*.mjs`
  - `bot_runner.mjs`
  - `bot_order_ledger.mjs`
  - `server.mjs`
  - `ui/js/strategy-editor.js`

## 黄金场景回归包 v1（4 场景）

- S1 非对称双边 + tp=1 + 等下一窗口挂单
- S2 一侧成交后头部概率 / 当前窗口状态 / 止盈状态同 tick 同口径
- S3 分方向撤单优先级（120/100/60 阈值行为）
- S4 窗口切换不混旧窗

## 接线

- `verify_module1_strategy_input.mjs` 新增子项：
  - `verify_module1_golden_scenarios_v1.mjs`
- 模块1一键入口 `verify_all_manual --module=module1` 无需改动执行主链，已自动通过 `verify_module1_strategy_input` 间接接入。

## 结果

- 新增黄金脚本单独运行：PASS（4/4）
- 模块1一键测试：FAIL（照实暴露历史失败项，未隐藏/未跳过）
