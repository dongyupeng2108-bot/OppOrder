## TraeTask_260403_006 实施记录（heavy Git 校验 local-first）

### 范围
- 仅优化 heavy 下 SnippetCommitMustMatch 的 Git 获取成本，不改判定语义与严格性。
- 不改 light 行为、不改 heavy 检查项定义。

### 脚本改动
- `scripts/gate_light_ci.mjs`
  - Snippet 校验新增日志：
    - `SNIPPET_GIT_STRATEGY=local_first`
    - `SNIPPET_GIT_FETCH_NEEDED=true|false`
  - 策略改造：
    - 先使用本地 `git cat-file / git diff` 信息完成校验
    - 仅信息不足时执行 `git fetch origin --deepen=50`
    - 输出补抓原因与动作：
      - `SNIPPET_GIT_FETCH_REASON=...`
      - `SNIPPET_GIT_FETCH_ACTION=git fetch origin --deepen=50`
  - 治理注入钩子（默认关闭）：`GATE_SNIPPET_FORCE_FETCH=1`

### 验证脚本
- 新增：`scripts/truth_audit_snippet_git_local_first_260403_006.mjs`
- 覆盖：
  - heavy 正常路径（local-first，不补抓）
  - heavy 信息不足路径（最小补抓）
  - light 烟雾路径（行为不变）

