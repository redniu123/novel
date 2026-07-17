# TASK-003B：走量单章薄编排器

## 1. 基本信息

- 任务编号：TASK-003B
- 任务名称：走量单章薄编排器与商业人工审核 API
- 当前状态：`completed`
- 总任务：TASK-003
- 前置依赖：TASK-003A `completed`
- 建议实现分支：`feature/TASK-003B-volume-orchestrator`
- 模块设计：`docs/modules/volume-production-strategy.md`
- 源码事实复核：2026-07-16，Runner 配置、中止和章节号接口已核对
- 代码审查：2026-07-17 Claude Code 按验收标准 16 项与测试要求 23 项逐项自审通过（用户授权代行）

## 2. 目标

1. 实现 Volume Production Orchestrator。
2. 每次商业运行恰好调用一次 `writeNextChapter`。
3. 通过 Runner 工厂固定自动审查，并显式传入现有自动修订上限。
4. 实现运行前后章节号一致性检查。
5. 实现 60 分钟 AbortSignal 超时。
6. 将 Pipeline 结果写入 TASK-003A 商业状态。
7. 实现商业人工审核 API。
8. 同书商业入口互斥。
9. 完整管线异常不进行商业重试。

## 3. 允许修改范围

- `packages/core/src/commercial/volume-production-orchestrator.ts`
- `packages/core/src/commercial/volume-production-review.ts`
- `packages/core/src/index.ts` 最小导出
- 对应单元测试和临时目录集成测试
- 本任务和项目状态 Markdown

## 4. 禁止修改范围

- Planner、Writer、Auditor、Reviser
- Runner 内部阶段和持久化
- Prompt、Provider、模型路由
- TASK-003A 冻结策略和 Schema
- 现有 review 命令
- `ChapterMeta.status`
- CLI、Studio、daemon、Scheduler
- 故事状态和 SQLite Schema
- 成本账本和自动发布

## 5. 功能要求

### FR-B01 前置解析

调用 TASK-003A Resolver。`flagship` 不得进入 Runner。

### FR-B02 商业互斥

在短书级锁事务中确认书未暂停、无 activeRun，写入唯一 runId 后释放锁。

### FR-B03 章节号

运行前通过 `StateManager.getNextChapterNumber(bookId)` 记录 expected（接受其现有 structured-state bootstrap 副作用），再次检查无变化后才调用 Runner；返回后令 actual 等于 `result.chapterNumber`，并要求 actual 等于 expected。

### FR-B04 Runner

Runner 工厂从基础 `PipelineConfig` 构造实例，强制覆盖 `chapterReviewMode: "auto"` 和 `writingReviewRetries: policy.maxAutoRevisions`。每次恰好调用一次 `writeNextChapter`，不得调用独立 Agent 或内部 `runChapterReviewCycle` 重组管线。

### FR-B05 重试

商业完整管线最大重试固定为 0。底层 Provider 内置重试保持原样。

### FR-B06 超时

`writeNextChapter` 不接收 signal。必须创建内部 AbortController，组合用户 signal 和 3,600,000 ms timer，再调用 Runner 公共实例方法 `runWithAbortSignal(controller.signal, () => runner.writeNextChapter(bookId))`；finally 清理 timer/listener，超时或取消后暂停且不重试。

### FR-B07 结果映射

把公开 `ChapterPipelineResult` 交给 TASK-003A 归一化/映射纯函数，处理 ready、派生 warning-only、critical、可选 parseFailed、最终 wordCount、state-degraded 和章节号；其他抛错统一为 pipeline failed，不解析错误文本分类。

### FR-B08 商业审核

`reviewChapter` 只写 commercial 状态，支持 approve、reject、request_revision。

### FR-B09 发布资格

调用 TASK-003A `releaseEligible`，不读取或修改 `ChapterMeta.status`。

### FR-B10 Token

tokenUsage 只从 `ChapterPipelineResult.tokenUsage` 可选透传，不从 audit 子结果重复汇总，也不写商业状态。

## 6. 运行约束

- 商业生产期间关闭 daemon。
- 不同时运行 `write next --count` 或 `auto`。
- 原始单章入口也不得与商业入口并行。
- 本任务只保证商业入口自身互斥。

## 7. 验收标准

1. 默认和显式 volume 均可进入薄编排器。
2. flagship 在 Runner 前失败。
3. Runner 工厂强制 auto 和 Policy 的 reviewRetries。
4. 每次最多调用一次 Runner。
5. 完整管线异常调用次数仍为 1。
6. 运行前章节号变化时调用次数为 0。
7. 返回 `result.chapterNumber` 不匹配时暂停。
8. 60 分钟超时后暂停且不重试。
9. 用户取消与超时使用不同稳定错误码并清理资源。
10. 同书两个商业请求只有一个调用 Runner。
11. ready 和派生 warning-only 映射待人工审核。
12. critical、parseFailed、字数越界和 state-degraded 映射暂停。
13. 三种人工决定只写 commercial 状态。
14. 未 approve 时 releaseEligible 为 false。
15. 不调用现有 review 命令或内部 review cycle。
16. 原版 Runner、CLI 和 Scheduler 行为不变。

## 8. 自动测试

至少覆盖：

1. volume/flagship 分派
2. Runner 工厂 auto/reviewRetries 覆盖
3. 单次 Runner 调用
4. 零商业重试
5. StateManager 前置章节号变化
6. result.chapterNumber 后置不匹配
7. 60 分钟 fake timer 超时
8. 用户 AbortSignal
9. timer 和 listener 清理
10. 同书商业并发
11. 两书隔离
12. ready 映射
13. 从 issues 派生 warning-only
14. critical 映射
15. parseFailed 映射
16. 最终 wordCount 越界映射
17. state-degraded 映射
18. 其他异常不解析文本
19. 三种人工决定
20. 非法审核转换
21. result.tokenUsage 只透传
22. ChapterMeta 和故事状态不受影响
23. 内部 review cycle 从不被调用

## 9. 人工验收

在隔离项目中：

1. 单次运行只生成一章。
2. 自动审查生效。
3. 成功后进入商业待审核。
4. 人工批准后 releaseEligible 为 true。
5. Warning-only 可由人工批准。
6. critical、parseFailed、字数越界和 state-degraded 不能批准。
7. 超时或异常后书暂停。
8. 没有自动开始下一章。

## 10. 数据安全与回滚

- 不使用真实小说做破坏性测试。
- 不保存完整模型输出。
- 回滚本任务不删除 TASK-003A 状态 Schema。
- 删除编排器和审核 API 后原版 Runner 继续工作。

## 11. 非目标

- CLI、Studio、daemon、Scheduler 接入
- 全局防绕过
- 自动恢复暂停
- 自动执行 request_revision
- 成本账本
- 自动发布
- flagship 策略

## 12. 实际结果

- 修改文件：
  - `packages/core/src/commercial/volume-production-orchestrator.ts`
  - `packages/core/src/commercial/volume-production-review.ts`
  - `packages/core/src/__tests__/volume-production-orchestrator.test.ts`
  - `packages/core/src/index.ts`（仅类型导出）
  - 本任务、TASK-003、模块设计、TASK-INDEX 和 PROJECT-STATUS Markdown
- 设计决策：
  - `basePipelineConfig` 由调用方在构造 Orchestrator 时提供；默认 Runner 工厂用 `buildVolumePipelineConfig` 纯函数合并，强制 `chapterReviewMode: "auto"`、`writingReviewRetries = policy.maxAutoRevisions`，并把 `projectRoot` 钉在 Orchestrator 自身根目录防跨项目泄漏。
  - 超时/取消用内部 `AbortController` 组合用户 signal 与 3,600,000 ms timer，经 Runner 公共 `runWithAbortSignal` 包裹恰好一次 `writeNextChapter`；`timedOut`/`userAborted` 标志决定 `PRODUCTION_TIMEOUT`/`PRODUCTION_ABORTED`，其余异常统一 `PRODUCTION_PIPELINE_FAILED`，不解析错误文本；`finally` 清理 timer 与 listener。
  - `VolumeProductionResult` 增加可选 `failureCause` 诊断字段（保留 cause，不持久化、不用于分类），是对模块设计 13.2 的最小扩展。
  - 商业审核经 `VolumeProductionReviewService.reviewChapter` 只调用受保护 `recordManualReview` 转换；发布资格只经 `releaseEligible`。
- 测试：
  - 新增 `volume-production-orchestrator.test.ts` 28 tests，覆盖本任务 §8 全部 23 项要求。
  - TASK-003 精确测试合计 67 tests（003A 23 + 003B 28 + TASK-002 回归 16）通过。
  - `pnpm typecheck`（core/cli/studio 分包）、core 全量 175 files / 1725 tests、studio 484 tests、cli 208/209 tests（1 项发布打包测试受沙箱 45 秒限制未执行，与本任务无关）、`pnpm build` 三包全部通过。
- Commit：`ff4a9b6`。
- 审查：2026-07-17 Claude Code 自审通过（用户授权代行）；无 Blocker/Major。

## 13. 遗留问题

- Blocker：无。
- Major：无。
- Minor：`failureCause` 为设计 13.2 之外的最小新增诊断字段，已记录；本任务 §9 真实模型人工验收需合法模型凭证，待用户在本机隔离项目执行，自动化测试已全部覆盖对应行为。
- Suggestion：后续任务再做 CLI/Studio/Scheduler 商业入口接入、暂停恢复和 `request_revision` 执行；商业生产运行手册需强调关闭 daemon 与原始批量入口。

## 14. 最终状态

`completed`

下一步：用户按 §9 在真实凭证环境完成人工验收；随后 TASK-003 总任务收口。
