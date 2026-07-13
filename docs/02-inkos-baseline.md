# InkOS 1.7.0 原版基线分析

验证日期：2026-07-12
任务状态：`completed`（TASK-001B 于 2026-07-13 解除真实模型阻塞）
验证分支：`docs/baseline-analysis`

## 1. 基线摘要

本地代码与官方仓库 `https://github.com/Narcooo/inkos.git` 的提交 `7ac8d530557154653cdac83c07dd7488c1460191` 一致，版本为 `1.7.0`。在隔离的 Node 24.14.0、pnpm 9.15.9 环境中，依赖安装、构建、类型检查以及 2351 项原有测试均通过；CLI 与 Studio 均完成运行验证，SQLite 记忆完成实际读写验证。

基线通过。TASK-001B 已使用 `openai/custom` 的第三方 HTTPS OpenAI-compatible 服务完成真实 `doctor`、AI 建书、章节规划、正文、自动审查、状态投影和 SQLite 写入。官方 LLM stub 仍无法满足当前 Phase 5 建书协议，Windows 下 Playwright 的 POSIX 环境变量命令仍不能直接启动 E2E 服务；二者保留为非阻塞已知限制。

本次未修改 InkOS 核心代码、依赖版本、锁文件、测试或生产配置。

## 2. 已阅读的项目文档

| 文档 | 用途 |
| --- | --- |
| `README.md`、`README.en.md`、`README.ja.md` | 官方能力、安装、配置、CLI 和 Studio 使用说明 |
| `CHANGELOG.md`、`CHANGELOG.en.md` | 版本演进与 1.7.0 变更 |
| `CONTRIBUTING.md` | 上游贡献约定 |
| `LICENSE` | AGPL-3.0-only 许可证 |
| `基于InkOS的小说智能体二次开发技术方案第一版.docx` | 二次开发架构和 MVP 假设 |
| `面向网络小说创作与运营的数据驱动型长篇内容生产系统初步想法第一版.docx` | 产品方向与走量优先策略 |
| `小说智能体想法.docx` | 早期业务构想 |
| `智能体开发流程初步想法第一版.docx` | Git、任务和文档工作流建议 |
| `智能体开发流程初步想法第一版 - 副本.docx` | 与上一文件字节一致的副本，保留未修改 |

仓库基线没有 `AGENTS.md` 或可提交的 `CLAUDE.md`；根 `.gitignore` 明确忽略本地 `CLAUDE.md`。前期方案仅用来理解目标，架构结论均以当前代码和测试为准。

## 3. 仓库与版本信息

| 项目 | 结果 |
| --- | --- |
| 官方上游 | `https://github.com/Narcooo/inkos.git` |
| `upstream` | 已配置为官方仓库 |
| `origin` | 未配置；用户 Fork 地址未知，未猜测 |
| 本地仓库 | `E:\Users\zhubinhua\Desktop\小说智能体` |
| 当前分支 | `docs/baseline-analysis` |
| 长期分支 | `main`、`develop`，均基于相同官方提交 |
| InkOS 版本 | `1.7.0` |
| 完整提交 | `7ac8d530557154653cdac83c07dd7488c1460191` |
| 短提交 | `7ac8d53` |
| 提交说明 | `docs: replace keaiapi references with kkaiapi` |
| 上游跟踪 | `main` 跟踪 `upstream/master` |
| 原始 Tag | 未获取到本地 Tag |
| 基线 Tag | 未创建；工作区有五份用户 DOCX 未跟踪，且上游 Tag 未完整获取 |

源码通过官方 Commit archive 获取，并与官方 Git 索引核对。GitHub 传输多次超时，GitHub CLI 也不可用，因此未自动 Fork。用户创建 Fork 后应执行：

```powershell
git remote add origin https://github.com/<USER>/inkos.git
git remote -v
```

## 4. 环境信息

| 项目 | 实际值 | 项目要求 | 结论 |
| --- | --- | --- | --- |
| 操作系统 | Windows NT 10.0.26200.0 AMD64 | Windows 可用 | 通过 |
| 系统 Node | 18.16.1 | `>=20.0.0` | 不满足 |
| 验证 Node | 24.14.0 | `>=20.0.0`，CI 覆盖 20/22/24 | 通过 |
| npm | 9.5.1 | 未锁定 | 可用 |
| 系统 pnpm | 11.7.0 | `>=9.0.0`，CI 使用 9 | 不建议用于本锁文件 |
| 验证 pnpm | 9.15.9 | pnpm 9 基线 | 通过 |
| Git | 2.51.0.windows.1 | Git | 通过 |

Node 24 运行 SQLite 时会出现“内置 SQLite 仍为实验性功能”的警告，不影响本次测试通过。未全局修改用户的 Node 或 pnpm。

## 5. 安装、构建与测试

| 验证项 | 命令 | 结果 | 备注 |
| --- | --- | --- | --- |
| 依赖安装 | `pnpm install --frozen-lockfile` | 通过 | 1011 packages；锁文件未改变 |
| 构建 | `pnpm build` | 通过 | core、Studio client/server、CLI 均成功 |
| 类型检查 | `pnpm typecheck` | 通过 | 全 workspace 通过 |
| Lint | `pnpm lint` | 未配置 | 命令退出 0，但 workspace 没有 lint script，不能记为实际 lint 通过 |
| 单元/集成测试 | `pnpm test` | 通过 | 265 files，2351 passed，0 failed，0 skipped |
| Studio E2E | `pnpm --filter @actalk/inkos-studio test:e2e` | 启动失败 | Playwright 配置使用 POSIX inline env，在 Windows PowerShell/cmd 无法执行 |

测试明细：core 172 files / 1658 tests；Studio 55 files / 484 tests；CLI 38 files / 209 tests。构建仅有 Studio chunk 大于 500 kB 的体积警告。

2026-07-13 在相同固定工具链上复跑 `pnpm build`、`pnpm typecheck` 和 `pnpm test`，结果仍为全部通过，锁文件未改变。

## 6. CLI 验证

CLI 源入口是 `packages/cli/src/index.ts`，调用 `runProgram()`；构建入口为 `packages/cli/dist/index.js`，npm bin 名为 `inkos`。`--version` 返回 `1.7.0`。

已实际验证以下帮助或无副作用命令：

```powershell
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js --version
node packages/cli/dist/index.js book create --help
node packages/cli/dist/index.js plan --help
node packages/cli/dist/index.js write --help
node packages/cli/dist/index.js audit --help
node packages/cli/dist/index.js revise --help
node packages/cli/dist/index.js export --help
node packages/cli/dist/index.js studio --help
```

关键命令为 `inkos init`、`inkos book create`、`inkos plan chapter`、`inkos compose chapter`、`inkos draft`、`inkos write next`、`inkos audit`、`inkos revise`、`inkos review` 和 `inkos export`。

## 7. Studio 验证与当前 Failed to fetch 提示

Studio 服务端入口为 `packages/studio/src/api/index.ts`，项目根目录取 `argv[2]`、`INKOS_PROJECT_ROOT` 或当前工作目录，默认端口为 4567；CLI 可用 `inkos studio -p <port>` 启动。

实际验证在 4577 端口成功启动，HTTP `/` 返回 200 和 553 字节页面，说明前后端构建和服务入口有效。验证结束后按任务要求正常停止进程并释放端口。

浏览器随后显示“Failed to fetch”是已停止的 Studio 页面继续请求后端导致的连接错误。`tmp/baseline-test-book/inkos.json` 已解析为合法 JSON；源码仓库根目录没有长期 `inkos.json` 是刻意设计，因为根 `.gitignore` 将它视为用户运行时配置。不要为了消除提示把测试配置提交到源码根目录。需要重新使用 Studio 时，应在一个已执行 `inkos init` 的项目目录中启动服务并保持终端进程运行。

## 8. 测试小说创建结果

隔离目录：`tmp/baseline-test-book/`，已被根 `.gitignore` 排除。

`inkos init` 成功生成 `.env`、`.gitignore`、`.node-version`、`.nvmrc`、合法的 `inkos.json`、`books/` 和 `radar/`。

`inkos doctor` 确认 Node 24 和 SQLite 可用，同时明确报告模型 API Key 缺失。真实 `book create` 按预期失败，没有遗留半成品书籍或 staging 目录。

官方 `INKOS_AGENT_LLM_STUB=1` 也做了尝试，但 `ArchitectAgent` 抛出 `ArchitectIncompleteFoundationError`。当前 stub 输出不能满足 Phase 5 foundation 协议，因此不能用它伪造建书成功。

TASK-001B 在 `tmp/TASK-001B-real-model-smoke/` 恢复验证。项目级 `.env` 由 Studio 官方导入接口导入，真实 API 探针通过；用户通过 Studio 完成 AI 建书和章节生成。验收只取第 1 章，用户随后生成的第 2 章作为体验偏差保留在本地忽略目录，不进入 Git。

## 9. 规划、写作、审查与修订

| 流程 | 结果 |
| --- | --- |
| 项目初始化 | 通过 |
| AI 建书与故事架构 | 真实模型通过 |
| 章节规划 | 第 1 章真实计划、上下文和规则栈通过 |
| 章节正文 | 第 1 章真实生成通过，最终 3,617 字 |
| 连续性审查 | 自动审查完成，保留 2 条问题并进入 `ready-for-review` |
| 修订 | 自动修订门槛未触发，修订次数 0；没有替用户执行人工批准 |
| 状态结算与长期记忆 | 结构化状态、Markdown 投影、快照和 SQLite 真实写入通过 |

自动修订并非无限循环：`PipelineRunner` 根据 `chapterReviewMode` 和 revision policy 进入审查/修订路径；manual 模式会在草稿后停下，保留人工驱动的审查、修订和接受流程。后续 MVP 仍需把“最大自动修订次数”形成明确产品配置和验收测试。

## 10. 小说状态与 SQLite 记忆

故事权威结构由 `packages/core/src/state/runtime-state-store.ts` 和 `packages/core/src/models/runtime-state.ts` 定义。结构化状态位于：

```text
books/<book-id>/story/state/manifest.json
books/<book-id>/story/state/current_state.json
books/<book-id>/story/state/hooks.json
books/<book-id>/story/state/chapter_summaries.json
```

Markdown 投影包括 `story/current_state.md`、`story/pending_hooks.md`、`story/chapter_summaries.md`，并配合 `particle_ledger.md`、`subplot_board.md`、`emotional_arcs.md`、`character_matrix.md` 等连续性资料。章节快照写入 `story/snapshots/<chapter>/`。

角色和世界观基线位于 `story/roles/`、`story/outline/` 及书籍基础设定文件。人物位置、关系、资源、时间、事件等事实进入 `current_state` facts；伏笔进入 hooks；章节事件和状态变化进入 chapter summaries。

状态管理由 `packages/core/src/state/manager.ts` 负责文件、快照、章节索引和写锁；`runtime-state-store.ts` 加载、归约和保存结构化状态；`packages/core/src/state/state-validator.ts` 执行结构校验。

SQLite 实现在 `packages/core/src/state/memory-db.ts` 的 `MemoryDB`，数据库路径为 `books/<book-id>/story/memory.db`，表为 `facts`、`chapter_summaries`、`hooks`。本次在 `tmp/baseline-test-book/memory-runtime/story/memory.db` 实际建库，并分别向三张表写入一条测试数据，确认运行时读写成功。

## 11. 模型配置与 API 调用位置

| 关注点 | 代码位置 |
| --- | --- |
| 项目配置加载 | `packages/core/src/utils/config-loader.ts` |
| 最终模型配置合成 | `packages/core/src/utils/effective-llm-config.ts` 的 `resolveEffectiveLLMConfig` |
| Studio 密钥 | `packages/core/src/llm/secrets.ts`，项目 `.inkos/secrets.json` |
| Provider 和客户端 | `packages/core/src/llm/provider.ts` 的 `createLLMClient` |
| 统一文本调用 | `packages/core/src/llm/provider.ts` 的 `chatCompletion` |
| OpenAI-compatible transport | `chatCompletionViaCustomOpenAICompatible` |
| 各 Agent 路由 | `PipelineRunner.agentCtxFor(...)` 结合 effective config |

配置支持 provider、service、base URL、model、Chat Completions/Responses 格式和流式开关。CLI 可以通过环境变量和参数覆盖，Studio 使用项目 service 配置与 `.inkos/secrets.json`，不会把密钥写进 `inkos.json`。

Provider 对瞬态错误最多进行两次额外重试，退避约 800/1600 ms；支持 `AbortSignal` 中断。诊断探针有显式超时，普通内容调用没有统一默认硬超时。Chat Completions 和 Responses API 均支持流式输出，错误会被标准化后上抛。

章节 metadata/analytics 已记录 prompt、completion、total tokens，可作为后续成本账本的输入；原版没有持久化、可审计的货币成本台账，不能把 token 统计等同于完整成本统计。

## 12. 一章小说的完整调用链

主入口是 `packages/core/src/pipeline/runner.ts`：

```text
CLI/Studio action
  -> PipelineRunner.writeNextChapter (1665)
  -> 准备 chapter intent / context package / rule stack
  -> WriterAgent.writeChapter (agents/writer.ts:152)
  -> ContinuityAuditor (agents/continuity.ts:375)
  -> 按 revision policy 调用 ReviserAgent (agents/reviser.ts:111)
  -> post-write validation / normalize
  -> 写入章节正文与 metadata
  -> 应用 RuntimeStateDelta 并校验
  -> 更新 Markdown 投影、结构化状态和章节快照
  -> 更新 SQLite facts / chapter_summaries / hooks
```

原子入口还包括 `planChapter`(1202)、`composeChapter`(1226)、`auditDraft`(1254)、`reviseDraft`(1314) 和 `writeDraft`(1068)。建书入口是 `initBook`(706)，调用 `ArchitectAgent` 生成基础设定。

## 13. 可直接复用的能力

- 长篇建书、章节计划、写作、审查、修订和状态结算管线；
- Studio、CLI、TUI 共用的操作入口；
- 多 Provider、OpenAI-compatible、模型路由、流式输出和中断；
- 人工审查模式、自动审查/修订策略和写锁；
- 结构化故事状态、Markdown 投影、快照和 SQLite 长期记忆；
- token usage 与基础 analytics；
- 导出 TXT、Markdown、EPUB；
- 大量现有单元和集成测试。

## 14. 后续需要新增或明确的能力

- 面向走量小说的 `production_mode` 最小配置和 20-30 章验收流程；
- 独立、可审计的模型价格与货币成本账本；
- 商业总编、市场选题、读者模拟和真实反馈数据层；
- 故事权威状态与运营数据的明确边界；
- Windows 兼容的 Studio E2E 启动方式；
- 官方 stub 与当前建书协议的一致性修复或独立测试策略。

这些能力不在 TASK-001 中实现。

## 15. 第一阶段不建议修改的模块

- `packages/core/src/agents/architect.ts`、`planner.ts`、`writer.ts`、`continuity.ts`、`reviser.ts`；
- `packages/core/src/pipeline/runner.ts` 的核心章节事务；
- `packages/core/src/state/` 的数据库结构和权威状态模型；
- `packages/core/src/llm/provider.ts` 的模型传输与路由；
- Studio 业务界面和 CLI 业务行为。

优先通过配置、组合、外围服务和小型适配层扩展；只有独立任务和回归测试证明必要时才改核心。

## 16. 当前已知限制

1. 官方 LLM stub 与 Phase 5 foundation 协议不兼容：建书报 `ArchitectIncompleteFoundationError`。
2. Windows Playwright 命令不兼容：`playwright.config.ts` 使用 POSIX shell 语法。
3. 系统 Node 18.16.1 低于要求，系统 pnpm 11.7.0 与验证基线不一致。
4. 原版没有统一持久化 Provider 调用次数、精确重试、阶段耗时和货币成本。
5. Studio 服务停止后旧浏览器页会显示 `Failed to fetch`；这是连接状态，不是 JSON 校验结论。

## 17. 基线结论

基线结论：**通过**。原版源码的安装、构建、类型、测试、CLI、Studio、真实模型主链和 SQLite 基础能力可信。后续可以进入小范围、设计先行的二次开发；许可证为 AGPL-3.0-only，未来网络服务化和分发方案必须进行合规评估。

## 18. 如何重复验证

完整步骤见 [基线验证 Runbook](runbooks/baseline-validation.md) 和 [真实模型 Runbook](runbooks/real-model-smoke.md)。核心顺序是：切换 Node 24 与 pnpm 9，冻结安装，构建，类型检查，测试，在隔离项目执行 `inkos init`，再从项目目录启动 Studio。真实凭证只能保存在被忽略的本地秘密配置中。
