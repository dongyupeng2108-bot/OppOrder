# Phase C — anchor / bounds 回归与验证（辅助）

**定位**：**TEST 辅助 + 分流**，不替代 Phase A 的 real runtime 定位（见 [`truth_audit_anchor_bounds_P0A.md`](truth_audit_anchor_bounds_P0A.md)）。

---

## 推荐命令

在仓库根、**服务可访问**时（或脚本自带 `spawn` 成功时）：

```bash
node scripts/verify_anchor_bounds_lifecycle.mjs --task_id=<YYMMDD_NNN>
```

参数与默认见脚本内 `parseVerifyArgs`；样本名常用 `controlled+real_no_debug`。

---

## 失败分流（与 [`VERIFY_PLAYBOOK.md`](VERIFY_PLAYBOOK.md) 一致）

| 现象 | 优先怀疑 |
|------|----------|
| 受控段失败 | 业务语义或 runner/state 回归 |
| 仅 real 段不稳定 | 网络、采样窗口、服务未就绪 |
| 脚本超时 / 连接失败 | 环境、端口、未启动 server |

**硬规则**：脚本 PASS **不单独等于**「真实运行问题已消失」；脚本 FAIL **不单独等于**业务必坏。

---

## 本文件交付的记账用语（勿用「Phase 完成」指代仅写文档）

按 [`CURSOR_EXECUTION_REPORTING.md`](CURSOR_EXECUTION_REPORTING.md) §10：

- **文档项完成**：本文件已存在，且 VERIFY_PLAYBOOK 已增加交叉引用。  
- **测试辅助完成**（若已执行）：见下「附」；**不**等于业务正确或问题已消失。  
- **业务闭环未完成**：未以 **RUNTIME** 填 Phase A 样本表、未证明线上长期无漂移；**禁止**用「Phase C 已完成」等模糊表述。

### 附：一次本地运行记录（TEST，不冒充 RUNTIME）

- 命令：`node scripts/verify_anchor_bounds_lifecycle.mjs --task_id=260327_005`
- 结果：进程 exit 0；控制台 JSON 含 `anchor_frozen_once_pass` 等为 true（证据可能落在 `rules/task-reports/**`，部分路径可能被 `.gitignore` 忽略，以本机为准）。
- **说明**：仅证明脚本在当前环境下通过，**不替代** Owner 按 Phase A 样本表的 real runtime 表填。
