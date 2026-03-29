# TraeTask_260329_001 修复验收（模块路由/结果回填不串线）

## 结论

- 验收结论：**PASS**
- 修前失败分类：**C：结果展示读取旧结果/错结果**
- 修后结论：`A：入口路由与结果回填已修复且不串线`
- first_break_layer：`null`

## 最小事实摘录

- 修前请求事实（模块1）：
  - `request_module_key=module1`
  - `backend_status_module_key=module1`
  - 结果却为 `result_module_key=allchain`

- 修复点事实：
  - 结果文件按 `task_id+module_key+run_id` 生成
  - `GET /bot/test/result` 运行中返回 `409 result not ready`
  - 结果查询附带 `run_id/module_key` 关联校验

- 修后模块1：
  - `backend_module_key=module1`
  - `result_module_key=module1`
  - `result_total_scripts=1`

- 修后 allchain：
  - `backend_module_key=allchain`
  - `result_module_key=allchain`
  - `result_total_scripts=11`

- 连续点击（模块1 -> allchain）：
  - `step1_module_key=module1`
  - `step2_module_key=allchain`
  - `step1_run_id != step2_run_id`
  - 两次 `result_file` 均不同且按 run 绑定

- 诊断：
  - `GET / => 200`
  - `GET /pairs => 404`
