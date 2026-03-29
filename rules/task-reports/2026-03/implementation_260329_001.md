# TraeTask_260329_001 实施记录（模块测试入口路由/结果回填修复）

## 定位结论

- 唯一分类：**C：结果展示读取旧结果/错结果**
- 复现现象：请求 `module_key=module1`，状态层为 `module1`，但结果接口可在运行中读到旧的 `allchain` 结果。
- 根因：
  - 结果文件命名仅按 `task_id`，不同模块/运行轮次可能复用同一路径。
  - `/bot/test/result` 在运行中可直接返回当前结果文件，缺少 run/module 关联校验与“未就绪”保护。

## 修复点

- `server.mjs`
  - 结果文件改为按 `task_id + module_key + run_id` 命名。
  - 拉起 `verify_all_manual` 时显式传入 `--output=<run scoped file>`。
  - `/bot/test/result` 增加 `run_id/module_key` 关联校验；运行中统一返回 `409 result not ready`，避免旧结果串线。
  - 结果响应补充 `run_id/module_key/module_label`。

- `ui/js/strategy-editor.js`
  - 轮询结果时带上 `run_id + module_key` 查询参数。
  - 新一轮模块测试启动时重置前一轮 `lastRunId/lastResultFile`，避免回填旧缓存。

## 结果

- 点模块1只回填模块1，点 allchain 只回填 allchain。
- 连续模块1 → allchain 结果文件与 run_id 均隔离，不串线。
