# TASK 索引

最后更新时间：2026-07-23

| 任务编号 | 名称 | 状态 | 分支 | 依赖 | 交付物 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | InkOS 原版基线验证 | `completed` | `docs/baseline-analysis` | 官方基线 `7ac8d53` | 基线分析、Runbook、MVP 文档、ADR-001 | 非 E2E 基线与真实模型门槛均已完成；Windows E2E 保留为已知限制 |
| TASK-001A | 项目治理、跨会话规则与环境固定 | `completed` | `docs/baseline-analysis` | TASK-001 | AGENTS、CLAUDE、项目状态、任务索引、环境 pin | 已归档并合并至 develop |
| TASK-001B | 真实模型冒烟验证 | `completed` | `test/TASK-001B-real-model-smoke` | TASK-001A；合法模型凭证 | 冒烟任务单、真实模型结果、用户 Runbook | `openai/custom` 真实链路通过；第 1 章作为验收样本，第 2 章为用户体验范围偏差 |
| TASK-001C | InkOS 功能教程与缺口指南 | `completed` | `docs/TASK-001C-inkos-guide` | TASK-001、TASK-001A、TASK-001B | 教程 Markdown、DOCX、缺口矩阵 | 已按真实模型结果更新并完成 DOCX 渲染验收 |
| TASK-002 | 最小 `production_mode` 配置 | `completed` | `feature/TASK-002-production-mode` | TASK-001B；设计文档批准 | TASK 文档、配置设计、实现与测试 | 2026-07-15 Claude Code 审查通过（无 Blocker/Major），代行人工验收 9 项检查通过；已合并 `develop` |
| TASK-003 | 走量小说生产策略总任务 | `in_progress` | `feature/TASK-003B-volume-orchestrator` | TASK-002 | 总体设计、任务拆分、总体验收 | TASK-003A/003B 代码完成并合并 develop；总验收待真实模型人工验收 |
| TASK-003A | 走量策略与商业状态 Schema | `completed` | `feature/TASK-003A-volume-policy-state` | TASK-003 设计复审通过 | Policy、State v1、Store、映射和发布资格 | 2026-07-17 Claude Code 复审 `approved_with_changes`；Major-1 已修复；合并 develop |
| TASK-003B | 走量单章薄编排器 | `completed` | `feature/TASK-003B-volume-orchestrator` | TASK-003A | Orchestrator、商业审核 API、超时和测试 | 2026-07-17 实现并自审通过（28 项新测试）；真实模型人工验收待用户执行 |
| TASK-004 | 模型成本账本 | `completed` | `feature/TASK-004-cost-ledger`、`feature/TASK-004B-ledger-recorder` | TASK-003A/003B | JSONL 账本、价格表、聚合、Recorder、settled event | 2026-07-17 设计红队与代码复审闭环；core 1792 / studio 484 / CLI 209 全过；已完成报告 |
| BIZ-001 | 番茄短故事商业化生产计划 | `completed` | `docs/BIZ-001-fanqie-short-story-business-plan` | TASK-004；不阻塞 TASK-003 人工验收 | 商业方案库、两篇投稿试验协议、单位经济与止损标准 | 2026-07-23 纯文档完成；不提交生成小说、不自动投稿 |

状态值统一使用：`pending`、`pending_design_review`、`in_progress`、`completed`、`completed_with_blockers`、`blocked`、`failed`、`implemented_pending_review`。
