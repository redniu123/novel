# Volume Production Strategy 模块设计

## 1. 文档状态

- 对应总任务：TASK-003
- 子任务：TASK-003A、TASK-003B
- 文档状态：`pending_design_review`
- 起草日期：2026-07-15
- 审查修订日期：2026-07-16
- 设计分支：`docs/TASK-003-volume-strategy-design`
- 基线：`develop` / `30af928`
- 前置任务：TASK-002 `completed`，已合并 `develop`
- 本轮范围：真实代码分析和设计修订，不实现功能代码
- 首轮审查结论：`rejected`
- 参数冻结：2026-07-16 用户确认 1-12 全部采用推荐方案
- 推荐结论：Production Policy Resolver + Thin Volume Production Orchestrator

实现拆分：

- TASK-003A：冻结策略类型、商业状态 v1 Schema、State Store、发布资格纯函数和按书查询 API。
- TASK-003B：实现只调用一次现有 Runner 的薄编排器和商业人工审核 API。

Claude Code 完成本轮设计复审前，不得进入功能实现。

## 2. 背景和问题定义

TASK-002 已经让每本书拥有独立的 `productionMode`，但当前只保存和读取该字段，不改变章节生产行为。TASK-003 要让 `productionMode = "volume"` 在独立商业入口中产生最小、明确、可测试的效果。

冻结后的走量策略是：

1. 每次商业运行只生产一章。
2. 每章使用现有自动审查。
3. 自动修订次数读取现有 `writing.reviewRetries`，默认 1。
4. 每章必须经过商业人工审核。
5. 商业层完整章节管线自动重试固定为 0。
6. 目标字数读取现有 `BookConfig.chapterWordCount`。
7. 商业字数门槛使用现有 `LengthSpec` 软区间。
8. 失败后暂停该书的商业生产，等待人工处理。
9. `flagship` 在商业入口明确返回策略未实现。
10. 单章商业运行超时固定为 60 分钟。

本设计不修改 Writer、Planner、Prompt、Provider、模型路由、故事权威状态或自动发布能力。

## 3. TASK-002 提供的接口

真实实现位于 `packages/core/src/commercial/book-strategy.ts`，并由 `packages/core/src/index.ts` 导出。

### 3.1 最终类型

```typescript
export const PRODUCTION_MODES = ["volume", "flagship"] as const;
export type ProductionMode = "volume" | "flagship";

export type ResolvedBookStrategy =
  | {
      readonly schemaVersion: 1;
      readonly bookId: string;
      readonly productionMode: "volume";
      readonly source: "default";
    }
  | (BookStrategy & {
      readonly source: "file";
    });
```

持久化对象由严格 `BookStrategySchema` 校验，包含：

- `schemaVersion: 1`
- `bookId`
- `productionMode`
- `updatedAt`

### 3.2 读取接口

```typescript
const store = new BookStrategyStore(projectRoot);
const strategy = await store.load(bookId);
```

TASK-003 必须调用 `BookStrategyStore.load(bookId)`，不得直接读取 JSON。

### 3.3 存储和默认行为

```text
<projectRoot>/books/<bookId>/commercial/book-strategy.json
```

文件不存在时：

- 返回 `productionMode: "volume"`
- 返回 `source: "default"`
- 不创建文件
- 不写故事状态或故事 SQLite

文件损坏、Schema 非法、版本不支持或 `bookId` 不一致时明确报错，不静默回退。

### 3.4 TASK-003 对默认模式的解释

无 `book-strategy.json` 的旧书在商业入口中按 `volume` 处理。TASK-003 不新增 `volume-production-policy.json`，因此不存在“缺失走量策略文件”的第二层默认问题。

## 4. InkOS 当前章节生产流程

### 4.1 主调用链

完整单章入口是：

```typescript
PipelineRunner.writeNextChapter(bookId, wordCount?, temperatureOverride?)
```

真实调用链：

1. `StateManager.acquireBookLock(bookId)` 获取书级写锁。
2. 加载书籍配置，检查待修复的 `state-degraded`，计算下一章编号。
3. `PlannerAgent.planChapter` 生成章节意图和规划备忘。
4. 保存规划，组合 `ContextPackage`、`RuleStack` 等受治理输入。
5. 根据 `wordCount ?? book.chapterWordCount` 调用 `buildLengthSpec`。
6. `WriterAgent.writeChapter` 生成正文和候选故事状态更新。
7. 自动模式运行 `runChapterReviewCycle`，完成审查、有限修订和重新审查。
8. 生成最终真相文件并由 `StateValidatorAgent` 校验。
9. `persistChapterArtifacts` 保存章节、索引、故事状态、快照和 SQLite 记忆投影。
10. 返回 `ready-for-review`、`audit-failed` 或 `state-degraded`。
11. 释放书级写锁。

TASK-003 不得拆开调用 Planner、Writer、Auditor 和 Reviser，也不得复制落盘、真相校验、快照和恢复逻辑。

### 4.2 其他入口

- `writeDraft`：只写草稿，不自动审查或修订。
- `auditDraft`：审查已有章节。
- `reviseDraft`：修订已有章节，受 `revisionGate` 控制。
- CLI `write next --count <n>`：上层循环，可一次写多章。
- CLI `auto`：循环写到目标章节。
- Scheduler：支持 `chaptersPerCycle`、多书并行和失败后再次调用 Runner。

### 4.3 当前失败和有限重试

- Planner 章节备忘结构解析最多尝试 3 次，耗尽后使用 fallback memo。
- Writer 最终正文为空时 Runner 抛错。
- 审查解析失败时设置 `parseFailed`，跳过自动修订。
- 故事状态校验失败后只执行一次 settlement 重试，再失败则 `state-degraded`。
- SQLite busy 使用 0、25、75 ms 三次有限尝试。
- Provider 瞬时错误为初始调用加最多 2 次重试。
- Runner 支持 `AbortSignal`，但当前没有统一业务超时值。
- `ChapterPipelineResult` 可包含 `tokenUsage`，但没有成本账本。

## 5. 当前可复用能力

| 能力 | 真实来源 | TASK-003 用法 |
| --- | --- | --- |
| 模式 | `BookStrategyStore.load` | Resolver 唯一模式来源 |
| 单章管线 | `PipelineRunner.writeNextChapter` | TASK-003B 每次恰好调用一次 |
| 自动审查 | `chapterReviewMode: "auto"` | 走量商业入口固定启用 |
| 修订上限 | `writing.reviewRetries` | 解析为 `maxAutoRevisions`，默认 1 |
| 目标字数 | `BookConfig.chapterWordCount` | 不新增走量专属目标 |
| 长度范围 | `buildLengthSpec` | 软区间作为商业门槛 |
| 中止 | `runWithAbortSignal` | 实现 60 分钟超时 |
| 书级锁 | `StateManager.acquireBookLock` | 保护商业状态短事务和 Runner 落盘 |
| 状态降级 | `state-degraded` | 映射为商业暂停 |
| Token 摘要 | `ChapterPipelineResult.tokenUsage` | 只在调用结果中透传 |

## 6. 候选走量策略结论

| 候选策略 | 结论 |
| --- | --- |
| 一次只生产一章 | 纳入，固定为 1 |
| 正文后自动审查 | 纳入，固定为 true |
| 自动修订有限 | 纳入，读取 `writing.reviewRetries` |
| 每章人工审核 | 纳入，固定为 true |
| 未人工批准不得发布 | 纳入，提供 `isReleaseEligible` 纯函数和 `releaseEligible(bookId, chapterNumber)` API |
| 目标字数和偏差明确 | 纳入，读取目标并使用软区间 |
| 失败和超时停止 | 纳入，暂停该书 |
| 禁止无限重试 | 纳入，商业完整管线重试固定为 0 |
| 复用已有 Runner | 纳入，作为硬约束 |
| 修改 Prompt | 排除 |
| 新模型路由 | 排除 |
| 完整成本账本 | 排除到 TASK-004 |
| `flagship` 深度策略 | 排除，商业入口返回未实现 |

## 7. 方案 A、B、C

### 7.1 方案 A：直接修改现有章节管线

在 `PipelineRunner` 内读取 `productionMode`。

优点：

- 所有调用者自动生效。

缺点：

- 商业策略污染 InkOS 通用核心。
- 默认 `volume` 会改变所有旧书原始调用。
- 上游同步和回归测试成本高。
- 仍不能独立解决人工商业状态。

结论：不采用。

### 7.2 方案 B：外置走量生产编排器

在商业层读取模式、维护商业状态并调用 Runner。

优点：

- 商业状态与故事事实分离。
- 可集中处理人工闸门、超时和暂停。
- 容易独立回滚。

约束：

- 只能调用一次完整 `writeNextChapter`。
- 不得自行调用 Planner、Writer、Auditor、Reviser 重组管线。

结论：采用受约束的薄编排器。

### 7.3 方案 C：Production Policy Resolver

将 TASK-002 模式和已有配置解析为不可变策略。

优点：

- `productionMode` 被真实使用。
- 策略解析可以纯函数测试。
- 不修改 Prompt 或模型路由。
- 后续模式分派清晰。

限制：

- Resolver 不执行流程，需要薄编排器应用策略。

结论：作为方案核心采用。

## 8. 兼容性、风险和维护成本

| 维度 | 方案 A | 完整方案 B | 方案 C + 薄 B |
| --- | --- | --- | --- |
| 核心侵入 | 高 | 低 | 低 |
| 重复 Runner 风险 | 低 | 高 | 低 |
| 上游同步风险 | 高 | 低 | 低 |
| 商业状态隔离 | 差 | 好 | 好 |
| 测试成本 | 高 | 高 | 中 |
| 回滚难度 | 高 | 低 | 低 |

设计修订后仍存在的边界：

- 原始 `write next --count`、`auto` 和 Scheduler 不读取商业状态。
- 书级 Runner 锁只能防止同时落盘，不能保证原始入口遵守商业人工闸门。
- TASK-003B 只能保证“同书商业入口互斥”。
- 商业生产期间必须通过运行手册关闭 daemon，并禁止原始批量入口。
- 若要从代码层全局禁止绕过，必须新增统一入口治理任务，不得侵入本任务。

## 9. 最终推荐方案

```text
BookStrategyStore.load(bookId)
             |
             v
ProductionPolicyResolver
             |
             v
VolumeProductionOrchestrator
             |
             +----> PipelineRunner.writeNextChapter（恰好一次）
             |
             +----> VolumeProductionStateStore
             |
             +----> releaseEligible(bookId, chapterNumber)
```

分两步实现：

1. TASK-003A 先实现策略、状态 Schema、State Store、发布资格纯函数和按书查询 API，不调用 LLM。
2. TASK-003B 再实现薄编排器和商业审核 API，不新增 CLI、Studio 或 Scheduler 改造。

## 10. 模块边界

### TASK-003A

建议新增：

```text
packages/core/src/commercial/
  volume-production-policy.ts
  volume-production-state.ts
```

职责：

- 解析 `volume` 和 `flagship`。
- 定义 `VolumeProductionPolicyV1`。
- 定义并持久化 `VolumeProductionStateV1`。
- 实现受保护状态转换。
- 实现 `isReleaseEligible` 纯函数和 `releaseEligible(bookId, chapterNumber)` Store API。

### TASK-003B

建议新增：

```text
packages/core/src/commercial/
  volume-production-orchestrator.ts
  volume-production-review.ts
```

职责：

- 运行前后章节号检查。
- 60 分钟超时。
- 每次调用一次 Runner。
- Pipeline 结果映射。
- 商业人工审核状态转换。

共同允许：

- `packages/core/src/index.ts` 最小导出。
- 对应单元测试和临时目录集成测试。

共同禁止：

- 修改 Runner 内部阶段。
- 修改现有 `review approve/reject`。
- 新增 CLI、Studio、Scheduler 改造。
- 修改 Prompt、Provider 或模型路由。

## 11. 冻结配置和类型

### 11.1 唯一策略来源

TASK-003 不新增 `volume-production-policy.json`。

策略来源：

| 字段 | 冻结来源 |
| --- | --- |
| `mode` | `BookStrategyStore.load(bookId)` |
| `chaptersPerRun` | 固定 1 |
| `auditRequired` | 固定 true |
| `targetChapterWords` | `BookConfig.chapterWordCount` |
| `maxAutoRevisions` | `ProjectConfig.writing.reviewRetries`，默认 1 |
| `wordTolerance` | `buildLengthSpec(...).softMin/softMax` |
| `manualApprovalRequired` | 固定 true |
| `allowApprovalWithWarnings` | 固定 true，但受第 14 节硬门槛限制 |
| `maxPipelineRetries` | 固定 0 |
| `runTimeoutMs` | 固定 3,600,000 |
| `failureAction` | 固定 `pause_book` |

### 11.2 冻结策略类型

```typescript
export interface VolumeProductionPolicyV1 {
  readonly schemaVersion: 1;
  readonly mode: "volume";
  readonly chaptersPerRun: 1;
  readonly auditRequired: true;
  readonly targetChapterWords: number;
  readonly maxAutoRevisions: number;
  readonly wordTolerance: {
    readonly source: "length_spec_soft_range";
    readonly softMin: number;
    readonly softMax: number;
  };
  readonly manualApprovalRequired: true;
  readonly allowApprovalWithWarnings: true;
  readonly maxPipelineRetries: 0;
  readonly runTimeoutMs: 3_600_000;
  readonly failureAction: "pause_book";
}
```

`targetChapterWords` 和 `maxAutoRevisions` 是从现有配置解析出的运行值，不是新的商业配置字段。

### 11.3 模式分派

| `productionMode` | 商业入口行为 |
| --- | --- |
| `volume` | 返回 `VolumeProductionPolicyV1` |
| `flagship` | 抛出 `PRODUCTION_POLICY_NOT_IMPLEMENTED` |

`flagship` 的原始 InkOS Runner 行为不变。只有商业入口拒绝执行未实现策略。

## 12. 商业状态 v1 Schema 和状态机

### 12.1 存储位置

```text
<projectRoot>/books/<bookId>/commercial/volume-production-state.json
```

每本书恰好一个状态文件。文件内按章节编号保存记录。

状态文件不存在时，`load` 返回 `bookProductionStatus: "active"`、无 `activeRun`、空 `chapters` 的内存默认状态，不创建文件。第一次合法状态转换才持久化文件。JSON 损坏、Schema 非法、版本不支持或 `bookId` 不一致时明确报错，不覆盖原文件。

### 12.2 类型

```typescript
export type VolumeChapterProductionStatus =
  | "running"
  | "awaiting_manual_review"
  | "approved"
  | "revision_requested"
  | "rejected"
  | "paused";

export type VolumeManualReviewDecision =
  | "approve"
  | "reject"
  | "request_revision";

export interface VolumeLengthGateV1 {
  readonly target: number;
  readonly softMin: number;
  readonly softMax: number;
  readonly actual: number;
  readonly passed: boolean;
}

export interface VolumeAuditGateV1 {
  readonly pipelineStatus:
    | "ready-for-review"
    | "audit-failed"
    | "state-degraded";
  readonly parseFailed: boolean;
  readonly warningCount: number;
  readonly criticalCount: number;
  readonly warningOnly: boolean;
}

export interface VolumeProductionRunV1 {
  readonly runId: string;
  readonly expectedChapterNumber: number;
  readonly actualChapterNumber?: number;
  readonly observedNextChapterAfterRun?: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly outcome: "running" | "awaiting_manual_review" | "paused";
  readonly pipelineStatus?: VolumeAuditGateV1["pipelineStatus"];
  readonly auditGate?: VolumeAuditGateV1;
  readonly lengthGate?: VolumeLengthGateV1;
  readonly stopReason?: VolumeProductionStopReason;
}

export interface VolumeManualReviewV1 {
  readonly runId: string;
  readonly decision: VolumeManualReviewDecision;
  readonly decidedAt: string;
  readonly note?: string;
}

export interface VolumeChapterProductionRecordV1 {
  readonly chapterNumber: number;
  readonly currentStatus: VolumeChapterProductionStatus;
  readonly runs: readonly [
    VolumeProductionRunV1,
    ...VolumeProductionRunV1[],
  ];
  readonly reviews: ReadonlyArray<VolumeManualReviewV1>;
  readonly updatedAt: string;
}

export interface VolumeProductionStateV1 {
  readonly schemaVersion: 1;
  readonly bookId: string;
  readonly bookProductionStatus: "active" | "paused";
  readonly activeRun?: {
    readonly runId: string;
    readonly expectedChapterNumber: number;
    readonly startedAt: string;
  };
  readonly chapters: Readonly<Record<string, VolumeChapterProductionRecordV1>>;
  readonly updatedAt: string;
}
```

### 12.3 基数和历史规则

- `chapters` 每个章节编号最多一个记录。
- Record key 必须等于十进制 `chapterNumber`。
- 每章 `runs` 至少一个，按时间追加，禁止覆盖旧 run。
- TASK-003B 不自动重跑完整管线，因此一次 `produceNextChapter` 只追加一个 run。
- `reviews` 为追加历史；v1 中同一 `runId` 最多一个人工决定，重复提交明确报错。
- `request_revision` 只记录请求，不在 TASK-003B 自动执行修订。
- `activeRun` 全书最多一个。
- `tokenUsage` 不写入该状态文件，只在调用结果中透传。
- 不保存正文、完整模型输出、价格或费用。

### 12.4 状态转换

```text
无章节记录 -> running

running -> awaiting_manual_review
running -> paused

awaiting_manual_review -> approved
awaiting_manual_review -> rejected
awaiting_manual_review -> revision_requested
```

本任务不允许：

- `paused` 自动恢复
- `revision_requested` 自动重新生成
- `approved` 改写为 `published`
- 通过现有 InkOS review 命令修改商业状态

恢复、重新修订和发布属于后续显式任务。

### 12.5 Pipeline 到商业状态映射

按以下顺序匹配，靠前规则优先：

| 条件 | 商业状态 | 停止原因 |
| --- | --- | --- |
| 超时、取消、模型异常、上下文超限或调用抛错 | `paused` | 对应稳定错误码 |
| 返回章节号不等于运行前 `expectedChapterNumber` | `paused` | `CHAPTER_NUMBER_MISMATCH` |
| `pipelineStatus = state-degraded` | `paused` | `STATE_DEGRADED` |
| `parseFailed = true` | `paused` | `AUDIT_PARSE_FAILED` |
| `criticalCount > 0` | `paused` | `AUDIT_CRITICAL` |
| 最终字数不在软区间 | `paused` | `LENGTH_OUT_OF_POLICY` |
| `ready-for-review` 且以上硬门槛均通过 | `awaiting_manual_review` | 无 |
| `audit-failed` 且仅有 warning、以上硬门槛均通过 | `awaiting_manual_review` | `WARNING_OVERRIDE_REQUIRED` |
| 其他 `audit-failed` | `paused` | `AUDIT_FAILED` |

任何 `paused` 都把 `bookProductionStatus` 设置为 `paused`，阻止下一次商业生产，直到后续人工恢复能力完成。

## 13. 输入和输出

### 13.1 TASK-003A

```typescript
resolveProductionPolicy(bookId: string): Promise<VolumeProductionPolicyV1>;

loadVolumeProductionState(bookId: string): Promise<VolumeProductionStateV1>;

isReleaseEligible(
  state: VolumeProductionStateV1,
  chapterNumber: number,
): boolean;

releaseEligible(
  bookId: string,
  chapterNumber: number,
): Promise<boolean>;
```

### 13.2 TASK-003B

```typescript
interface ProduceNextVolumeChapterInput {
  readonly bookId: string;
  readonly signal?: AbortSignal;
}

interface VolumeProductionResult {
  readonly runId: string;
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly productionStatus: VolumeChapterProductionStatus;
  readonly pipelineStatus?:
    | "ready-for-review"
    | "audit-failed"
    | "state-degraded";
  readonly releaseEligible: boolean;
  readonly stopReason?: VolumeProductionStopReason;
  readonly tokenUsage?: TokenUsageSummary;
}

produceNextChapter(
  input: ProduceNextVolumeChapterInput,
): Promise<VolumeProductionResult>;

reviewChapter(input: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly runId: string;
  readonly decision: VolumeManualReviewDecision;
  readonly note?: string;
}): Promise<VolumeChapterProductionRecordV1>;
```

调用者不能覆盖目标字数、修订次数、超时或重试次数。

## 14. 人工审核闸门和发布资格

### 14.1 商业审核边界

TASK-003B 的 `reviewChapter`：

- 只写 `commercial/volume-production-state.json`。
- 不调用现有 `review approve`、`approve-all` 或 `reject`。
- 不写 `ChapterMeta.status`。
- 不回滚故事状态。
- 不写 `published`。

### 14.2 Warning 人工通过

`audit-failed` 只有在以下条件全部成立时才进入人工审核：

1. `parseFailed = false`
2. `criticalCount = 0`
3. `warningCount > 0`
4. `warningOnly = true`
5. `pipelineStatus != state-degraded`
6. 字数位于软区间
7. 实际章节号等于预期章节号

此时人工可选择 `approve`、`reject` 或 `request_revision`。

### 14.3 `releaseEligible` 确定性规则

仅当以下条件全部成立时返回 true：

| 条件 | 必须值 |
| --- | --- |
| 章节记录存在 | true |
| `currentStatus` | `approved` |
| 最新 review 的 `runId` | 等于最新 run 的 `runId` |
| 最新 review 的 `decision` | `approve` |
| 最新 run 的 `outcome` | `awaiting_manual_review` |
| `actualChapterNumber` | 等于 `expectedChapterNumber` |
| `auditGate.parseFailed` | false |
| `auditGate.criticalCount` | 0 |
| `auditGate.pipelineStatus` | `ready-for-review`，或 `audit-failed` 且 `warningOnly = true`、`warningCount > 0` |
| `lengthGate.passed` | true |
| `pipelineStatus` | 不是 `state-degraded` |

任一条件不满足即返回 false。该函数不读取 `ChapterMeta.status = approved/published`，也不产生发布动作。

## 15. 自动审查和修订

1. Orchestrator 固定使用 `chapterReviewMode: "auto"`。
2. 自动审查完全由 `runChapterReviewCycle` 完成。
3. 修订上限读取 `writing.reviewRetries`，缺省解析为 1。
4. 每轮修订后沿用现有重新审查和最佳快照选择。
5. `parseFailed` 直接映射商业暂停。
6. 达到修订上限后不从商业层重新调用完整管线。
7. `revisionGate` 只属于现有 `reviseDraft`，不参与走量自动修订上限。

## 16. 章节字数策略

冻结规则：

- 目标读取 `BookConfig.chapterWordCount`。
- 不新增走量专属目标字段。
- 中文按字符、英文按单词，沿用现有计数方式。
- 商业允许范围使用 `buildLengthSpec` 的 `softMin` 和 `softMax`。
- 目标 3000 时软区间约为 2591-3409。
- 超出软区间映射为 `paused`，不进入人工审核。
- 不修改 Writer Prompt 或 `LengthSpec` 算法。

如果未来需要独立走量目标或自定义偏差，另立任务。

## 17. 失败、超时和停止

| 事件 | 行为 |
| --- | --- |
| TASK-002 策略文件损坏 | 运行前失败，不创建 run |
| `flagship` | `PRODUCTION_POLICY_NOT_IMPLEMENTED`，不创建 run |
| 商业状态文件损坏 | 明确失败，不覆盖原文件 |
| Provider 瞬时错误 | 只使用 Provider 内置最多 2 次重试 |
| 完整 Runner 调用异常 | 不重试，商业状态转 `paused` |
| 上下文超限 | 不重试，转 `paused` |
| 审查解析失败 | 不重试，转 `paused` |
| `state-degraded` | 转 `paused` |
| 60 分钟超时 | Abort Runner，转 `paused` |
| 人工取消 | 转 `paused` |
| 状态写入失败 | 抛错，不宣称完成或可发布 |

冻结值：

```typescript
maxPipelineRetries = 0;
runTimeoutMs = 3_600_000;
failureAction = "pause_book";
```

Provider 内部重试不是商业完整管线重试。TASK-003 不根据异常重新调用 `writeNextChapter`。

## 18. 并发边界

TASK-003 保证的是“同书商业入口互斥”，不是全局禁止所有原始 InkOS 入口。

流程：

1. 在书级锁保护下确认 `bookProductionStatus = active` 且无 `activeRun`。
2. 读取运行前 `expectedChapterNumber`。
3. 写入 `activeRun` 和 `running`，释放锁。
4. 再次读取 next chapter；不一致则暂停且不调用 Runner。
5. 调用一次 `writeNextChapter`，由 Runner 自己获取书级锁。
6. 返回后核对 `actualChapterNumber` 和 `expectedChapterNumber`。
7. 在书级锁保护下按 `runId` 完成商业状态转换。

第二个商业请求看到 `activeRun` 时返回 `PRODUCTION_ALREADY_RUNNING`。

运行约束：

- 商业生产期间必须关闭 daemon。
- 禁止同时使用 `write next --count` 和 `auto`。
- 原始单章入口也不应与商业入口并行。
- 严格代码级全局入口治理属于后续任务。

## 19. 与故事状态的数据边界

商业状态可以保存：

- `bookId`
- `chapterNumber`
- `runId`
- Pipeline 状态摘要
- 字数门槛结果
- 审查门槛计数
- 商业人工决定
- 稳定停止原因和时间

商业状态不得保存或修改：

- 章节正文
- 人物、关系、世界规则和时间线事实
- `story/state/*.json`
- Markdown 故事投影
- `ChapterMeta.status`
- 故事 SQLite Schema
- 完整模型输出
- Token 账本

## 20. 与 TASK-004 成本账本的边界

TASK-003 只在 `VolumeProductionResult` 中透传 Runner 已提供的 `tokenUsage`。

TASK-003 不：

- 把 `tokenUsage` 写入商业状态
- 保存模型价格
- 计算费用
- 汇总调用次数
- 建立预算
- 记录 Provider 重试明细

未来事件接口仅作为 TASK-004 占位，本任务不定义或持久化账本事件。

## 21. 错误模型

```typescript
type VolumeProductionErrorCode =
  | "PRODUCTION_MODE_LOAD_FAILED"
  | "PRODUCTION_POLICY_NOT_IMPLEMENTED"
  | "PRODUCTION_ALREADY_RUNNING"
  | "PRODUCTION_BOOK_PAUSED"
  | "PRODUCTION_STATE_INVALID"
  | "PRODUCTION_INVALID_TRANSITION"
  | "PRODUCTION_PIPELINE_FAILED"
  | "PRODUCTION_AUDIT_FAILED"
  | "PRODUCTION_AUDIT_PARSE_FAILED"
  | "PRODUCTION_LENGTH_OUT_OF_POLICY"
  | "PRODUCTION_STATE_DEGRADED"
  | "PRODUCTION_CHAPTER_NUMBER_MISMATCH"
  | "PRODUCTION_TIMEOUT"
  | "PRODUCTION_ABORTED"
  | "PRODUCTION_MANUAL_APPROVAL_REQUIRED"
  | "PRODUCTION_STATE_WRITE_FAILED";
```

错误对象至少包含 `code`、`bookId`、可选 `chapterNumber`、可选 `runId` 和可选 `cause`。不得解析模型错误文本决定商业状态。

## 22. 测试设计

### 22.1 TASK-003A

1. 无 `book-strategy.json` 时解析默认 `volume`。
2. 显式 `volume` 解析冻结策略。
3. `flagship` 明确返回未实现。
4. 目标字数来自 `chapterWordCount`。
5. 修订上限来自 `writing.reviewRetries`，默认 1。
6. 超时、人工审核、外层重试和失败动作均为冻结值。
7. 状态文件 v1 Schema 校验。
8. 每章记录、runs 和 reviews 基数校验。
9. 两书隔离。
10. 原子写入失败不破坏旧文件。
11. stale `runId` 不覆盖当前状态。
12. 非法状态转换被拒绝。
13. Pipeline 映射表逐项覆盖。
14. `releaseEligible` 真值表逐项覆盖。
15. 商业状态不含正文或 `tokenUsage`。

### 22.2 TASK-003B

1. 每次商业运行恰好调用一次 Runner。
2. 强制自动审查。
3. 完整管线异常不进行商业重试。
4. 60 分钟超时使用 AbortSignal。
5. 运行前 next chapter 不一致时不调用 Runner。
6. 运行后章节号不一致时暂停。
7. 同书商业入口并发只有一个调用 Runner。
8. `ready-for-review` 映射到待人工审核。
9. warning-only `audit-failed` 可进入人工审核。
10. critical、parseFailed、字数越界、state-degraded 均暂停。
11. 三种人工决定只写 commercial 状态。
12. 不调用现有 review 命令或修改 `ChapterMeta.status`。
13. `tokenUsage` 只在结果中透传。

### 22.3 回归

- 使用临时项目和假 LLM。
- 运行精确测试、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- 原始 Runner、CLI、Studio 和 Scheduler 行为不变。

## 23. 回滚方案

TASK-003A 回滚：

- 删除新增策略和状态模块、导出及测试。
- 备份后删除 `commercial/volume-production-state.json`。
- 保留 TASK-002 的 `commercial/book-strategy.json`。

TASK-003B 回滚：

- 删除薄编排器和商业审核 API、导出及测试。
- 原始 InkOS Runner 和 review 命令继续工作。

回滚不得修改故事权威状态、章节正文或故事 SQLite。

## 24. 非目标

TASK-003 不实现：

- 模型路由或自动模型选择
- 模型价格表、Token 或费用账本
- 外层完整管线自动重试
- 幂等章节重放
- daemon、原始 CLI 或 Scheduler 全局入口治理
- 自动恢复暂停书
- 自动执行 `request_revision`
- 自动发布
- 平台账号管理
- 多书并行
- 市场选题、商业总编、多读者模拟和真实评论
- `flagship` 深度策略
- Studio 大规模界面改造
- 核心 Prompt 重写
- 故事状态或 SQLite Schema 修改

## 25. 已冻结业务参数

2026-07-16 用户确认以下 12 项全部采用推荐方案：

1. 目标字数直接读取 `BookConfig.chapterWordCount`。
2. 允许偏差使用现有 `LengthSpec` 软区间。
3. 自动修订读取 `writing.reviewRetries`，默认 1。
4. 每章必须人工审核。
5. 人工结果固定为 `approve`、`reject`、`request_revision`。
6. 只有 warning 且全部硬门槛通过时允许人工批准。
7. 商业完整管线可重试错误集合为空。
8. 商业完整管线最大自动重试次数为 0。
9. 失败后暂停该书商业生产，等待人工处理。
10. `flagship` 在商业入口返回 `PRODUCTION_POLICY_NOT_IMPLEMENTED`。
11. 单章商业运行超时为 60 分钟。
12. 不新增商业策略文件；策略由版本化常量和已有书籍/项目配置解析。

这些参数在 TASK-003A/003B 中不得自行调整。任何变更必须重新设计审查。

## 26. 与后续任务的接口

### TASK-003A

冻结策略、状态 v1、State Store、状态转换、发布资格纯函数和按书查询 API。

### TASK-003B

薄编排器、商业人工审核 API、超时和 Pipeline 映射。

### TASK-004

未来可消费 `VolumeProductionResult.tokenUsage`，但 TASK-003 不保存账本事件。

### TASK-005

扩展审核人身份、权限、完整审计历史和批注。TASK-003 只保存最小人工决定。

### 后续入口治理

统一 CLI、Studio、daemon 和 Scheduler 对商业闸门的遵守，提供代码级全局防绕过。

### 后续恢复和修订

实现暂停恢复、`request_revision` 执行、幂等恢复和人工发布衔接。

### 后续 `flagship`

复用 Production Policy Resolver 增加独立策略，不修改 `VolumeProductionPolicyV1`。
