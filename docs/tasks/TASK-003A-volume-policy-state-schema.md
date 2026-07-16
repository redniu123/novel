# TASK-003A：走量策略与商业状态 Schema

## 1. 基本信息

- 任务编号：TASK-003A
- 任务名称：冻结走量策略并实现商业状态 v1 Schema/Store
- 当前状态：`pending_design_review`
- 总任务：TASK-003
- 前置依赖：TASK-002；TASK-003 设计复审通过
- 建议实现分支：`feature/TASK-003A-volume-policy-state`
- 模块设计：`docs/modules/volume-production-strategy.md`
- 源码事实复核：2026-07-16，公开结果字段和配置读取链已核对

## 2. 目标

1. 实现冻结的 `VolumeProductionPolicyV1`。
2. 默认和显式 `volume` 返回相同策略。
3. `flagship` 返回 `PRODUCTION_POLICY_NOT_IMPLEMENTED`。
4. 实现 `VolumeProductionStateV1` 严格 Schema。
5. 按章节保存追加式 runs 和 reviews 历史。
6. 实现原子、安全、按书隔离的 State Store。
7. 实现 `ChapterPipelineResult` 公开字段归一化和 Pipeline 结果映射纯函数。
8. 实现 `isReleaseEligible` 纯函数和 `releaseEligible(bookId, chapterNumber)` Store API。
9. 不调用 Runner、LLM 或现有 review 命令。

## 3. 冻结策略

- 目标：`BookConfig.chapterWordCount`
- 偏差：现有 `LengthSpec` 软区间
- 修订：`writing.reviewRetries`，默认 1
- 人工审核：每章必需
- 人工结果：approve、reject、request_revision
- Warning：硬门槛通过时可人工批准
- 商业完整管线重试：0
- 失败动作：暂停书
- `flagship`：商业入口未实现
- 超时：60 分钟
- 新策略文件：不新增

## 4. 允许修改范围

- `packages/core/src/commercial/volume-production-policy.ts`
- `packages/core/src/commercial/volume-production-state.ts`
- `packages/core/src/index.ts` 最小导出
- 对应单元测试和临时目录集成测试
- 本任务和项目状态 Markdown

## 5. 禁止修改范围

- Pipeline Runner 和 Agent
- Prompt、Provider、模型路由
- CLI、Studio、Scheduler
- 现有 review 命令
- `ChapterMeta.status`
- 故事状态和 SQLite Schema
- 依赖和锁文件

## 6. 功能要求

### FR-A01 Policy Resolver

生产默认 Resolver 必须调用 `BookStrategyStore.load`、`StateManager.loadBookConfig` 和 `loadProjectConfig(projectRoot, { requireApiKey: false })`，再调用 `buildLengthSpec` 解析冻结策略；允许注入 loader 测试，但不得直接读取新的商业策略文件。

### FR-A02 State v1

状态文件位于：

```text
books/<bookId>/commercial/volume-production-state.json
```

必须符合模块设计第 12 节的完整 v1 类型。

### FR-A03 基数

- 每章最多一个 Chapter Record。
- 每章 runs 至少一个并追加保存。
- reviews 追加保存。
- 全书最多一个 activeRun。
- key、chapterNumber 和 runId 必须一致。

### FR-A04 原子写入

复用安全 bookId、safe child path、书级锁和原子替换。损坏文件不得被默认值覆盖。

### FR-A05 状态转换

只允许模块设计声明的转换，非法转换明确报错。

### FR-A06 映射

实现 `summarizeChapterPipelineResult(result, policy)` 纯函数：章节号、status、最终字数直接读取 `result`；`parseFailed` 用 `=== true` 归一化；warning/critical/warningOnly 从最终 `result.auditResult.issues` 派生。不得重新审查、读取内部 review cycle 返回或解析 `ChapterMeta.auditIssues` 字符串。

### FR-A07 发布资格

实现模块设计第 14.3 节的完整真值规则，不读取 `ChapterMeta.status`。

### FR-A08 数据边界

状态文件不得包含正文、故事事实、tokenUsage、模型输出或费用。

## 7. 验收标准

1. 默认 `volume` 返回冻结策略。
2. 显式 `volume` 返回同一策略。
3. `flagship` 明确失败。
4. Resolver 真实复用 BookStrategyStore、现有 book/project config loader 和 buildLengthSpec。
5. 策略解析不要求模型凭证且不新增商业策略文件。
6. v1 Schema 拒绝未知字段和非法基数。
7. 两本书状态隔离。
8. 原子写失败保留旧文件。
9. stale runId 不能覆盖 activeRun。
10. 直接字段与派生审查计数全部可自动断言。
11. 可选 parseFailed 缺失归一化为 false，info 可与 warning-only 共存。
12. `releaseEligible` 真值表全部覆盖。
13. 状态文件不含 tokenUsage、正文或故事数据。
14. 原版 TASK-002 测试继续通过。

## 8. 自动测试

至少覆盖：

1. 默认/显式 volume
2. flagship
3. 三个现有 loader 与 buildLengthSpec 的 Resolver 组合
4. 目标和修订配置解析
5. 3000 目标解析为 2591-3409 软区间
6. 固定超时、重试、人工审核和失败动作
7. 状态文件不存在
8. 合法 v1 读写
9. JSON 损坏
10. Schema 非法
11. bookId 不匹配
12. 两书隔离
13. 原子失败
14. 非法状态转换
15. activeRun 冲突
16. run/review 追加历史
17. ChapterPipelineResult 直接字段适配
18. warning/critical/warningOnly 派生与可选 parseFailed
19. Pipeline 映射表
20. releaseEligible 真值表
21. 数据边界

## 9. 数据安全与回滚

- 测试使用临时目录。
- 不使用真实小说。
- 不修改故事数据。
- 回滚代码后备份并删除 `volume-production-state.json`。
- 保留 TASK-002 `book-strategy.json`。

## 10. 非目标

- 调用 Runner
- 生成章节
- 人工审核 API
- 超时执行
- CLI、Studio 或 Scheduler
- 成本账本
- 自动发布

## 11. 实际结果

> 实现后填写。

- 修改文件：
- 测试：
- Commit：
- 审查：

## 12. 遗留问题

> 实现和审查后填写。

- Blocker：
- Major：
- Minor：
- Suggestion：

## 13. 最终状态

`pending_design_review`
