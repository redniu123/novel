# TASK-001：InkOS 原版基线验证

状态：`completed_with_blockers`
执行日期：2026-07-12
分支：`docs/baseline-analysis`

## 背景

本项目计划基于 InkOS 构建面向网络小说创作与运营的数据驱动型长篇内容生产系统。在开发新能力前，需要冻结第一阶段 MVP，建立可靠的 Git 分支体系，并证明原版代码的安装、构建、测试和主要运行入口可复现。

## 目标

- 阅读现有方案与官方仓库资料；
- 冻结单本走量小说第一阶段 MVP；
- 确认官方仓库、版本、提交和分支基线；
- 验证安装、构建、类型检查、测试、CLI、Studio 和隔离项目初始化；
- 定位章节管线、状态、SQLite 和模型调用；
- 形成基线分析、Runbook 和 ADR。

## 修改范围

- `.gitignore` 的安全忽略项和本次文档例外；
- 五份要求的 Markdown 交付文档；
- Git 远程和分支的非破坏性配置；
- 被忽略的 `tmp/baseline-test-book/` 测试数据。

## 禁止修改范围

InkOS 核心 Agent、pipeline、数据库结构、模型路由、Studio 业务界面、CLI 行为、依赖版本、锁文件、原有测试、许可证、上游历史和用户现有 DOCX。

## 执行步骤

1. 检查目录、Git 状态、远程、分支、提交和 Tag。
2. 阅读五份前期 DOCX、README、CHANGELOG、package 配置和源码。
3. 建立 `main`、`develop`、`docs/baseline-analysis`。
4. 在 Node 24.14.0、pnpm 9.15.9 下冻结安装依赖。
5. 执行构建、类型检查、lint 探测、单元/集成测试和 E2E 尝试。
6. 验证 CLI 帮助、版本和主要子命令。
7. 启动 Studio，以 HTTP 状态确认后正常停止。
8. 在 `tmp/baseline-test-book/` 执行项目初始化、doctor、AI 建书尝试和 SQLite 读写。
9. 静态核对规划、写作、审查、修订、状态和模型调用链。
10. 整理文档并执行最终 Git 差异检查。

## 验收标准

- 原版依赖安装、构建、类型检查和测试结果有真实记录；
- CLI、Studio 和项目初始化完成运行验证；
- 真实模型调用未具备条件时，明确阻塞而不伪造；
- 状态、SQLite、模型配置和 API 调用有具体代码定位；
- 所有要求文档已创建；
- 只修改允许范围。

## 实际执行结果

- 仓库基线：InkOS 1.7.0，`7ac8d530557154653cdac83c07dd7488c1460191`；
- Git：已建立 `main`、`develop`、`docs/baseline-analysis`，官方 `upstream` 已配置，`origin` 未设置；
- 安装：`pnpm install --frozen-lockfile` 通过，1011 packages，锁文件未变；
- 构建和类型检查：通过；
- 测试：265 files、2351 tests 全部通过，0 failed、0 skipped；
- Lint：仓库未配置有效 lint script；
- E2E：Windows 启动命令不兼容，测试未开始；
- CLI：版本、根帮助和主要命令帮助通过；
- Studio：4577 端口启动成功，HTTP `/` 返回 200，随后按要求停止；
- 项目初始化：`tmp/baseline-test-book/` 成功；
- 真实 AI 流程：因无合法凭证阻塞；官方 stub 建书报 foundation 协议不完整；
- SQLite：`facts`、`chapter_summaries`、`hooks` 三表完成实际建表和写入；
- 核心业务代码、锁文件和原有测试均未修改。

## 阻塞问题

- 模型调用凭证未配置；
- 官方 stub 不满足当前建书协议；
- Windows Playwright webServer 命令使用 POSIX 语法；
- 用户默认 Node 18 和 pnpm 11 与验证环境不一致；
- 用户 Fork 地址未知，`origin` 无法配置。

## 最终状态

`completed_with_blockers`

理由：所有无需真实模型凭证的验收项均已完成，且原版构建、测试和主要入口通过；真实模型最小端到端验证及 Windows E2E 仍有明确外部或上游阻塞。
