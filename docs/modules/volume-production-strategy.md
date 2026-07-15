# Volume Production Strategy 模块设计

## 1. 文档状态

- 对应任务：TASK-003
- 文档状态：`pending_design_review`
- 起草日期：2026-07-15
- 设计分支：`docs/TASK-003-volume-strategy-design`
- 基线：`develop` / `30af928`
- 前置任务：TASK-002 `completed`，已合并 `develop`
- 本轮范围：真实代码分析与设计，不实现功能代码
- 推荐结论：采用“方案 C：Production Policy Resolver”作为策略核心，并配合不重复实现 Runner 的薄层“方案 B：Volume Production Orchestrator”

本设计尚有业务参数需要用户确认。参数未确认、Claude Code 未完成设计审查前，不得进入功能实现。

## 2. 背景和问题定义

TASK-002 已经让每本书拥有独立的 `productionMode`，但该字段当前只被保存和读取，不会改变章节生产行为。无论模式是 `volume` 还是 `flagship`，现有 CLI、Studio、Scheduler 和 `PipelineRunner` 都不会读取它。

TASK-003 需要让 `productionMode = "volume"` 产生最小、明确、可测试的业务效果，同时满足以下边界：

1. 复用 InkOS 已有章节管线，不重写 Planner、Writer、Auditor、Reviser 或状态落盘。
2. 每次商业生产运行最多启动一章。
3. 正文生成后必须进入现有自动审查流程。
4. 自动修订、模型重试和外层运行重试均不得无限执行。
5. 人工审核与可发布资格属于商业生产状态，不改变故事权威状态的含义。
6. 不修改核心 Prompt，不新增模型路由，不实现 TASK-004 成本账本。

这里的“走量”不是降低质量门槛，也不是批量无人值守写作，而是将现有单章能力组合成一个有固定边界、可暂停、可人工把关的商业生产入口。

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

持久化对象由严格的 `BookStrategySchema` 校验，包含：

- `schemaVersion: 1`
- `bookId`
- `productionMode`
- `updatedAt`

### 3.2 读取和更新接口

```typescript
const store = new BookStrategyStore(projectRoot);

await store.load(bookId);
await store.save(bookId, input);
await store.setProductionMode(bookId, productionMode);
```

TASK-003 必须调用 `BookStrategyStore.load(bookId)`，不得直接读取 JSON。

### 3.3 存储位置和默认行为

存储位置：

```text
<projectRoot>/books/<bookId>/commercial/book-strategy.json
```

文件不存在时：

- 返回 `productionMode: "volume"`
- 返回 `source: "default"`
- 不创建文件
- 不写故事状态或故事 SQLite

文件损坏、Schema 非法、版本不支持或 `bookId` 不一致时明确报错，不静默回退。

### 3.4 TASK-002 未提供的能力

TASK-002 没有：

- 将模式接入章节生产入口
- 走量策略参数
- 商业生产状态机
- 人工审核记录或发布资格
- 外层运行重试策略
- `flagship` 的差异化策略

## 4. InkOS 当前章节生产流程

### 4.1 主调用链

完整单章管线入口是：

```typescript
PipelineRunner.writeNextChapter(bookId, wordCount?, temperatureOverride?)
```

真实调用链如下：

1. `StateManager.acquireBookLock(bookId)` 获取书级写锁。
2. 加载书籍配置，检查是否存在待修复的 `state-degraded` 章节，计算下一章编号。
3. `PlannerAgent.planChapter` 生成章节意图和规划备忘。
4. 保存持久化规划，并组合 `ContextPackage`、`RuleStack` 等受治理输入。
5. 根据 `wordCount ?? book.chapterWordCount` 调用 `buildLengthSpec`。
6. `WriterAgent.writeChapter` 生成正文和候选故事状态更新。
7. `chapterReviewMode = "auto"` 时运行 `runChapterReviewCycle`：
   - 自动审查；
   - 必要时自动修订；
   - 每次修订后重新审查；
   - 保存得分更优或通过的版本。
8. 生成最终真相文件并由 `StateValidatorAgent` 校验；失败时执行一次 settlement 重试。
9. `persistChapterArtifacts` 保存章节 Markdown、章节索引、故事状态、快照和 SQLite 记忆投影。
10. 返回 `ChapterPipelineResult`，状态为：
    - `ready-for-review`
    - `audit-failed`
    - `state-degraded`
11. 释放书级写锁。

因此，TASK-003 不应自行依次调用 Planner、Writer、Auditor 和 Reviser。这样做会重复 `PipelineRunner` 已有的落盘、真相校验、快照和错误恢复逻辑。

### 4.2 其他章节入口

- `writeDraft`：只写草稿，状态为 `drafted`，不自动审查和修订。
- `auditDraft`：对已存在章节执行审查，更新为 `ready-for-review` 或 `audit-failed`。
- `reviseDraft`：对已存在章节重新审查、修订和落盘；`revisionGate` 决定是否采用手动修订结果。
- CLI `write next --count <n>`：循环调用 `writeNextChapter`，可以一次写多章。
- CLI `auto`：循环写到目标章节，强制自动审查。
- `Scheduler`：支持 `chaptersPerCycle`、多书并行和失败后重试。

### 4.3 当前行为结论

1. `PipelineRunner.writeNextChapter` 单次调用天然只写一章。
2. CLI 和 Scheduler 的上层循环可以在一次命令或周期中写多章。
3. 当前完整管线已经支持自动审查和有限自动修订。
4. 当前没有正式的商业生产状态机。
5. 当前人工审核命令可以直接把 `audit-failed` 标为 `approved`，不能直接作为 TASK-003 的严格发布闸门。
6. 当前 `published` 只是章节状态枚举之一，没有由 TASK-003 所需规则保护的自动发布流程。

### 4.4 当前失败和降级细节

- Planner 章节备忘的结构化解析最多尝试 3 次；耗尽后返回合法 fallback memo 并记录 warning，不会停止整章。
- 规划选择器遇到不合法结构化输出时可以回退为空选择结果。
- Writer 对正文结构有兼容解析路径；最终正文为空时 Runner 明确抛错。
- 自动审查输出解析失败时设置 `parseFailed`，跳过自动修订，不能视为审查通过。
- 故事状态校验失败时只执行一次 settlement 重试；再次失败后保存章节为 `state-degraded`，并阻止后续章节。
- SQLite busy 写入使用 0、25、75 ms 三次有限尝试；记忆索引不可用时保留 Markdown 权威数据。
- Provider 瞬时错误为初始调用加最多 2 次重试；当前没有统一的业务运行超时值，但 Runner 支持 `AbortSignal`。
- 章节结果可以包含 `tokenUsage`，当前没有 Provider 调用次数、重试次数和货币成本的统一账本。

## 5. 当前可复用能力

| 能力 | 真实位置 | 当前行为 | TASK-003 用法 |
| --- | --- | --- | --- |
| 生产模式 | `commercial/book-strategy.ts` | 按书读取，缺失时默认 `volume` | 策略解析唯一模式来源 |
| 单章完整管线 | `pipeline/runner.ts` | 一次调用写一章并完成落盘 | 薄编排器只调用一次 |
| 自动审查 | `chapterReviewMode: "auto"` | 写后进入审查和修订循环 | 走量入口强制使用 |
| 自动修订上限 | `writing.reviewRetries` | 默认 1，Schema 范围 0-10 | 解析为 `maxAutoRevisions` |
| 章节目标字数 | `BookConfig.chapterWordCount` | 最小 1000，默认 3000 | 作为目标字数来源 |
| 长度区间 | `buildLengthSpec` | 按目标值比例生成软、硬区间 | 继续用于 Writer 和现有管线 |
| 手动修订门槛 | `revisionGate` | `strict` / `lenient` / `always` | 仅用于现有 `reviseDraft`，不冒充自动修订上限 |
| 书级互斥 | `StateManager.acquireBookLock` | 同书写入互斥 | 防止章节正文并发落盘 |
| 中止能力 | `PipelineRunner.runWithAbortSignal` | 将 `AbortSignal` 传入模型调用和阶段检查 | 可实现外层运行超时 |
| LLM 瞬时重试 | `llm/provider.ts` | 初始调用加最多 2 次重试 | 保持原行为，不重复叠加 |
| 上下文上限 | `ContextWindowExceededError` | 超过模型上下文时停止 | 视为不可自动重试 |
| 状态降级保护 | `state-degraded` | 阻止后续章节继续写作 | 走量状态转为暂停 |
| Token 用量摘要 | `ChapterPipelineResult.tokenUsage` | 提供单章汇总 | 可透传，不建立成本账本 |

## 6. 候选走量策略

| 候选策略 | 是否进入 TASK-003 | 设计结论 |
| --- | --- | --- |
| 一次只允许生产一章 | 是 | 在商业编排入口固定 `chaptersPerRun = 1`，不调用 CLI 多章循环或 Scheduler 多章周期 |
| 正文生成后必须自动审查 | 是 | 薄编排器创建或调用强制 `chapterReviewMode = "auto"` 的 Runner |
| 自动修订次数有明确上限 | 是 | 复用 `writing.reviewRetries`；具体数值由用户确认 |
| 每章进入人工审核闸门 | 待用户确认 | 设计独立商业状态，不直接改变故事状态 |
| 未人工通过不得标记可发布 | 是，但仅设计资格查询 | TASK-003 不发布内容，只提供严格的 `releaseEligible` 判定 |
| 目标字数和允许偏差明确 | 是 | 目标复用 `chapterWordCount`；业务偏差由非 LLM 后置检查执行 |
| 模型、超时、Schema 失败时停止 | 是 | 分类失败并暂停，不自动继续下一章 |
| 禁止无限自动重试和修订 | 是 | 保留现有有限重试，并禁止无界外层循环 |
| 复用现有配置和章节管线 | 是 | 作为推荐方案的硬约束 |
| 修改核心 Prompt | 否 | 明确禁止 |
| 新模型路由 | 否 | 明确禁止 |
| 完整 Token 和成本账本 | 否 | 交给 TASK-004 |
| 多章批处理和 Scheduler 全面改造 | 否 | 超出单章 MVP，后续任务处理 |
| `flagship` 深度策略 | 否 | 本任务只确定兼容行为 |

## 7. 方案比较

### 7.1 方案 A：直接修改现有章节管线

做法：在 `PipelineRunner.writeNextChapter` 或 `_writeNextChapterLocked` 中读取 `productionMode`，并在内部增加走量分支。

优点：

- 调用者无需改造即可生效。
- 表面实现路径短。
- 可以直接访问审查、修订和落盘阶段。

缺点：

- `PipelineRunner` 将依赖商业策略模块，污染 InkOS 通用章节能力。
- TASK-002 默认 `volume` 会让所有旧书的原始调用行为发生变化。
- 后续新增 `flagship` 或其他策略会不断增加核心条件分支。
- 上游 InkOS 同步时容易发生冲突。
- 测试需要覆盖 Runner 的所有入口、CLI、Studio、Scheduler 和默认旧书兼容。
- 商业审核状态仍需另建，无法仅靠 Runner 内部分支解决。

结论：不推荐。只有当未来要求所有 InkOS 原始入口都不可绕过商业策略时，才重新评估。

### 7.2 方案 B：外置走量生产编排器

做法：增加 `VolumeProductionOrchestrator`，由它读取策略、维护商业状态，并调用 InkOS 已有章节能力。

优点：

- 符合商业运营层与故事权威状态分离原则。
- 可以集中处理人工闸门、停止策略、运行状态和发布资格。
- 对 Writer、Prompt、模型路由和故事状态侵入低。
- 易于按 `bookId` 隔离和单独回滚。

风险：

- 如果编排器分别调用 Planner、Writer、Auditor、Reviser，会重复实现 Runner。
- 如果不提供持久化运行状态，进程中断后无法判断当前章处于哪个商业阶段。
- 原始 `write next`、`auto` 和 Scheduler 仍可绕开商业入口，需要明确产品边界。

约束后的结论：可以采用，但必须是“薄编排器”。它每次只调用一次 `PipelineRunner.writeNextChapter`，不复制内部阶段。

### 7.3 方案 C：配置策略解析层

做法：增加 `ProductionPolicyResolver`，把 TASK-002 的模式、现有书籍配置、现有项目写作配置和少量商业配置解析为不可变策略。

```typescript
interface VolumeProductionPolicy {
  readonly mode: "volume";
  readonly chaptersPerRun: 1;
  readonly auditRequired: true;
  readonly maxAutoRevisions: number;
  readonly manualApprovalRequired: boolean;
  readonly allowApprovalWithWarnings: boolean;
  readonly targetChapterWords: number;
  readonly chapterWordTolerance: ChapterWordTolerance;
  readonly runTimeoutMs: number;
  readonly retryPolicy: VolumeRetryPolicy;
  readonly failureAction: "pause_chapter" | "stop_book";
}
```

优点：

- `productionMode` 被真实读取并转换为可测试行为。
- 策略解析可用纯函数测试。
- 不需要修改 Prompt 或模型路由。
- 策略值和执行逻辑解耦，便于后续增加 `flagship`。
- 可以明确哪些值来自 InkOS，哪些属于商业层。

限制：

- Resolver 本身不能执行流程或维护状态。
- 仍需要一个最小适配层把策略应用到 Runner。
- 新增商业参数必须有稳定存储或明确配置来源。

结论：推荐作为核心，但必须和受约束的薄层方案 B 组合。

## 8. 兼容性、风险和维护成本比较

| 维度 | 方案 A：改 Runner | 方案 B：完整外置编排 | 方案 C + 薄 B |
| --- | --- | --- | --- |
| 核心侵入 | 高 | 低 | 低 |
| 重复 Runner 风险 | 低 | 高 | 低 |
| 上游同步风险 | 高 | 低 | 低 |
| `productionMode` 使用清晰度 | 中 | 高 | 高 |
| 商业状态隔离 | 差 | 好 | 好 |
| 单元测试成本 | 高 | 中 | 低至中 |
| 集成测试成本 | 高 | 高 | 中 |
| `flagship` 扩展 | 条件分支膨胀 | 可扩展 | 策略分派清晰 |
| 回滚难度 | 高 | 低 | 低 |
| 维护成本 | 高 | 中至高 | 中 |

已识别风险：

- Major：现有 `review approve` 和 `approve-all` 可以批准 `audit-failed`，不能作为严格商业闸门的唯一依据。
- Major：现有 `write next --count`、`auto` 和 Scheduler 能绕开新编排器；TASK-003 必须明确新商业入口是发布资格的唯一来源。
- Minor：当前章节状态只有枚举，没有统一的受保护状态机。
- Minor：当前 Provider 有有限瞬时重试和中止信号，但没有统一的业务运行超时配置。
- Suggestion：后续可让 CLI 和 Studio 统一调用商业编排入口，但不在本设计轮实现。

## 9. 最终推荐方案

采用“Production Policy Resolver + Thin Volume Production Orchestrator + Commercial Production State Store”：

```text
商业入口（CLI / Studio 后续适配）
                |
                v
VolumeProductionOrchestrator
        |              |
        v              v
ProductionPolicyResolver ----> BookStrategyStore.load(bookId)
        |
        v
PipelineRunner.writeNextChapter（恰好一次）
        |
        v
VolumeProductionStateStore（仅商业状态）
```

核心规则：

1. Resolver 必须先调用 TASK-002 的 `BookStrategyStore.load`。
2. `volume` 解析为固定单章、自动审查和有限修订策略。
3. Orchestrator 每次运行只调用一次 `writeNextChapter`。
4. Orchestrator 不调用独立 Planner、Writer、Auditor 或 Reviser 来重组管线。
5. `flagship` 不应用走量策略，其行为等待用户确认。
6. 原始 InkOS 入口保持原版行为；由商业入口产生并记录的章节才有 TASK-003 发布资格。
7. 不修改 Prompt、模型路由、故事权威状态或 SQLite Schema。

## 10. 模块边界

实现阶段建议新增：

```text
packages/core/src/commercial/
  production-policy.ts
  volume-production-policy.ts
  volume-production-state.ts
  volume-production-orchestrator.ts
```

建议职责：

- `production-policy.ts`：模式分派和公共错误类型。
- `volume-production-policy.ts`：严格 Schema、配置读取和 resolved policy。
- `volume-production-state.ts`：书级商业生产状态的安全路径、原子读写和状态转换。
- `volume-production-orchestrator.ts`：单章调用、结果映射、超时和人工闸门。

允许的最小适配：

- `packages/core/src/index.ts` 新增导出。
- 新增对应单元测试和临时目录集成测试。
- 设计审查确认后，可增加一个最小 CLI 商业入口及其命令测试。

禁止：

- 修改 `PipelineRunner` 的章节阶段实现。
- 将 `productionMode` 判断加入 Writer、Prompt、Auditor 或 Reviser。
- 修改故事状态 Schema 或 SQLite Schema。
- 复制 `persistChapterArtifacts`、真相校验或快照逻辑。

## 11. 配置和类型设计

### 11.1 配置来源

| 策略字段 | 来源 | 说明 |
| --- | --- | --- |
| `mode` | `BookStrategyStore.load` | 必须真实读取 |
| `chaptersPerRun` | TASK-003 固定值 1 | 非用户可调批量参数 |
| `auditRequired` | TASK-003 固定值 true | 走量商业入口不可关闭 |
| `targetChapterWords` | `BookConfig.chapterWordCount` | 不重复建立目标字数来源 |
| `maxAutoRevisions` | `ProjectConfig.writing.reviewRetries` | 复用现有 0-10 校验 |
| `chapterWordTolerance` | 新商业配置 | 只做最终业务门槛检查 |
| `manualApprovalRequired` | 新商业配置 | 待用户确认 |
| `allowApprovalWithWarnings` | 新商业配置 | 待用户确认 |
| `runTimeoutMs` | 新商业配置 | 待用户确认 |
| `retryPolicy` | 新商业配置 | 待用户确认；不得叠加无界重试 |
| `failureAction` | 新商业配置 | 待用户确认 |

### 11.2 建议的新商业配置

不扩展 TASK-002 严格的 `book-strategy.json`，避免修改其 Schema v1。建议按书保存：

```text
<projectRoot>/books/<bookId>/commercial/volume-production-policy.json
```

建议类型：

```typescript
type ChapterWordTolerance =
  | { readonly kind: "absolute"; readonly value: number }
  | { readonly kind: "ratio"; readonly value: number };

interface VolumeRetryPolicy {
  readonly maxAutomaticRetries: number;
  readonly retryableErrors: ReadonlyArray<VolumeRetryableError>;
}

interface VolumeProductionPolicyConfig {
  readonly schemaVersion: 1;
  readonly bookId: string;
  readonly chapterWordTolerance: ChapterWordTolerance;
  readonly manualApprovalRequired: boolean;
  readonly allowApprovalWithWarnings: boolean;
  readonly runTimeoutMs: number;
  readonly retryPolicy: VolumeRetryPolicy;
  readonly failureAction: "pause_chapter" | "stop_book";
  readonly updatedAt: string;
}
```

具体数值、错误集合和缺失配置时的行为必须由用户确认。设计审查前不得写死业务默认值。

### 11.3 `flagship` 分派

Resolver 必须显式处理 `flagship`，不得误套用走量策略。候选行为：

- `passthrough`：返回原版 InkOS 行为，不创建走量商业状态。
- `not_implemented`：返回明确的 `PRODUCTION_POLICY_NOT_IMPLEMENTED`。

最终行为由用户确认。

## 12. 状态机

建议商业状态单独保存：

```text
<projectRoot>/books/<bookId>/commercial/volume-production-state.json
```

建议章节生产状态：

```typescript
type VolumeChapterProductionStatus =
  | "running"
  | "completed"
  | "awaiting_manual_review"
  | "approved"
  | "revision_requested"
  | "rejected"
  | "paused"
  | "failed";
```

建议转换：

```text
无记录
  -> running

running
  -> completed
  -> awaiting_manual_review
  -> paused
  -> failed

awaiting_manual_review
  -> approved
  -> revision_requested
  -> rejected

revision_requested
  -> running（显式重新处理）

paused
  -> running（显式恢复）
  -> failed（人工终止）
```

规则：

- `published` 不属于该状态机。
- 不直接修改现有 `ChapterStatus` 的含义。
- 每次转换记录 `runId`、`chapterNumber`、时间和原因码。
- 不保存正文、故事事实或完整审查副本。
- 非法转换明确报错，不自动纠正。

## 13. 输入和输出

建议接口：

```typescript
interface ProduceNextVolumeChapterInput {
  readonly bookId: string;
  readonly signal?: AbortSignal;
}

interface VolumeProductionResult {
  readonly runId: string;
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly productionMode: "volume";
  readonly productionStatus: VolumeChapterProductionStatus;
  readonly pipelineStatus?: "ready-for-review" | "audit-failed" | "state-degraded";
  readonly releaseEligible: boolean;
  readonly stopReason?: VolumeProductionStopReason;
  readonly tokenUsage?: TokenUsageSummary;
}
```

输入只包含书 ID 和可选中止信号。目标字数、修订上限和商业规则由 Resolver 统一解析，避免调用者临时覆盖策略。

输出透传必要的章节结果和 Token 摘要，但不计算价格、不写成本账本。

## 14. 人工审核闸门

人工审核是商业状态，不等同于故事事实确认。

最低规则：

1. 自动管线结束后先检查 `pipelineStatus`、审查问题和业务字数门槛。
2. 需要人工审核时转为 `awaiting_manual_review`。
3. 未处于 `awaiting_manual_review` 不得直接批准。
4. `approved` 才能满足“人工审核已通过”。
5. `releaseEligible` 是派生值，不写成 `published`。
6. TASK-003 不实现自动发布。

建议人工结果候选：

- `approve`
- `reject`
- `request_revision`

结果集合、拒绝后是否回滚故事状态、警告是否允许批准，均须由用户确认。现有 `review approve-all` 可以批准 `audit-failed`，因此不能直接作为该闸门的权威实现。

## 15. 自动审查和修订行为

1. Volume Orchestrator 强制使用 `chapterReviewMode: "auto"`。
2. 自动审查仍由 `runChapterReviewCycle` 完成。
3. 自动修订上限使用 `writing.reviewRetries`，当前默认值为 1，Schema 限制为 0-10。
4. 每轮修订后仍由现有管线重新审查并选择更优快照。
5. 审查结构化输出 `parseFailed` 时，现有代码会跳过自动修订；TASK-003 应将该章转为暂停或失败，不得视为通过。
6. `revisionGate` 只控制现有 `reviseDraft` 的手动修订采用规则，不替代自动修订上限。
7. 达到修订上限后停止，不从外层重新启动整条管线来规避上限。

## 16. 章节字数策略

当前真实能力：

- `BookConfig.chapterWordCount` 最小为 1000，默认 3000。
- 中文按去除空白后的字符计数，英文按单词计数。
- `buildLengthSpec` 以 2200 为参考：
  - 软偏差：`floor(target * 300 / 2200)`
  - 硬偏差：`floor(target * 600 / 2200)`
- 目标为 3000 时，软区间约为 2591-3409，硬区间约为 2182-3818。

TASK-003 推荐：

1. 目标字数继续读取 `book.chapterWordCount`。
2. 不修改 Writer Prompt 和现有 `LengthSpec`。
3. 用户确认的商业允许偏差由 Orchestrator 在管线返回后做确定性检查。
4. 超出商业偏差时标记 `paused` 或 `failed`，不自动开始下一章。
5. 若用户要求自定义偏差直接驱动 Writer 的生成和修订，应拆为后续适配任务，因为当前 `writeNextChapter` 不接收自定义 `LengthSpec`。

## 17. 失败、超时和停止行为

| 失败类型 | 当前能力 | TASK-003 行为 |
| --- | --- | --- |
| 策略文件损坏或不匹配 | `BookStrategyStore` 明确报错 | 运行前停止，不写章节 |
| 商业策略配置损坏 | 尚无 | 明确报错，不使用静默默认 |
| 429、502、503、504、部分传输失败 | Provider 最多自动重试 2 次 | 保持现有限制，不再无界叠加 |
| Context Window 超限 | 明确异常 | 停止并暂停当前章 |
| 模型不可用或非瞬时错误 | 抛出异常 | 停止，不自动继续下一章 |
| 审查 Schema 解析失败 | `parseFailed`，跳过自动修订 | 记录失败并暂停 |
| 达到自动修订上限 | 返回最佳结果或审查失败 | 停止，不重启整条管线 |
| `state-degraded` | 后续写作被阻止 | 转为暂停，要求先修复故事状态 |
| 超时或人工取消 | `AbortSignal` 可传播 | 中止运行并记录原因，不自动重试 |
| `BOOK_BUSY` | 书级锁拒绝并发 | 返回并发错误，不排队生成第二章 |
| 商业状态落盘失败 | 待新增原子存储 | 返回失败，不宣称发布可用 |

外层自动重试必须保守处理。`writeNextChapter` 不是带幂等键的事务接口，异常发生时可能无法仅凭异常判断是否已有部分产物。因此，在没有明确“未落盘”信号前，不得对整个章节管线盲目重试。用户要求的重试次数只能应用于经设计确认的安全错误类别。

## 18. 并发边界

1. 每个 `bookId` 同时最多一个商业生产运行。
2. 启动时在书级锁保护下写入 `running` 和唯一 `runId`，随后释放锁。
3. 调用 `writeNextChapter` 时由 Runner 自己获取书级锁，避免嵌套获取同一锁。
4. 第二个编排请求看到 `running` 时返回 `PRODUCTION_ALREADY_RUNNING`。
5. Runner 返回后，再在书级锁保护下按 `runId` 更新商业状态。
6. 进程崩溃留下的 `running` 不自动忽略；通过超时和显式恢复转换为 `paused`。
7. TASK-003 不支持同一本书并行多章，也不支持多书商业并行。

## 19. 与故事状态的数据边界

商业层可以保存：

- `bookId`
- `chapterNumber`
- `runId`
- 商业生产状态
- 人工审核决定
- 错误码和时间
- 发布资格派生所需的最小字段

商业层不得保存或覆盖：

- 人物、关系、世界规则和时间线事实
- `story/state/*.json`
- Markdown 故事投影
- 章节正文副本
- 故事 SQLite Schema
- Runner 的真相校验结果副本

章节正文、审查问题、长度 telemetry 和故事事实继续以 InkOS 现有产物为权威来源。

## 20. 与 TASK-004 成本账本的边界

TASK-003 只允许：

- 从 `ChapterPipelineResult` 透传 `tokenUsage`
- 保存可供后续关联的 `runId`、`bookId` 和 `chapterNumber`
- 定义未来事件接口

TASK-003 不允许：

- 模型价格表
- 费用换算
- Provider 调用明细账
- 重试 Token 精确归因
- 日、书、章节成本汇总
- 预算拦截

这些全部属于 TASK-004。

## 21. 错误模型

建议错误码：

```typescript
type VolumeProductionErrorCode =
  | "PRODUCTION_MODE_LOAD_FAILED"
  | "PRODUCTION_POLICY_INVALID"
  | "PRODUCTION_POLICY_NOT_IMPLEMENTED"
  | "PRODUCTION_ALREADY_RUNNING"
  | "PRODUCTION_STATE_INVALID"
  | "PRODUCTION_INVALID_TRANSITION"
  | "PRODUCTION_PIPELINE_FAILED"
  | "PRODUCTION_AUDIT_FAILED"
  | "PRODUCTION_LENGTH_OUT_OF_POLICY"
  | "PRODUCTION_STATE_DEGRADED"
  | "PRODUCTION_TIMEOUT"
  | "PRODUCTION_ABORTED"
  | "PRODUCTION_RETRY_EXHAUSTED"
  | "PRODUCTION_MANUAL_APPROVAL_REQUIRED"
  | "PRODUCTION_STATE_WRITE_FAILED";
```

错误对象至少包含：

- `code`
- `bookId`
- 可选 `chapterNumber`
- 可选 `runId`
- 可选 `cause`
- 面向调用者的稳定消息

不得依赖解析模型错误文本决定商业状态；底层错误先映射到稳定类别。

## 22. 测试设计

### 22.1 Policy Resolver 单元测试

1. 无策略文件时读取 TASK-002 默认 `volume`。
2. 持久化 `volume` 解析为走量策略。
3. `flagship` 按用户确认行为分派。
4. 损坏的 `book-strategy.json` 阻止运行。
5. 目标字数来自 `BookConfig.chapterWordCount`。
6. 自动修订上限来自 `writing.reviewRetries`。
7. 商业配置非法时不静默回退。

### 22.2 状态机单元测试

1. 无记录到 `running`。
2. `running` 到各允许终态。
3. 人工审核三种候选结果。
4. 非法转换被拒绝。
5. 两本书完全隔离。
6. 原子写失败不破坏旧状态。
7. stale `runId` 不得覆盖当前运行。

### 22.3 Orchestrator 单元测试

1. 每次运行恰好调用一次 `writeNextChapter`。
2. 强制自动审查配置。
3. 不调用独立 Planner、Writer、Auditor、Reviser。
4. `ready-for-review` 映射到正确商业状态。
5. `audit-failed`、`state-degraded`、异常、超时和中止分别停止。
6. 超出业务字数偏差时不可发布。
7. 达到自动修订上限后不重新调用整条管线。
8. `running` 状态拒绝第二次并发调用。
9. 未人工通过时 `releaseEligible = false`。
10. Token 用量仅透传，不计算成本。

### 22.4 集成和回归测试

- 使用临时项目和假 LLM，不使用真实小说数据。
- 复用真实 `BookStrategyStore`、`StateManager` 和商业状态文件。
- 验证章节、故事状态与商业状态目录边界。
- 验证原始 `PipelineRunner` 行为未改变。
- 运行精确测试、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- 如新增 CLI 入口，测试单章限制、模式读取和失败退出码。

## 23. 回滚方案

代码回滚：

- 删除 TASK-003 新增的 commercial 模块、导出和最小入口。
- 原始 `PipelineRunner`、Writer、Prompt 和模型配置无需回滚。

数据回滚：

- 停止使用商业入口。
- 备份后删除 `commercial/volume-production-policy.json` 和 `commercial/volume-production-state.json`。
- 保留 `commercial/book-strategy.json`，因为它属于已完成的 TASK-002。
- 不迁移、不回滚故事状态或故事 SQLite。

行为回滚：

- 原始 InkOS CLI 和 Runner 保持可用。
- 回滚不得把未人工审核章节自动标为发布。

## 24. 非目标

TASK-003 不实现：

- 模型路由
- 不同模型自动选择
- 模型价格表
- 完整 Token 和费用账本
- 市场选题
- 商业总编
- 多读者模拟
- 真实评论反馈
- 多书并行
- 自动发布
- 平台账号管理
- `flagship` 深度策略
- Studio 大规模界面改造
- 核心 Prompt 重写
- Scheduler 全面替换
- Writer、Planner、Auditor 或 Reviser 重构

## 25. 待用户确认的业务参数

以下参数全部未决定，功能实现前必须确认：

1. 走量模式每章目标字数，以及是否直接使用现有 `chapterWordCount`。
2. 允许字数偏差的数值和表示方式：绝对字数或百分比。
3. 最多自动修订次数，即 `writing.reviewRetries` 的目标值。
4. 是否每章都必须人工审核。
5. 人工审核结果是否采用 `approve`、`reject`、`request_revision`，是否还需要其他结果。
6. 审查只有 warning 时是否允许人工通过。
7. 哪些错误可以进行商业层自动重试。
8. 最大商业层自动重试次数；需注意 Provider 已内置最多 2 次瞬时重试。
9. 单次运行失败后暂停当前章，还是停止整本书的商业生产。
10. `flagship` 在 TASK-003 中保持原版行为，还是返回“策略尚未实现”。
11. 单章商业运行超时时间。
12. 商业策略文件不存在时，是拒绝运行并要求配置，还是采用经用户批准的默认值。

这些参数不得由实现者自行选择。

## 26. 与后续任务的接口

### TASK-004：成本账本

- 使用 `runId`、`bookId`、`chapterNumber` 和 `tokenUsage` 作为关联输入。
- TASK-003 不定义价格或费用。

### TASK-005：人工审核记录

- TASK-003 只保存最小审核决定和当前状态。
- 审核人、完整历史、批注、审计留痕和权限属于 TASK-005。

### 后续长度策略任务

- 若商业偏差需要直接驱动 Writer 和修订器，应增加自定义 `LengthSpec` 适配，不在 TASK-003 偷改 Prompt。

### 后续 `flagship` 策略任务

- 复用 `ProductionPolicyResolver` 的模式分派接口。
- 不在 TASK-003 提前实现深度策略。

### 后续 CLI / Studio / Scheduler 接入

- 统一调用 Volume Production Orchestrator。
- 原始 InkOS Runner 保持通用能力。
- 是否禁止原始入口绕过商业闸门，需要独立产品决策和验收。
