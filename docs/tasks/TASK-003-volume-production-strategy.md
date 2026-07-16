# TASK-003：走量小说生产策略

## 1. 基本信息

- 任务编号：TASK-003
- 任务名称：走量小说生产策略总任务
- 当前状态：`pending_design_review`
- 设计分支：`docs/TASK-003-volume-strategy-design`
- 集成主线：`develop`
- 前置任务：TASK-002 `completed`
- 子任务：TASK-003A、TASK-003B
- 模块设计：`docs/modules/volume-production-strategy.md`
- 首轮设计审查：`rejected`
- 审查修订日期：2026-07-16
- 下一步：Claude Code 重新审查 TASK-003 设计

本任务是 TASK-003A 和 TASK-003B 的总任务，不在一个实现轮同时交付全部代码。

## 2. 背景

TASK-002 已提供按书隔离的 `productionMode`，但模式尚未接入章节生产。首轮 TASK-003 设计因业务参数未冻结、商业状态 Schema 不完整、范围过大和外层重试风险被拒绝。

2026-07-16 用户确认全部推荐参数，并批准拆分：

- TASK-003A：参数、Policy Schema、商业状态 v1 Schema 和 Store。
- TASK-003B：薄编排器、单章商业入口和商业人工审核 API。

## 3. 总目标

让 `productionMode = "volume"` 在独立商业入口中产生以下效果：

1. 每次只生产一章。
2. 使用现有自动审查。
3. 自动修订读取 `writing.reviewRetries`，默认 1。
4. 每章必须人工审核。
5. 未通过商业人工审核不得获得发布资格。
6. 目标字数读取 `BookConfig.chapterWordCount`。
7. 商业字数门槛使用现有 `LengthSpec` 软区间。
8. 商业完整管线自动重试固定为 0。
9. 单章超时固定为 60 分钟。
10. 失败后暂停该书商业生产。
11. `flagship` 商业入口返回策略未实现。
12. 不修改 InkOS 核心章节管线。

## 4. 前置依赖

- TASK-002 已完成、审查并合并 `develop`。
- `BookStrategyStore.load(bookId)` 保持可用。
- 本模块设计通过 Claude Code 复审。
- TASK-003A 必须先于 TASK-003B 完成。
- TASK-003A、TASK-003B 分别使用独立实现分支、测试和审查。

## 5. 冻结业务决策

1. 目标字数来源：`BookConfig.chapterWordCount`。
2. 允许偏差：现有 `LengthSpec` 软区间。
3. 自动修订：`writing.reviewRetries`，默认 1。
4. 每章人工审核：是。
5. 人工结果：`approve`、`reject`、`request_revision`。
6. Warning：硬门槛全部通过时允许人工批准。
7. 商业完整管线可重试错误：无。
8. 商业完整管线最大重试：0。
9. 失败动作：暂停该书商业生产。
10. `flagship`：商业入口返回 `PRODUCTION_POLICY_NOT_IMPLEMENTED`。
11. 单章超时：60 分钟。
12. 商业策略存储：不新增策略文件，使用版本化常量和已有配置。

任何子任务不得自行改变这些值。

## 6. 子任务拆分

### 6.1 TASK-003A

交付：

- `VolumeProductionPolicyV1`
- `VolumeProductionStateV1`
- 按章、追加历史的商业状态 Store
- Pipeline 结果映射纯函数
- `isReleaseEligible` 纯函数和 `releaseEligible(bookId, chapterNumber)` API
- 状态转换和数据隔离测试

TASK-003A 不调用 Runner 或 LLM。

### 6.2 TASK-003B

交付：

- Thin Volume Production Orchestrator
- 每次恰好一次 `writeNextChapter`
- 运行前后章节号检查
- 60 分钟超时
- 商业人工审核 API
- 同书商业入口互斥
- 编排和回归测试

TASK-003B 不新增 CLI、Studio 或 Scheduler 改造。

## 7. 允许修改范围

当前设计轮只允许 Markdown。

TASK-003A 设计批准后允许：

- `packages/core/src/commercial/volume-production-policy.ts`
- `packages/core/src/commercial/volume-production-state.ts`
- `packages/core/src/index.ts` 最小导出
- 对应测试
- 状态文档

TASK-003B 设计批准且 TASK-003A 完成后允许：

- `packages/core/src/commercial/volume-production-orchestrator.ts`
- `packages/core/src/commercial/volume-production-review.ts`
- `packages/core/src/index.ts` 最小导出
- 对应测试
- 状态文档

## 8. 禁止修改范围

不得：

- 修改 Runner 内部章节阶段
- 重组 Planner、Writer、Auditor、Reviser
- 修改 Prompt、Provider 或模型路由
- 修改现有 `review approve/reject`
- 修改 `ChapterMeta.status`
- 修改故事权威状态或 SQLite Schema
- 新增商业完整管线自动重试
- 新增 CLI、Studio、daemon 或 Scheduler 接入
- 实现自动发布
- 实现 Token 和成本账本
- 实现 `flagship` 深度策略
- 修改依赖、锁文件或许可证

## 9. 总体功能要求

### FR-001 模式

必须调用 `BookStrategyStore.load(bookId)`。默认和显式 `volume` 使用同一冻结策略；`flagship` 明确拒绝商业入口。

### FR-002 单章

TASK-003B 每次商业运行恰好调用一次 `writeNextChapter`。

### FR-003 自动审查和修订

固定自动审查；自动修订只由现有 `writing.reviewRetries` 控制。

### FR-004 商业状态

按章节保存运行和人工决定的追加历史，不覆盖旧 run 或 review。

### FR-005 发布资格

`releaseEligible(bookId, chapterNumber)` 必须按模块设计的确定性真值规则计算。

### FR-006 人工审核

商业审核只写 `commercial/volume-production-state.json`，不调用现有 review 命令。

### FR-007 失败

外层完整管线不重试；失败、超时、审查解析失败、critical、字数越界或状态降级均暂停该书。

### FR-008 并发

只承诺同书商业入口互斥。商业生产期间通过运行规则关闭 daemon 和原始批量入口。

### FR-009 数据边界

商业状态不保存正文、故事事实、`ChapterMeta.status`、`tokenUsage` 或费用。

## 10. 总体验收标准

1. TASK-003A 和 TASK-003B 分别完成审查和验收。
2. 默认 `volume` 和显式 `volume` 行为一致。
3. `flagship` 商业入口稳定返回未实现。
4. 每次商业运行最多一章，Runner 最多调用一次。
5. 商业完整管线重试次数为 0。
6. 每章必须商业人工审核。
7. Warning 只有在硬门槛通过时可人工批准。
8. 未批准章节 `releaseEligible = false`。
9. 商业状态按章保存 run 和 review 历史。
10. 现有 InkOS review 命令、Runner、Prompt 和模型路由不变。
11. 商业状态与故事状态完全分离。
12. 精确测试、typecheck、全量测试和 build 通过。

## 11. 自动测试

详细测试分别记录在 TASK-003A 和 TASK-003B 任务单。

总任务至少要求：

- Policy 冻结值测试
- State v1 Schema 和基数测试
- Pipeline 映射表测试
- `releaseEligible` 真值表测试
- 单次 Runner 调用测试
- 零商业重试测试
- 超时和暂停测试
- 商业审核边界测试
- 两书隔离测试
- 原版 Runner 回归测试

## 12. 人工验收

完成 TASK-003B 后，在隔离测试项目中验证：

1. 默认 `volume` 只生成一章。
2. 自动审查和有限修订生效。
3. 成功或 warning-only 章节进入商业待审核。
4. critical、parseFailed、字数越界和 state-degraded 均暂停。
5. 未人工批准前不可发布。
6. 三种人工决定只改变 commercial 状态。
7. `flagship` 商业入口明确拒绝。
8. 超时后不自动重跑。
9. 同书两个商业请求只有一个调用 Runner。
10. 原始故事状态和章节状态未被商业审核改写。

## 13. 数据安全

- 所有商业数据由 `bookId` 隔离。
- 状态文件使用严格 v1 Schema 和原子替换。
- 状态转换受书级锁和 `runId` 校验保护。
- 不提交小说正文、数据库、日志、Secrets、Cookie 或 `.env`。
- 损坏状态不得静默覆盖。
- `tokenUsage` 只在结果中透传。

## 14. 回滚方案

- TASK-003A 和 TASK-003B 可以分别回滚。
- 回滚 TASK-003B 不影响 TASK-003A 状态读取。
- 回滚 TASK-003A 前先停用 TASK-003B。
- 保留 TASK-002 的 `book-strategy.json`。
- 商业状态文件备份后可删除。
- 不回滚或迁移故事权威状态。

## 15. 非目标

- 模型路由和自动模型选择
- 模型价格、Token 和费用账本
- 外层自动重试和幂等重放
- daemon、CLI、Studio、Scheduler 全局入口治理
- 自动恢复和自动执行修订请求
- 自动发布和平台账号管理
- 多书并行
- 市场选题、商业总编、读者模拟和真实评论
- `flagship` 深度策略
- 核心 Prompt 重写

## 16. 交付物

当前设计轮：

- 修订后的模块设计
- 修订后的 TASK-003 总任务
- TASK-003A 任务单
- TASK-003B 任务单
- 项目状态和任务索引
- 设计修订提交和远程分支

实现轮交付物由子任务单分别约束。

## 17. 实际结果

> TASK-003A 和 TASK-003B 完成后填写。

- TASK-003A Commit：
- TASK-003A 测试：
- TASK-003B Commit：
- TASK-003B 测试：
- 总体验收：

## 18. 遗留问题

> 实现和复审阶段填写。

- Blocker：
- Major：
- Minor：
- Suggestion：

## 19. 最终状态

`pending_design_review`

下一步：Claude Code 重新审查 TASK-003 设计。
