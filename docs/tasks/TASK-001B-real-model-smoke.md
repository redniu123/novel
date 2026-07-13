# TASK-001B：真实模型最小冒烟验证

状态：`completed`
执行日期：2026-07-13
分支：`test/TASK-001B-real-model-smoke`

## 背景

TASK-001 已完成原版构建、测试、CLI、Studio、状态与 SQLite 基线，但真实模型的建书、规划、正文、审查和修订链路此前因缺少合法凭证而未验证。TASK-002 必须以本任务通过为前置门槛。

## 目标

- 使用合法真实模型完成一次最小端到端调用；
- 以一本测试书的第一章验证规划、写作、审查和人工终审边界；
- 验证状态落盘、SQLite 写入、token usage 与 `book_id` 隔离；
- 确认无凭证和测试产物进入 Git。

## 修改范围

- 本任务文档与 `docs/runbooks/real-model-smoke.md`；
- `docs/runbooks/first-inkos-usage.md`；
- `docs/PROJECT-STATUS.md`、`docs/tasks/TASK-INDEX.md`；
- `docs/02-inkos-baseline.md`；
- 被忽略的 `tmp/TASK-001B-real-model-smoke/`。

## 禁止修改范围

InkOS 核心代码、模型路由、系统提示词、审查标准、数据库结构、依赖、锁文件、许可证、正式书籍和任何密钥文件。不得手工伪造状态或把模型输出提交到 Git。

## 执行步骤

1. 检查秘密文件的跟踪、历史和忽略状态；
2. 在 Node 24.14.0、pnpm 9.15.9 下执行构建、类型检查和全量测试；
3. 初始化隔离项目，安全写入项目 `.env` 并由 Studio 官方接口导入；
4. 执行真实 `doctor`；
5. 通过 Studio 建书并生成章节；
6. 以第 1 章核对规划、正文、自动审查、修订决策和人工终审状态；
7. 核对状态、SQLite、usage、隔离和 Git 安全；
8. 更新任务状态并提交非敏感文档。

## 验收标准

真实模型、故事架构、章节规划、第 1 章正文、审查决策链、状态文件、SQLite 写入和 `book_id` 隔离全部通过；全量测试通过；核心代码无修改；所有运行产物被忽略。

## 实际结果

### 安全配置

- `小说key.txt` 存在、可读取、未被跟踪、未进入 Git 历史，并已由精确规则忽略；
- Provider、Service、Base URL、Model、API Key 五项唯一识别；
- Provider 映射为 `openai`，Service 使用 `custom`；
- 模型为 `gpt-5.6-sol`，Base URL 仅记录为第三方 HTTPS OpenAI-compatible 中转；
- 项目 `.env` 和 Studio `.inkos/secrets.json` 均位于被忽略的测试项目内；
- 未把 API Key 写入 `inkos.json`、Markdown、命令参数、日志或 Git 差异。

### 连接与创作链路

- `doctor` 的认证、网络、Chat Completions、流式响应和模型探针通过；探针耗时约 7.4 秒，记录 4,393 tokens；
- AI 建书和故事基础生成成功；
- 第 1 章的章节意图、计划、上下文、规则栈、正文、自动审查和状态结算成功；
- 第 1 章最终 3,617 字，状态为 `ready-for-review`，包含 2 条审查问题；
- 长度归一化执行一次；配置门槛未触发自动修订，修订次数为 0；
- 人工批准没有由 Codex 代替用户执行，原版人工终审边界得到保留；
- 用户体验时又生成了第 2 章。该章不作为本任务验收样本，不删除、不提交，并作为超出单章建议范围的偏差记录。

### 状态与 SQLite

- 结构化状态、Markdown 投影、角色、世界观、时间线、章节摘要、伏笔和章节快照均存在；
- SQLite 位于 `books/<book_id>/story/memory.db`，以书目录实现物理隔离；
- `facts`、`chapter_summaries`、`hooks` 三张表存在并有真实写入；
- 用户体验结束时分别记录 12、2、11 行；这些计数包含体验期间生成的第 2 章；
- 表内没有 `book_id` 列，隔离边界是每本书独立数据库路径，而不是共享表中的逻辑列。

### Usage 与可审计性

- 第 1 章：prompt 55,169，completion 12,468，total 67,637 tokens；
- 第 2 章体验偏差：prompt 130,288，completion 32,461，total 162,749 tokens；
- 两章合计 230,386 tokens，计费口径和货币成本未由原版持久化；
- 日志未发现重试信号、401、403、404、429 或网络失败；Studio stderr 出现 1 次结构化输出解析失败信号，但最终管线自行恢复并完成落盘；
- 原版没有持久化 Provider 调用次数、精确重试次数、建书 token 和每阶段耗时，因此这些项目标记为不可审计，不推测数值。

## 测试或检查结果

- Node `24.14.0`、pnpm `9.15.9`；
- `pnpm build` 通过，Core、Studio client/server、CLI 全部成功；
- `pnpm typecheck` 通过；
- `pnpm test` 通过：265 files、2351 tests、0 failed、0 skipped；
- `git diff --check` 通过；
- `pnpm-lock.yaml`、许可证和 InkOS 核心源码无改动；
- `.env`、`.inkos/secrets.json`、小说正文、SQLite、日志和模型原始响应未进入 Git。

## 风险

- 两章 token usage 明显偏高，TASK-002 之前不应继续批量生成；
- 当前 usage 不能换算成可审计货币成本，后续需要独立成本账本任务；
- Provider 调用次数、重试和阶段耗时缺少持久化证据；
- 模型曾出现一次可恢复的结构化输出解析失败，后续 Provider 兼容性测试应覆盖该路径；
- Windows Studio E2E 仍受 POSIX 启动命令限制；
- 用户体验多生成一章，已保留为本地数据并明确排除在验收样本之外。

## 最终状态

`completed`

TASK-001B 的真实模型门槛已解除。TASK-002 仍为 `pending`，必须先完成设计文档和评审，当前不得启动实现。
