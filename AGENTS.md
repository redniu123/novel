# Repository Instructions

## 项目定位

本项目基于 InkOS 进行二次开发，第一阶段目标是完成单本走量小说前 20-30 章的可控生产。

## 当前阶段

TASK-005“真实小说连续生产与生成质量闭环”已由用户批准启动，当前处于设计审查和
运行参数冻结阶段。TASK-003A/003B 代码已完成，TASK-003 总任务仍待真实模型人工验收，
可复用 TASK-005 证据但不得自动宣称完成。

## 开始任务前必须读取

- `docs/00-product-brief.md`
- `docs/PROJECT-STATUS.md`
- `docs/tasks/TASK-INDEX.md`
- `docs/tasks/TASK-004-COMPLETION-AND-NEXT-STEPS.md`（跨设备最新交接事实）
- `docs/tasks/TASK-005-continuous-generation-quality-loop.md`
- `docs/decisions/ADR-002-observation-first-generation-validation.md`
- 当前任务对应的 TASK 文档
- 与任务相关的模块设计文档
- 相关 ADR

## 事实来源优先级

1. 当前真实代码和测试结果；
2. 已批准的 TASK 文档；
3. ADR 决策记录；
4. Markdown 架构与需求文档；
5. DOCX 参考文档；
6. 对话中的临时描述。

如内容冲突，不得自行选择，应在任务计划中指出。

## 工程规则

- 不直接重写 InkOS 核心，优先扩展和组合；
- 不重复实现 InkOS 已有能力；
- 故事权威状态与商业运营数据分离；
- 所有小说数据必须由 `book_id` 隔离；
- 每次只完成一个任务单，不修改任务允许范围之外的文件；
- 所有行为变化必须有测试；
- 不提交密钥、Cookie、生成小说、数据库、日志和缓存；
- 不执行破坏性 Git 命令；
- 不在稳定分支 `master`/`main` 上开发，当前稳定分支以 `origin` 实际默认分支为准；
- 未经任务明确授权，不修改依赖、锁文件、许可证和数据库结构。

## 开发前流程

1. 读取任务单；
2. 检查 Git 状态；
3. 定位现有实现；
4. 输出实施计划；
5. 明确修改文件；
6. 明确测试方案；
7. 再开始修改。

## 完成标准

每个任务完成后必须报告：修改文件、设计决策、执行命令、测试结果、未解决问题、风险、手动验证方法和建议下一任务。

## 跨设备与新对话接手

- 以 GitHub `origin/develop` 为跨设备事实源，不依赖本地 bundle、临时目录或旧对话。
- 新对话先读取 `docs/tasks/TASK-004-COMPLETION-AND-NEXT-STEPS.md`，再核对
  `PROJECT-STATUS`、`TASK-INDEX` 和真实代码/测试；文档与代码冲突时按事实来源优先级处理。
- TASK-005 基线遵守观察优先：参数冻结后先连续生成和记录，不在取得真实缺陷前修改
  Prompt、模型路由、记忆、审查或核心管线。入口治理、暂停恢复、审核权限和报表仍是
  候选，不是当前任务授权。
- 任何跨设备交接文档必须提交并推送到 GitHub；不得只留在 `work`、`tmp` 或聊天记录中。
