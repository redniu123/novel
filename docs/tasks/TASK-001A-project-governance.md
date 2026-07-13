# TASK-001A：项目治理、跨会话规则与开发环境固定

状态：`completed`
执行日期：2026-07-13
分支：`docs/baseline-analysis`

## 背景

TASK-001 已建立 InkOS 1.7.0 的可信基线，但仓库仍缺少跨会话工程规则、项目状态入口、统一任务索引和与实际验证一致的精确开发环境声明；用户 Fork 也尚未配置为 `origin`。

## 目标

- 建立 Codex/通用 Agent 与 Claude Code 的简洁仓库规则；
- 建立跨会话项目状态和任务索引；
- 固定 Node 24.14.0 与 pnpm 9.15.9；
- 将用户 Fork 配置为 `origin`，保留官方 `upstream`；
- 为 TASK-001B 提供清晰入口。

## 修改范围

- `AGENTS.md`、`CLAUDE.md`；
- `docs/PROJECT-STATUS.md`；
- `docs/tasks/TASK-INDEX.md`；
- `docs/tasks/TASK-001A-project-governance.md`；
- `.nvmrc`、`.node-version`、`package.json` 的环境声明；
- `.gitignore` 的精确放行规则；
- 本地 Git `origin` 配置。

## 禁止修改范围

InkOS 核心业务代码、依赖版本、锁文件、数据库结构、原有测试、许可证、生成小说、密钥和用户 DOCX。不得推送、改写历史、删除分支或执行破坏性 Git 操作。

## 执行步骤

1. 只读检查 Git、基线文档、现有治理文件、环境声明和 DOCX；
2. 输出阶段一结果、文件计划和风险；
3. 配置已明确提供的用户 Fork 为 `origin`；
4. 创建跨会话规则、项目状态、任务索引和本任务任务单；
5. 精确固定 Node/pnpm 版本并保留兼容的 engines；
6. 验证引用路径、JSON、忽略规则、远程和最终 Git 差异。

## 验收标准

- 五个治理文件存在且引用路径真实；
- AGENTS/CLAUDE 简洁并包含要求的工程和审查规则；
- TASK-001、001A、001B、002 状态一致；
- `.nvmrc`、`.node-version` 为 24.14.0，`packageManager` 为 `pnpm@9.15.9`；
- `engines` 保持兼容，锁文件、许可证和核心代码无差异；
- `origin` 指向用户 Fork，`upstream` 不变；
- DOCX 未移动、删除、修改或提交。

## 实际结果

- 创建 `AGENTS.md`、`CLAUDE.md`、项目状态、TASK 索引和本任务单；
- 添加精确 `.gitignore` 例外，使治理文件可被 Git 跟踪，同时继续忽略 DOCX 和运行数据；
- 将 Node 从宽泛的本地 `22` pin 更新为已验证的 `24.14.0`；
- 在 `package.json` 新增 `packageManager: pnpm@9.15.9`，保留原有 engines、依赖和 scripts；
- 配置 `origin=https://github.com/redniu123/novel.git`，保留官方 `upstream`；
- 四份现有 DOCX 保持原位置和内容不变。

## 测试或检查结果

- `package.json` JSON 解析与版本字段检查通过；
- 治理文档引用路径检查通过；
- `.gitignore` 跟踪/忽略检查通过；
- `git diff --check` 通过；
- 核心代码、`pnpm-lock.yaml`、`LICENSE` 和数据库结构无差异；
- 本任务只变更文档、环境声明、`.gitignore` 与本地 remote 配置，因此引用 TASK-001 的 2351 项完整测试结果，不重复运行全量测试。

## 风险

- 开发者仍可能在未启用版本管理器/Corepack 时使用系统 Node 18 或 pnpm 11；
- TASK-001B 仍依赖合法模型凭证；
- TASK-001 和 TASK-001A 当前同处一个未提交工作区，提交时需完整审查边界；
- DOCX 是参考材料而非开发事实来源，后续若提交会增加二进制审查成本。

## 最终状态

`completed`
