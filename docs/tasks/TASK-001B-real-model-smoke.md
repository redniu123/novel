# TASK-001B：真实模型最小冒烟验证

状态：`blocked`
执行日期：2026-07-13
分支：`test/TASK-001B-real-model-smoke`

## 背景

TASK-001 已完成原版构建、测试、CLI、Studio、状态与 SQLite 基线，但真实模型的建书、规划、正文、审查和修订链路因缺少合法凭证而未验证。TASK-002 必须以本任务通过为前置门槛。

## 目标

- 使用合法真实模型完成一次最小端到端调用；
- 最多生成一本测试书的一章正文和一次修订；
- 验证状态落盘、SQLite 写入、token usage 与 `book_id` 隔离；
- 确认无凭证和测试产物进入 Git。

## 修改范围

- 本任务文档与 `docs/runbooks/real-model-smoke.md`；
- `docs/PROJECT-STATUS.md`、`docs/tasks/TASK-INDEX.md`；
- 成功后更新 `docs/02-inkos-baseline.md` 和 TASK-001 状态；
- 被忽略的 `tmp/TASK-001B-real-model-smoke/`。

## 禁止修改范围

InkOS 核心代码、模型路由、系统提示词、审查标准、数据库结构、依赖、锁文件、许可证、正式书籍和任何密钥文件。不得批量生成或手工伪造状态。

## 执行步骤

1. 检查凭证存在性、Provider、模型和 Base URL 格式，不输出密钥；
2. 凭证门槛通过后，在 Node 24.14.0、pnpm 9.15.9 下执行冻结安装、构建、类型检查和全量测试；
3. 初始化隔离测试项目并执行 `doctor`；
4. 用完全虚构简报建书；
5. 规划并生成最多一章；
6. 审查并根据结果最多修订一次；
7. 核对状态、SQLite、usage、隔离和 Git 安全；
8. 更新任务状态并提交非敏感文档。

## 通过标准

真实模型、故事架构、章节规划、一章正文、审查决策链、状态文件、SQLite 写入和 `book_id` 隔离全部通过；全量测试通过；核心代码无修改；所有运行产物被忽略或清理。

## 实际结果

凭证门槛检查结果：

- 进程环境：Provider、service、Base URL、model、API key 均未设置；
- 用户全局 `~/.inkos/.env`：文件不存在；
- 仓库 `.env`：文件存在，但所需 LLM 字段均未设置；
- 仓库 `.inkos/secrets.json`：文件不存在，可用 Studio service key 数量为 0；
- 未创建测试项目，未运行 `doctor`，未调用 Provider；
- 模型调用次数 0，token usage 0，没有生成正文、状态或 SQLite 数据。

阻塞分类：凭证问题。未尝试伪造 key、stub、临时 Provider 或核心代码修改。

## 恢复条件

用户通过以下任一路径在本地配置合法凭证后恢复本任务：

1. 测试项目 Studio 服务页，密钥保存于被忽略的 `.inkos/secrets.json`；
2. 用户全局 `~/.inkos/.env`；
3. 测试项目 `.env`；
4. 进程环境变量。

CLI 环境变量名称：`INKOS_LLM_PROVIDER`、`INKOS_LLM_SERVICE`、`INKOS_LLM_BASE_URL`、`INKOS_LLM_MODEL`、`INKOS_LLM_API_KEY`。不得把真实值写入 Git、文档或聊天。

## 测试结果

- Node 24.14.0 与 pnpm 9.15.9 工具链检查通过；
- 凭证存在性和格式检查完成，未输出任何值；
- 因凭证门槛失败，未执行本任务的安装、构建、全量测试和真实模型链路；
- 最近完整基线仍为 TASK-001 的 2351 项通过结果。

## 风险

- 凭证缺失阻塞全部真实模型链路，并阻止 TASK-002；
- 配置凭证后仍可能出现 Provider/模型协议不兼容；
- 网络抖动可能触发瞬态重试或调用失败；
- 恢复后仍需严格控制调用次数和正文规模。

## 最终状态

`blocked`
