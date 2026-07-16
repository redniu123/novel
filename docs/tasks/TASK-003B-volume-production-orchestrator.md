# TASK-003B：走量单章薄编排器

## 1. 基本信息

- 任务编号：TASK-003B
- 任务名称：走量单章薄编排器与商业人工审核 API
- 当前状态：`pending`
- 总任务：TASK-003
- 前置依赖：TASK-003A `completed`
- 建议实现分支：`feature/TASK-003B-volume-orchestrator`
- 模块设计：`docs/modules/volume-production-strategy.md`

## 2. 目标

1. 实现 Volume Production Orchestrator。
2. 每次商业运行恰好调用一次 `writeNextChapter`。
3. 固定自动审查，复用现有自动修订上限。
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

运行前记录 expected chapter，再次检查无变化后才调用 Runner。返回后 actual 必须等于 expected。

### FR-B04 Runner

使用自动审查配置，每次恰好调用一次 `writeNextChapter`。不得调用独立 Agent 重组管线。

### FR-B05 重试

商业完整管线最大重试固定为 0。底层 Provider 内置重试保持原样。

### FR-B06 超时

使用 `runWithAbortSignal` 和 3,600,000 ms 超时。超时后暂停，不再次调用 Runner。

### FR-B07 结果映射

使用 TASK-003A 映射纯函数处理 ready、warning-only、critical、parseFailed、字数越界、state-degraded 和异常。

### FR-B08 商业审核

`reviewChapter` 只写 commercial 状态，支持 approve、reject、request_revision。

### FR-B09 发布资格

调用 TASK-003A `releaseEligible`，不读取或修改 `ChapterMeta.status`。

### FR-B10 Token

tokenUsage 只在返回结果中透传，不写商业状态。

## 6. 运行约束

- 商业生产期间关闭 daemon。
- 不同时运行 `write next --count` 或 `auto`。
- 原始单章入口也不得与商业入口并行。
- 本任务只保证商业入口自身互斥。

## 7. 验收标准

1. 默认和显式 volume 均可进入薄编排器。
2. flagship 在 Runner 前失败。
3. 每次最多调用一次 Runner。
4. 完整管线异常调用次数仍为 1。
5. 运行前章节号变化时调用次数为 0。
6. 返回章节号不匹配时暂停。
7. 60 分钟超时后暂停且不重试。
8. 同书两个商业请求只有一个调用 Runner。
9. ready 和 warning-only 映射待人工审核。
10. critical、parseFailed、字数越界和 state-degraded 映射暂停。
11. 三种人工决定只写 commercial 状态。
12. 未 approve 时 releaseEligible 为 false。
13. 不调用现有 review 命令。
14. 原版 Runner、CLI 和 Scheduler 行为不变。

## 8. 自动测试

至少覆盖：

1. volume/flagship 分派
2. 单次 Runner 调用
3. 零商业重试
4. 前置章节号变化
5. 后置章节号不匹配
6. 60 分钟 fake timer 超时
7. 用户 AbortSignal
8. 同书商业并发
9. 两书隔离
10. ready 映射
11. warning-only 映射
12. critical 映射
13. parseFailed 映射
14. 字数越界映射
15. state-degraded 映射
16. 三种人工决定
17. 非法审核转换
18. tokenUsage 只透传
19. ChapterMeta 和故事状态不受影响

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

> 实现后填写。

- 修改文件：
- 测试：
- Commit：
- 审查：

## 13. 遗留问题

> 实现和审查后填写。

- Blocker：
- Major：
- Minor：
- Suggestion：

## 14. 最终状态

`pending`
