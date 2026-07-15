# TASK 索引

最后更新时间：2026-07-15

| 任务编号 | 名称 | 状态 | 分支 | 依赖 | 交付物 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | InkOS 原版基线验证 | `completed` | `docs/baseline-analysis` | 官方基线 `7ac8d53` | 基线分析、Runbook、MVP 文档、ADR-001 | 非 E2E 基线与真实模型门槛均已完成；Windows E2E 保留为已知限制 |
| TASK-001A | 项目治理、跨会话规则与环境固定 | `completed` | `docs/baseline-analysis` | TASK-001 | AGENTS、CLAUDE、项目状态、任务索引、环境 pin | 已归档并合并至 develop |
| TASK-001B | 真实模型冒烟验证 | `completed` | `test/TASK-001B-real-model-smoke` | TASK-001A；合法模型凭证 | 冒烟任务单、真实模型结果、用户 Runbook | `openai/custom` 真实链路通过；第 1 章作为验收样本，第 2 章为用户体验范围偏差 |
| TASK-001C | InkOS 功能教程与缺口指南 | `completed` | `docs/TASK-001C-inkos-guide` | TASK-001、TASK-001A、TASK-001B | 教程 Markdown、DOCX、缺口矩阵 | 已按真实模型结果更新并完成 DOCX 渲染验收 |
| TASK-002 | 最小 `production_mode` 配置 | `completed` | `feature/TASK-002-production-mode` | TASK-001B；设计文档批准 | TASK 文档、配置设计、实现与测试 | 2026-07-15 Claude Code 审查通过（无 Blocker/Major），代行人工验收 9 项检查通过；待合并 `develop` |
| TASK-003 | 走量生产策略绑定 | `pending` | 待创建 | TASK-002 | 任务单、策略绑定设计与实现 | 任务单待编写，复用 `BookStrategyStore` 接口 |

状态值统一使用：`pending`、`in_progress`、`completed`、`completed_with_blockers`、`blocked`、`failed`、`implemented_pending_review`。
