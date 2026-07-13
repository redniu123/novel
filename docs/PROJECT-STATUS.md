# 项目状态

最后更新时间：2026-07-13

## 基本信息

| 项目 | 当前值 |
| --- | --- |
| 项目名称 | 基于 InkOS 的小说智能体 |
| 当前阶段 | 原版基线和真实模型冒烟已完成；下一步更新使用教程并编写 TASK-002 设计文档 |
| InkOS 版本 | 1.7.0 |
| 基线 Commit | `7ac8d530557154653cdac83c07dd7488c1460191` |
| 远程默认稳定分支 | `origin/master` |
| 本地兼容稳定分支 | `main`，跟踪 `upstream/master`，本轮保留 |
| 集成分支 | `develop` |
| 当前工作分支 | `test/TASK-001B-real-model-smoke` |
| origin | `https://github.com/redniu123/novel.git` |
| upstream | `https://github.com/Narcooo/inkos.git` |

## 任务状态

- 已完成：TASK-001 `completed`；TASK-001A `completed`；TASK-001B `completed`。
- 待处理：TASK-001C 教程更新；TASK-002 `pending`。
- 下一步：按真实模型结果修正使用教程，随后只编写和评审 TASK-002 设计文档；设计获批前不实现 TASK-002。

任务明细见 [TASK 索引](tasks/TASK-INDEX.md)。

## 当前 MVP 目标

完成一本走量网络小说前 20-30 章的可控生产：复用 InkOS 的规划、写作、审查、修订、状态和记忆能力，保留人工最终审核和发布，并为后续商业运营层保留独立扩展空间。

## 当前非目标

- 多本并行生产和多账号运营；
- 自动登录或自动发布到内容平台；
- 大规模正文抓取和根据评论实时改写已发布内容；
- 完全无人审核；
- 重写 InkOS 核心或建设闭源商业 SaaS。

完整范围见 [产品方向](00-product-brief.md)。

## 最近一次测试结果

2026-07-13 在 Node 24.14.0、pnpm 9.15.9 上完成：

- `pnpm install --frozen-lockfile` 通过，1011 packages；
- `pnpm build` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过：265 files、2351 tests、0 failed、0 skipped；
- CLI、Studio 和 SQLite 运行验证通过；
- Studio E2E 因 Windows 下 POSIX 启动命令不兼容而未执行测试；
- 真实 `doctor`、AI 建书、章节规划、正文、自动审查、状态投影和 SQLite 写入通过；
- TASK-001B 验收以用户生成的第 1 章为准，停在 `ready-for-review`，没有替用户执行人工批准。

详见 [InkOS 基线分析](02-inkos-baseline.md)。

## 已确认架构决策

- [ADR-001](decisions/ADR-001-volume-first-mvp.md)：第一阶段采用单本走量小说 MVP；
- 优先扩展和组合，不直接重写 InkOS 核心；
- 故事权威状态与商业运营数据分离；
- 保留人工最终审核和人工发布。

## 当前风险

- 第 1 章记录 67,637 tokens；体验期间额外生成的第 2 章记录 162,749 tokens，实际成本和计费口径仍需独立核对；
- InkOS 目前没有持久化 Provider 调用次数、重试次数和货币成本的统一审计账本；
- 用户体验时多生成了第 2 章，超出 TASK-001B 的单章建议范围，但未进入 Git；
- Studio 日志出现 1 次结构化输出解析失败信号，最终管线自行恢复并完成落盘；
- 官方 LLM stub 与当前 Phase 5 建书协议不兼容；
- Windows Studio E2E 启动命令不兼容；
- 系统默认 Node/pnpm 可能绕过仓库版本声明；
- 全局 Git 代理当前不可用，GitHub 命令需临时绕过代理；
- AGPL-3.0-only 对未来网络服务和分发方案有合规约束。
