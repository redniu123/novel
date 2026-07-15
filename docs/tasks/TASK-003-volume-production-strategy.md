# TASK-003：走量小说生产策略

## 1. 基本信息

- 任务编号：TASK-003
- 任务名称：走量小说生产策略
- 当前状态：`pending_design_review`
- 设计分支：`docs/TASK-003-volume-strategy-design`
- 集成主线：`develop`
- 前置任务：TASK-002 `completed`，已合并 `develop`
- 模块设计：`docs/modules/volume-production-strategy.md`
- 下一步：Claude Code 审查 TASK-003 设计

本轮只完成真实代码分析和设计文档，不实现功能代码。设计审查通过且业务参数确认后，才能进入实现。

## 2. 背景

TASK-002 已提供按书隔离的 `productionMode`：

- `volume`
- `flagship`

当前 `BookStrategyStore` 可以安全读取和保存模式，旧书无策略文件时默认解析为 `volume`。但是该模式尚未接入 `PipelineRunner`、CLI、Studio 或 Scheduler，不会改变章节生产行为。

InkOS 已有单章规划、写作、自动审查、有限自动修订、状态校验、持久化、人工批准和状态修复能力。TASK-003 应通过商业策略层组合这些能力，使 `volume` 产生最小业务效果，而不是重写章节管线。

## 3. 目标

1. 真实读取 TASK-002 的 `productionMode`。
2. 为 `volume` 解析一组明确、可测试的生产策略。
3. 每次商业生产运行只生产一章。
4. 每章正文生成后执行现有自动审查。
5. 自动修订次数有明确上限。
6. 章节完成后根据用户确认规则进入人工审核闸门。
7. 未满足审核规则时不可获得发布资格。
8. 明确目标字数、允许偏差、失败、超时、重试和停止规则。
9. 将商业生产状态与故事权威状态分离。
10. 保持原始 InkOS Runner、Prompt 和模型路由不变。

## 4. 前置依赖

必须满足：

- TASK-002 状态为 `completed`。
- TASK-002 已合并到最新 `develop`。
- `BookStrategyStore.load(bookId)`、类型、Schema、默认行为和错误模型保持可用。
- `develop` 包含 TASK-002 实现和测试。
- `docs/modules/volume-production-strategy.md` 通过 Claude Code 设计审查。
- 第 18 节列出的业务参数已由用户确认。

当前已确认：

- TASK-002 完成分支：`feature/TASK-002-production-mode`
- TASK-002 合并后的 `develop` Commit：`30af928`
- TASK-003 设计分支直接基于 `origin/develop`
- TASK-002 无 Blocker、无 Major；保留一个非 InkOS 进程直接写策略文件没有 CAS 的 Minor

## 5. 用户场景

### 场景 1：默认走量书生产下一章

书籍没有 `book-strategy.json`。

预期：

- `BookStrategyStore.load` 返回默认 `volume`
- 解析走量策略
- 只调用一次完整单章管线
- 正文完成后自动审查
- 按策略进入人工闸门或完成状态
- 不自动开始下一章

### 场景 2：显式走量书

书籍策略文件为 `productionMode: "volume"`。

预期与默认走量书一致，不因 `source` 是 `default` 或 `file` 产生行为差异。

### 场景 3：自动审查不通过

预期：

- 自动修订最多执行用户确认的次数
- 达到上限后停止
- 不通过时不可获得发布资格
- 不启动下一章

### 场景 4：人工审核

预期：

- 只有合法的待审核状态可以提交人工决定
- 人工结果按用户确认的枚举处理
- 未通过人工闸门时 `releaseEligible = false`
- 不调用自动发布

### 场景 5：模型或结构化输出失败

预期：

- 只对用户确认的安全错误执行有限重试
- 审查 `parseFailed` 不视为成功
- 超时、上下文超限、重试耗尽后停止当前运行
- 不自动继续下一章

### 场景 6：同书并发请求

预期：

- 同一 `bookId` 同时只允许一个商业生产运行
- 第二个请求明确返回忙或已运行错误
- 不产生两个相同章节或两个下一章

### 场景 7：`flagship`

预期由用户确认：

- 保持原版 InkOS 行为；或
- 明确返回策略尚未实现

不得误用走量策略。

## 6. 允许修改范围

### 6.1 当前设计轮

只允许修改：

- `docs/modules/volume-production-strategy.md`
- `docs/tasks/TASK-003-volume-production-strategy.md`
- `docs/PROJECT-STATUS.md`
- `docs/tasks/TASK-INDEX.md`

### 6.2 设计批准后的实现轮

允许在重新确认实施计划后修改：

- `packages/core/src/commercial/` 下新增的策略、状态和薄编排模块
- `packages/core/src/index.ts` 的最小导出
- 对应单元测试和临时目录集成测试
- 经设计审查批准的最小 CLI 商业入口及测试
- 本任务和项目状态 Markdown

如实现需要修改以上范围之外的代码，必须停止并重新评审。

## 7. 禁止修改范围

不得：

- 将 `productionMode` 分支直接加入 Writer、Planner、Auditor 或 Reviser
- 重写 `PipelineRunner` 的章节阶段
- 重复实现章节规划、正文、审查、修订、真相校验、快照或落盘
- 修改核心 Prompt
- 新增或修改模型路由
- 自动选择不同模型
- 修改模型价格表
- 实现完整 Token 或费用账本
- 修改故事权威状态含义
- 修改 `story/state`
- 修改故事 SQLite Schema
- 实现自动发布
- 实现平台账号管理
- 实现多书并行
- 实现市场选题、商业总编、多读者模拟或真实评论反馈
- 实现 `flagship` 深度策略
- 进行 Studio 大规模界面改造
- 升级依赖或修改锁文件
- 修改许可证

## 8. 功能要求

### FR-001 模式读取

商业生产入口必须调用 `BookStrategyStore.load(bookId)`。不得直接读取 `commercial/book-strategy.json`。

### FR-002 策略解析

`ProductionPolicyResolver` 必须将 `volume` 解析为不可变 `VolumeProductionPolicy`，并明确每个字段来源。

### FR-003 单章边界

每次 Volume Production Orchestrator 调用最多调用一次 `PipelineRunner.writeNextChapter`，固定 `chaptersPerRun = 1`。

### FR-004 自动审查

走量入口必须使用 `chapterReviewMode: "auto"`。不得使用 `writeDraft` 代替完整管线。

### FR-005 自动修订上限

自动修订上限复用 `writing.reviewRetries`，具体值由用户确认；达到上限后不得从外层重启完整管线规避限制。

### FR-006 人工审核

按用户确认规则，将成功完成的章节置为独立商业待审核状态。只有合法状态转换可以批准、拒绝或请求修订。

### FR-007 发布资格

提供确定性的 `releaseEligible` 判断。TASK-003 不写 `published`，不调用发布平台。

### FR-008 字数策略

目标字数复用 `BookConfig.chapterWordCount`。用户确认的商业允许偏差通过非 LLM 后置检查执行，不修改 Prompt。

### FR-009 失败停止

模型失败、上下文超限、审查解析失败、状态降级、超时、取消或重试耗尽时停止当前运行，不自动进入下一章。

### FR-010 有限重试

保留 Provider 现有最多 2 次瞬时重试。商业层只对用户确认的安全错误执行有限重试，不盲目重试非幂等完整管线。

### FR-011 并发

同一 `bookId` 同时最多一个商业运行；不同书的数据和状态完全隔离。本任务不实现多书并行调度。

### FR-012 商业状态

商业状态按书保存在 `commercial/`，使用严格版本化 Schema、原子写入和受保护状态转换。

### FR-013 故事边界

商业状态不得复制或覆盖正文、故事事实、Markdown 投影、故事状态或 SQLite Schema。

### FR-014 `flagship`

必须显式处理，不得静默使用 `volume`。具体兼容行为由用户确认。

### FR-015 核心复用

薄编排器不得分别调用 Planner、Writer、Auditor 和 Reviser 重组现有 Runner。

### FR-016 Token 边界

可以透传现有 `tokenUsage`，但不得计算费用、保存价格或建立成本账本。

## 9. 验收标准

### AC-001 TASK-002 接口被真实使用

测试证明每次商业生产前调用 `BookStrategyStore.load(bookId)`，默认和显式 `volume` 均生效。

### AC-002 单章运行

一次商业运行恰好调用一次 `writeNextChapter`，没有多章循环。

### AC-003 自动审查

走量策略强制自动审查；结果包含真实审查状态。

### AC-004 修订有界

自动修订次数不超过用户确认的 `writing.reviewRetries`，达到上限后停止。

### AC-005 人工闸门

需要人工审核时，未批准章节的 `releaseEligible` 必须为 false；非法批准转换被拒绝。

### AC-006 警告处理

只有用户确认允许时，warning 才能进入可人工批准路径；critical、`parseFailed` 和 `state-degraded` 不得直接批准。

### AC-007 字数门槛

目标字数来自书籍配置，允许偏差按用户确认规则确定性计算；越界时不可发布且不启动下一章。

### AC-008 错误停止

模型失败、超时、上下文超限、结构化审查失败和状态降级分别产生稳定错误或停止原因。

### AC-009 禁止无限重试

自动修订、Provider 重试和商业层重试均有可断言上限。

### AC-010 并发隔离

同书并发请求只有一个进入 Runner；不同 `bookId` 的商业状态互不覆盖。

### AC-011 故事数据不受污染

商业状态变化不改写故事权威状态含义、不新增故事 SQLite 字段、不复制正文。

### AC-012 `flagship` 兼容

`flagship` 按用户确认行为执行，且不创建或应用走量策略状态。

### AC-013 原版 Runner 不变

现有 `PipelineRunner`、Prompt、模型路由和原始调用测试不发生行为回归。

### AC-014 TASK-004 边界

没有价格表、费用计算、预算拦截或完整 Token 账本。

### AC-015 回归通过

精确测试、`pnpm typecheck`、`pnpm test` 和 `pnpm build` 全部通过。

## 10. 自动测试

至少新增：

1. 默认 `volume` 策略解析
2. 显式 `volume` 策略解析
3. `flagship` 分派
4. 策略文件损坏阻止运行
5. 商业配置 Schema 校验
6. 目标字数来源
7. 自动修订上限来源
8. 每次只调用一次 Runner
9. 强制自动审查
10. `ready-for-review` 状态映射
11. `audit-failed` 状态映射
12. `state-degraded` 状态映射
13. 审查 `parseFailed`
14. 字数偏差内和偏差外
15. 人工批准、拒绝和请求修订
16. 非法状态转换
17. 未人工通过不可发布
18. warning 人工通过规则
19. 同书并发拒绝
20. 两书隔离
21. 超时和取消
22. 可重试错误和不可重试错误
23. 重试耗尽
24. 商业状态原子写失败
25. stale `runId` 不覆盖当前状态
26. Token 只透传不计费
27. 故事状态和 SQLite 不受影响
28. 原版 Runner 回归

实现阶段测试命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

还必须运行新增模块和最小入口的精确测试命令。

## 11. 人工验收

在隔离测试项目中完成：

1. 创建或选择一本无策略文件的书，确认解析为 `volume`。
2. 启动一次商业生产，确认只生成一章。
3. 确认章节执行自动审查，修订不超过配置上限。
4. 确认成功后进入正确商业审核状态。
5. 未批准前检查 `releaseEligible = false`。
6. 按用户确认结果执行人工审核，验证状态转换。
7. 模拟 warning、critical 和 `parseFailed`，验证批准规则。
8. 模拟模型失败、超时和 `state-degraded`，确认不会继续下一章。
9. 同时启动两个同书请求，确认只有一个进入 Runner。
10. 检查商业文件与故事状态、正文和 SQLite 的边界。
11. 检查 `flagship` 行为符合用户确认。
12. 检查没有模型路由、Prompt、价格表或发布行为变化。

不得使用用户真实小说正文进行破坏性验收。

## 12. 数据安全

- 所有商业数据由 `bookId` 隔离。
- 路径必须复用安全 `bookId` 和 `safeChildPath` 规则。
- 商业状态使用严格 Schema 和原子替换。
- 书级状态转换必须受锁保护。
- 不提交测试小说、数据库、日志、缓存、密钥、Cookie 或 `.env`。
- 不保存完整模型请求或响应到商业状态。
- 不把人工审核结果写成故事事实。
- 不对损坏配置静默重建或覆盖。

## 13. 回滚方案

- 回滚 TASK-003 新增的策略解析、商业状态、薄编排和最小入口。
- 保留 TASK-002 的 `BookStrategyStore` 和 `book-strategy.json`。
- 停止调用商业入口后，原版 InkOS Runner 继续按原行为工作。
- 备份后可删除 TASK-003 新增的商业策略和状态文件。
- 不迁移、不恢复或删除故事权威状态和故事 SQLite。
- 未通过 Claude Code 审查和人工验收不得合并 `develop`。

## 14. 非目标

本任务不实现：

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
- Scheduler 全面改造
- 大规模重构 InkOS 核心

## 15. 交付物

当前设计轮：

- `docs/modules/volume-production-strategy.md`
- `docs/tasks/TASK-003-volume-production-strategy.md`
- 更新后的 `docs/PROJECT-STATUS.md`
- 更新后的 `docs/tasks/TASK-INDEX.md`
- TASK-003 文档分支、提交和远程分支
- Claude Code 设计审查待办

设计批准后的实现轮：

- Production Policy Resolver
- Volume Production Orchestrator
- 独立商业生产状态
- 最小商业入口
- 自动测试和人工验收记录

## 16. 实际结果

> 实现阶段填写，当前留空。

- 修改文件：
- 实现接口：
- 测试结果：
- Commit：
- 远程分支：
- 审查结果：

## 17. 遗留问题

> 实现和审查阶段填写，当前留空。

- Blocker：
- Major：
- Minor：
- Suggestion：

## 18. 待用户确认的业务参数

1. 走量模式每章目标字数。
2. 允许字数偏差，以及使用绝对字数还是百分比。
3. 最多自动修订次数。
4. 是否每章都必须人工审核。
5. 人工审核可能有哪些结果。
6. 审查为 warning 时是否允许人工通过。
7. 哪些错误可以自动重试。
8. 最大自动重试次数。
9. 单次运行失败后暂停当前章还是停止整本书。
10. `flagship` 保持原版行为还是返回“策略尚未实现”。
11. 单章运行超时时间。
12. 商业策略文件缺失时拒绝运行还是使用经批准默认值。

## 19. 最终状态

`pending_design_review`

下一步：Claude Code 审查 TASK-003 设计。
