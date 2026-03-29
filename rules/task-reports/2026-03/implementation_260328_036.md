# TraeTask_260328_036 实施记录（版本测试入口模块化）

## 实施范围

- 前端入口重构：`ui/js/strategy-editor.js`
- 测试编排总入口：`scripts/verify_all_manual.mjs`
- 模块1一键脚本：`scripts/verify_module1_strategy_input.mjs`
- 测试入口路由最小接线：`strategies/crypto_binary/server.mjs`
- 任务审计脚本：`scripts/truth_audit_modular_test_entry_260328_036.mjs`

## 关键改动

- “版本测试”按钮改为“版本测试入口”，点击弹出模块测试面板。
- 面板固定提供 6 个按钮：
  - 模块1 策略与输入
  - 模块2 执行引擎
  - 模块3 实时监控
  - 模块4 运行结果
  - 模块5 版本测试/保障
  - 全链测试
- `/bot/test/run` 新增 `module_key` 最小参数透传，服务端按模块拉起 `verify_all_manual --module=<key>`。
- `verify_all_manual` 新增模块映射，保持 `allchain` 作为总入口兼容路径。
- 新增模块1 wrapper：`verify_module1_strategy_input.mjs`，编排高价值脚本并输出结构化汇总。

## 模块1收录项（覆盖清单）

- 新契约保存/读取与生效语义
- 预览/runtime 一致性
- UP/DOWN 独立梯队
- 逐档 tp_price 绑定
- 方向撤单隔离
- 撤单优先级 / 非 PLACE_LADDER 禁新增 / 防抖 / 去重（关键项）
- 窗口边界与状态重置
- 恢复能力与持久化一致性
- 公式白名单与危险表达式边界
- 观测与证据一致性

## 结果

- 审计结论：`A：模块化测试入口与编排一致`
- 6/6 检查通过。
