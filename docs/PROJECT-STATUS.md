# 项目状态

最后更新时间：2026-07-13

## 基本信息

| 项目 | 当前值 |
| --- | --- |
| 项目名称 | 基于 InkOS 的小说智能体 |
| 当前阶段 | TASK-001 与 TASK-001A 已归档，下一步为真实模型冒烟验证 |
| InkOS 版本 | 1.7.0 |
| 基线 Commit | `7ac8d530557154653cdac83c07dd7488c1460191` |
| 远程默认稳定分支 | `origin/master` |
| 本地兼容稳定分支 | `main`，跟踪 `upstream/master`，本轮保留 |
| 集成分支 | `develop` |
| origin | `https://github.com/redniu123/novel.git` |
| upstream | `https://github.com/Narcooo/inkos.git` |

## 任务状态

- 已完成：TASK-001 `completed_with_blockers`；TASK-001A `completed`。
- 进行中：无。
- 待处理：TASK-001B `pending`；TASK-002 `pending`。
- 阻塞依赖：TASK-001B 需要用户在本地安全配置合法模型凭证。
- 下一任务：TASK-001B 真实模型冒烟验证。

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

2026-07-12 在 Node 24.14.0、pnpm 9.15.9 上完成：

- `pnpm install --frozen-lockfile` 通过，1011 packages；
- `pnpm build` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过：265 files、2351 tests、0 failed、0 skipped；
- CLI、Studio 和 SQLite 运行验证通过；
- Studio E2E 因 Windows 下 POSIX 启动命令不兼容而未执行测试；
- 真实模型流程因没有合法凭证而未完成。

详见 [InkOS 基线分析](02-inkos-baseline.md)。

## 已确认架构决策

- [ADR-001](decisions/ADR-001-volume-first-mvp.md)：第一阶段采用单本走量小说 MVP；
- 优先扩展和组合，不直接重写 InkOS 核心；
- 故事权威状态与商业运营数据分离；
- 保留人工最终审核和人工发布。

## 当前风险

- 尚无真实模型端到端结果，模型兼容性、质量和实际 token 成本未验证；
- 官方 LLM stub 与当前 Phase 5 建书协议不兼容；
- Windows Studio E2E 启动命令不兼容；
- 系统默认 Node/pnpm 可能绕过仓库版本声明；
- 全局 Git 代理当前不可用，GitHub 命令需临时绕过代理；
- AGPL-3.0-only 对未来网络服务和分发方案有合规约束。
