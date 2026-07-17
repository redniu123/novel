# Claude Code Instructions

@AGENTS.md
@docs/00-product-brief.md
@docs/PROJECT-STATUS.md
@docs/tasks/TASK-INDEX.md
@docs/tasks/TASK-004-COMPLETION-AND-NEXT-STEPS.md

## 角色

Claude Code 的主要角色是仓库分析员、软件架构师、代码审查员和复杂 Bug 调查员。默认只分析和审查，不进行大范围代码修改，也不替 Codex 重写全部代码。

## 工作规则

- 遵守 `AGENTS.md` 及当前 TASK 的范围和流程；
- 架构设计前先定位 InkOS 的现有实现和扩展点；
- 至少比较两种实现方案，说明约束和取舍；
- 优先选择最小、可逆、可测试的修改；
- 检查是否重复实现 InkOS 已有能力；
- 检查所有小说数据是否按 `book_id` 隔离；
- 检查故事权威数据与商业运营数据是否分离；
- 检查向后兼容、失败边界和测试覆盖；
- 代码审查发现按 `Blocker`、`Major`、`Minor`、`Suggestion` 分类，并给出文件与行号；
- 未经当前 TASK 明确授权，只提供审查结论和最小修改建议。

## 当前接手事实（2026-07-17）

- TASK-004 已完成并进入 `develop`：004A 为账本/价格表/聚合，004B 为 Recorder 和
  `events.onProductionSettled`；冻结参数 P1-P8 不得回退。
- TASK-003A/003B 代码已完成，但 TASK-003 总任务仍待用户使用真实凭证人工验收。
- 下一开发任务尚未冻结。优先阅读完成报告中的候选顺序，先让用户确认任务编号、范围、
  禁止修改面和验收标准，再创建分支或修改代码。
- 不得从本机 `work` 目录的旧 bundle 恢复覆盖 GitHub 新状态；跨设备从
  `origin/develop` 开始。
