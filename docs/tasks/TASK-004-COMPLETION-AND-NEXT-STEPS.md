# TASK-004 完成报告与后续任务建议

最后更新：2026-07-17

## 1. 结论

TASK-004 已完成，最终状态为 `completed`。交付覆盖：

- TASK-004A：按书 JSONL 成本账本、价格表、精确成本计算、读取端聚合、损坏检测、
  受控撕裂修复、runId 幂等和失败健康标记。
- TASK-004B：CostLedgerRecorder、编排器 `events.onProductionSettled`、深冻结事件
  快照、终态解锁后触发、fail-open 和根导出。

本报告是跨设备/新对话的 TASK-004 交接入口。事实细节仍以
[`TASK-004-cost-ledger.md`](TASK-004-cost-ledger.md)、
[`cost-ledger.md`](../modules/cost-ledger.md) 和真实代码为准。

## 2. 已交付文件

核心实现：

- `packages/core/src/commercial/cost-ledger.ts`
- `packages/core/src/commercial/model-price-table.ts`
- `packages/core/src/commercial/cost-ledger-recorder.ts`
- `packages/core/src/commercial/volume-production-orchestrator.ts`
- `packages/core/src/index.ts`
- `config/model-prices.example.json`

测试：

- `packages/core/src/__tests__/cost-ledger.test.ts`
- `packages/core/src/__tests__/model-price-table.test.ts`
- `packages/core/src/__tests__/cost-ledger-recorder.test.ts`
- `packages/core/src/__tests__/volume-production-orchestrator.test.ts`

治理文档：

- `docs/tasks/TASK-004-cost-ledger.md`
- `docs/modules/cost-ledger.md`
- `docs/tasks/TASK-INDEX.md`
- `docs/PROJECT-STATUS.md`
- `AGENTS.md`
- `CLAUDE.md`

## 3. 冻结设计与关键语义

P1-P8 全部已冻结，不得在后续任务中静默回退：

1. JSONL 追加式账本。
2. 按书 `commercial/` 隔离，项目级只做内存聚合。
3. 每次商业运行一条；Provider 内部重试 v1 不可观测。
4. 项目价格表 `config/model-prices.json`，无内置默认价。
5. 写入时保存版本、单价和金额快照。
6. 编排器可选 settled event，账本与回调 fail-open。
7. 存在 modelOverrides 时按主模型估算并标记 `approximate: true`。
8. 真实价格表被 ignore，只提交 example 模板。

额外实现约束：

- `VolumeProductionResult` 零新增字段。
- 事件是独立深冻结快照，不是活结果引用。
- 事件在商业终态落盘并释放书锁之后、返回之前 await 触发。
- Recorder 只保存主模型和 override 模型名，不保存 baseUrl、apiKeyEnv、header 或
  任何凭证派生值。
- 写失败必须告警并尽力更新 `cost-ledger-failures.json`；读取端通过
  `ledgerHealth` 暴露漏账。

## 4. 审查与验证

- 设计红队：16 条（7 Blocker / 7 Major / 2 Minor）；14 采纳、1 有据反驳、
  1 部分反驳，P7/P8 经用户裁决。
- 第二轮代码复审：7 条（1 Blocker / 3 Major / 3 Minor），全部采纳修复。
- TASK-004A 自审：`approved`。
- TASK-004B 自审：`approved`。
- TASK-004 精确测试：4 files / 95 tests。
- core 全量：1792 tests。
- studio 全量：484 tests。
- CLI 全量：209 tests。
- core/studio/CLI typecheck：全部通过。
- core/studio/CLI build：全部通过。
- 未修改依赖或 lockfile；未提交密钥、账本运行数据、生成内容或数据库。

环境偏差：当前 Windows 宿主单命令仍按 45 秒上限处理。CLI integration 从原交接
建议的三批细化为七批，每批包含 init；publish-package 拆为 1+6 两批。所有用例均
执行，没有把超时当通过。

## 5. 使用与手动核查

项目使用真实价格表时，从模板创建本地 `config/model-prices.json`。该文件被 ignore，
不要提交账户专属价格或任何密钥。

商业入口接线模式：

```ts
const recorder = new CostLedgerRecorder({
  projectRoot,
  pipelineConfig,
  logger,
});

const orchestrator = new VolumeProductionOrchestrator({
  projectRoot,
  basePipelineConfig: pipelineConfig,
  events: { onProductionSettled: recorder.onProductionSettled },
});
```

手动核查重点：

1. 成功或暂停运行返回值与未接 Recorder 时形状一致。
2. 对应书目录生成 `commercial/cost-ledger.jsonl`，故事状态和 SQLite 不变。
3. 同一 runId 不重复追加。
4. 缺价格表、表损坏、模型未命中分别留下不同原因。
5. 模拟写失败后生产结果仍返回，failure marker 和 logger 可见。
6. `git status` 不出现账本、撕裂备份或 failure marker 运行数据。

## 6. 尚未完成但不阻塞 TASK-004

- TASK-003 总任务的真实模型人工验收仍由用户执行。
- 原始 `write next`、`auto`、daemon、Scheduler 尚未被商业入口统一治理，因此可能
  绕过账本和商业闸门。
- Provider 内部重试次数不可观测。
- 没有 CLI/Studio 成本报表、预算阻断、自动对账或自动修复命令。
- 多模型只能按主模型近似计价。
- TASK-003 文档 `.gitignore` 白名单历史不一致仍待用户裁决。

## 7. 后续任务候选与建议顺序

以下是建议，不是冻结任务。新对话必须先核对现有文档中的编号占位并由用户裁决。

### A. 先完成 TASK-003 人工验收

无需先改代码。使用合法真实模型凭证执行 TASK-003 任务单中的人工验收项，记录运行
结果、失败原因和人工审核结论。通过后把 TASK-003 总状态改为 `completed`。

### B. 商业入口治理设计（最高工程优先级）

目标：避免原始 CLI、Studio、daemon、Scheduler 绕过商业状态和成本账本。

建议先做纯设计轮，至少冻结：

- 哪些入口强制走商业 Orchestrator，哪些只拒绝或保留管理员逃生口。
- daemon/Scheduler 的锁顺序、失败重试和暂停语义。
- 旧 CLI 行为的兼容期与迁移提示。
- Recorder 的默认装配位置与 logger/价格表生命周期。
- 回滚开关、跨入口并发测试和真实模型人工验收矩阵。

该任务会首次获准触碰当前 TASK-004 明确禁止的 CLI/Studio/daemon/Scheduler，必须新建
任务单，不能沿用 TASK-004 授权。

### C. 暂停恢复与 request_revision 执行

入口治理稳定后再做，避免恢复动作被旁路入口打乱。建议拆为状态转换/恢复 Store 与
编排执行两个子任务，冻结幂等键、章节号核对、失败后状态和人工权限。

### D. 审核身份、权限与完整审计历史

`volume-production-strategy.md` 已把 TASK-005 名称预留给这一方向。正式编号前应先确认
是否保持该预留，避免把“入口治理”误命名为 TASK-005 造成文档冲突。

### E. 成本报表与预算能力

先做只读报表：书级/项目级汇总、`ledgerHealth`、`tokenTotals.exact` 和近似计价标识。
积累真实数据后再讨论预算提醒或阻断；预算控制不得直接建立在缺失/损坏账本上。

推荐实际顺序：TASK-003 人工验收，与此同时启动入口治理设计；随后入口治理实现、
暂停恢复、审核权限，最后做报表和预算。

## 8. 新对话提示词

```text
你是接手“基于 InkOS 二开的小说智能体”项目的工程师。仓库：
https://github.com/redniu123/novel.git

先从 origin/develop 获取最新代码，不要使用旧 bundle 覆盖仓库。按顺序完整读取：
1. AGENTS.md
2. CLAUDE.md
3. docs/00-product-brief.md
4. docs/PROJECT-STATUS.md
5. docs/tasks/TASK-INDEX.md
6. docs/tasks/TASK-004-COMPLETION-AND-NEXT-STEPS.md
7. docs/tasks/TASK-004-cost-ledger.md
8. docs/modules/cost-ledger.md

当前事实：TASK-004 已 completed，P1-P8 与红队修复语义不得回退；TASK-003A/003B
代码已完成，但 TASK-003 总任务仍待真实凭证人工验收。下一开发任务尚未冻结。

你的第一轮只做事实核查和下一任务设计准备：检查 git status、develop 与 origin/develop
是否一致，核对完成报告中的测试/遗留与真实代码，然后向用户说明：
- TASK-003 人工验收如何执行；
- 商业入口治理、暂停恢复、审核权限、成本报表四个候选的依赖与建议顺序；
- volume-production-strategy.md 已预留 TASK-005 给审核身份/权限，任务编号需要用户裁决。

在用户确认下一任务编号、范围、禁止修改面、验收标准前，不创建功能分支、不修改代码。
确认后先创建 TASK 文档和模块设计，完成设计审查，再实现。继续遵守：不改 Runner、
Prompt、Provider、模型路由或故事权威状态，除非新任务单明确授权；不提交密钥、运行
账本、小说、数据库、日志或缓存；所有行为变化必须有测试。
```

## 9. 安全提醒

本轮 GitHub PAT 的 Basic header 曾被本地命令错误回显为 Base64（未写入仓库）；Codex
API key 在前任会话也曾部分回显。两项凭证都应轮换，并继续确保新值不进入 Git、日志
或交接文档。
