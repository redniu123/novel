# TASK 索引

最后更新时间：2026-07-13

| 任务编号 | 名称 | 状态 | 分支 | 依赖 | 交付物 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | InkOS 原版基线验证 | `completed_with_blockers` | `docs/baseline-analysis` | 官方基线 `7ac8d53` | 基线分析、Runbook、MVP 文档、ADR-001 | 真实模型调用和 Windows E2E 未完成 |
| TASK-001A | 项目治理、跨会话规则与环境固定 | `completed` | `docs/baseline-analysis` | TASK-001 | AGENTS、CLAUDE、项目状态、任务索引、环境 pin | 未修改核心代码或锁文件 |
| TASK-001B | 真实模型冒烟验证 | `pending` | `test/TASK-001B-real-model-smoke` | TASK-001A；合法模型凭证 | 冒烟记录、最小生成物检查、基线状态更新 | 凭证只在本地秘密存储中配置 |
| TASK-002 | 最小 `production_mode` 配置 | `pending` | `feature/TASK-002-production-mode` | TASK-001B | TASK 文档、配置设计、实现与测试 | 当前不得提前实现 |

状态值统一使用：`pending`、`in_progress`、`completed`、`completed_with_blockers`、`blocked`、`failed`。
