# TASK-002：建立小说生产模式配置基础

## 1. 基本信息

- 任务编号：TASK-002
- 任务名称：建立 `production_mode` 配置、存储、读取与校验基础
- 当前状态：`completed`
- 前置依赖：
  - TASK-001：原版 InkOS 基线验证完成
  - TASK-001A：项目治理完成
  - TASK-001B：真实模型最小冒烟验证必须为 `completed`
  - `docs/modules/production-mode.md` 已完成评审
- 建议分支：`feature/TASK-002-production-mode`

## 2. 背景

后续系统需要针对不同小说采用不同生产策略，因此必须先建立稳定的“小说生产模式”身份：

- `volume`：走量小说模式
- `flagship`：头牌小说模式

TASK-002 只负责建立类型、Schema、独立存储、读取、更新、错误处理和数据隔离基础。

本任务完成后，系统只知道一本书属于哪种模式，**不会立即改变模型、Prompt、章节字数、审查、修订或成本策略**。

## 3. 目标

1. 定义 `ProductionMode = "volume" | "flagship"`。
2. 定义版本化 `BookStrategy`。
3. 为每本书提供独立商业策略存储。
4. 商业策略文件不存在时，读取结果默认为 `volume`。
5. 支持单本书保存为 `flagship`，重新读取结果一致。
6. 非法模式、损坏文件、版本不支持、`bookId` 不一致时明确报错。
7. 不同 `book_id` 数据完全隔离。
8. 不写入 InkOS 故事权威状态、Markdown 投影或故事 SQLite。
9. 不改变任何模型或章节生产行为。
10. 为 TASK-003“走量生产策略绑定”提供稳定接口。

## 4. 用户场景

### 场景 1：旧书没有商业策略文件

预期：

- 返回 `volume`
- 读取时不强制创建文件
- 原有 InkOS 功能不受影响

### 场景 2：设置头牌模式

预期：

- 当前书保存为 `flagship`
- 重启或重新读取后仍为 `flagship`
- 其他书不受影响

### 场景 3：非法值

例如 `productionMode = "premium"`。

预期：

- 明确报错
- 不偷偷回退 `volume`
- 不覆盖原文件
- 不影响故事状态

### 场景 4：文件损坏

预期：

- 明确报错
- 不自动重建
- 原文件保持不变
- 不写入默认策略

### 场景 5：`bookId` 不一致

预期：

- 拒绝读取和更新
- 返回数据隔离错误
- 不自动纠正

## 5. 允许修改范围

允许修改：

- 新增的商业策略类型、Schema、存储模块
- 与该模块直接相关的导出文件
- 对应单元测试和必要集成测试
- `docs/modules/production-mode.md`
- 本任务文档
- `docs/PROJECT-STATUS.md`
- `docs/tasks/TASK-INDEX.md`
- 如现有架构需要，最小范围扩展公共接口，但须先在实施计划中说明

## 6. 禁止修改范围

不得：

- 修改 Writer、Planner、Architect、Composer、Auditor、Reviser 业务逻辑
- 修改系统 Prompt 或章节 Prompt
- 修改模型路由
- 根据模式改变章节字数、审查门槛、修订次数
- 实现 Token 预算或成本统计
- 修改 `story/state`
- 修改 Markdown 故事投影
- 修改 `memory.db` 或故事 SQLite Schema
- 修改 Studio 界面
- 修改许可证
- 升级依赖或修改 `pnpm-lock.yaml`
- 引入市场选题、商业总编、读者模拟、自动发布、多本调度
- 大规模重构 InkOS 核心

## 7. 推荐数据结构

```typescript
export type ProductionMode = "volume" | "flagship";

export interface BookStrategy {
  schemaVersion: 1;
  bookId: string;
  productionMode: ProductionMode;
  updatedAt: string;
}
```

最终命名、Schema 工具和导出方式以仓库现有规范为准。

## 8. 推荐存储位置

当前倾向：

```text
<book-project-root>/commercial/book-strategy.json
```

如果真实项目结构为 `books/<book_id>`，则等价为：

```text
books/<book_id>/commercial/book-strategy.json
```

要求：

- 商业数据与故事状态分离
- 每本书独立目录
- 不写故事 SQLite
- 不写全局共享文件
- 防止路径穿越
- 采用原子写入
- 运行数据不提交 Git

## 9. 实施步骤

1. 从最新、干净的 `develop` 创建功能分支。
2. 阅读 `AGENTS.md`、项目状态、任务索引和模块设计。
3. 定位真实书籍根目录、`book_id`、配置工具、Schema、原子写入和错误规范。
4. 比较设计方案并输出实施计划。
5. 明确预计修改文件和测试方案。
6. 方案确认后实现类型、Schema、默认读取、保存、更新、错误处理和隔离。
7. 编写测试。
8. 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。
9. 更新文档。
10. 提交并推送功能分支。
11. 状态设置为 `implemented_pending_review`，等待 Claude Code 审查。

## 10. 验收标准

### AC-001 默认模式

无文件时返回 `volume`，且不创建文件。

### AC-002 保存读取 `volume`

保存后重新读取一致。

### AC-003 保存读取 `flagship`

保存后重新读取一致。

### AC-004 非法值

明确报错，不降级、不覆盖。

### AC-005 文件损坏

明确报错，原文件不变。

### AC-006 `bookId` 校验

策略文件中的 `bookId` 与当前书籍不一致时拒绝操作。

### AC-007 书籍隔离

两个 `book_id` 可拥有不同模式，互不影响。

### AC-008 旧书兼容

没有商业目录和策略文件时，原版 InkOS 仍正常运行。

### AC-009 故事数据不受影响

操作前后：

- `story/state` 不变
- Markdown 故事投影不变
- 故事 SQLite 无相关写入

### AC-010 原子写入

写入失败时不得破坏已有合法文件，不留下半写入目标文件。

### AC-011 路径安全

非法标识和路径穿越输入必须被拒绝或安全处理。

### AC-012 回归通过

现有构建、类型检查和测试全部通过。

## 11. 必须新增的测试

至少覆盖：

1. 无文件默认 `volume`
2. 默认读取不创建文件
3. 保存读取 `volume`
4. 保存读取 `flagship`
5. 非法枚举值
6. 损坏 JSON
7. 缺失必要字段
8. 不支持的 `schemaVersion`
9. `bookId` 不一致
10. 两书隔离
11. `updatedAt` 格式和更新
12. 原子写入失败不破坏旧文件
13. 不修改故事状态
14. 不写故事 SQLite
15. 旧书兼容
16. 路径穿越或非法标识

## 12. 测试命令

```bash
pnpm typecheck
pnpm test
pnpm build
```

还应运行新增模块的精确测试命令。

## 13. 数据与安全要求

- 不提交测试小说正文
- 不提交测试数据库
- 不提交日志、缓存、Secrets、`.env`
- 不将策略写入故事权威数据
- 不写故事 SQLite
- 测试使用隔离临时目录
- 不使用用户真实小说数据

## 14. 回滚方案

- 代码：回滚 TASK-002 提交即可恢复原版行为
- 数据：删除独立 `commercial/book-strategy.json` 后回到默认 `volume`
- 不需要迁移或回滚故事数据库
- 未经 Claude 审查和人工验收，不合并到 `develop`
- 若实现必须污染故事状态或数据库，停止任务并重新评审

## 15. 非目标

本任务不实现：

- `volume/flagship` 的不同写作策略
- 模型选择和模型路由
- Prompt 差异
- 字数、修订、审查、预算策略
- 成本账本
- 人工审核记录
- 三章、十章、二十至三十章验证
- Studio UI
- 市场选题
- 商业总编
- 读者模拟
- 平台数据和自动发布
- 多本并行调度

## 16. 交付物

- 完成评审的模块设计文档
- 实现代码
- 单元测试和必要集成测试
- 更新后的任务文档
- 更新后的项目状态与任务索引
- 功能分支提交和测试报告
- Claude Code 审查待办

## 17. 实际结果

- 最终设计：采用方案 B，在 `books/<book_id>/commercial/book-strategy.json` 保存严格版本化商业策略；默认解析结果与持久化对象分型，默认结果无 `updatedAt`。
- 修改文件：新增商业策略模块与测试，更新 core 导出、模块设计、任务单、项目状态和任务索引。
- 新增接口：`BookStrategyStore.resolvePath/load/save/setProductionMode`，以及 ProductionMode/BookStrategy Schema、显式错误码和相关类型。
- 新增测试：16 项，覆盖默认、读写、非法输入、损坏文件、版本、ID 隔离、时间、原子失败、路径安全、故事状态、SQLite 和旧书兼容。
- Typecheck：通过，`pnpm typecheck` 全 workspace 退出码 0。
- Test：通过，266 files、2367 tests、0 failed；首次全量运行有 1 个既有 root-import 测试受并发负载超时，单独复现及原样全量重跑均通过。
- Build：通过；仅保留既有 Studio chunk 大小警告。
- Commit：`feat: add isolated production mode strategy`。
- 远程分支：`origin/feature/TASK-002-production-mode`。
- 已知问题：读取不加锁；写入复用书级锁并在竞争时 fail-fast 返回 `BOOK_BUSY`。路径保护沿用 InkOS 词法边界，本地预置符号链接属于受信任文件系统边界。
- Claude 审查状态：2026-07-15 审查通过，无 Blocker、无 Major。

## 18. 遗留问题

- Blocker：无。
- Major：无。
- Minor：未对非 InkOS 进程直接修改策略文件提供 CAS；受书级锁保护的 InkOS 写入不会并发覆盖。
- Suggestion：后续 UI 或 CLI 接入应复用 `BookStrategyStore`，不得直接读写 JSON；该工作不属于 TASK-002。

## 19. 审查与验收记录

- 2026-07-15 Claude Code 代码审查：通过。无 Blocker、无 Major；Minor（读取不加锁、非 InkOS 进程直写策略文件无 CAS）记录为已知限制，不阻塞验收。
- 2026-07-15 人工验收（用户委托 Claude Code 代行）：基于 `pnpm build` 产物在隔离临时目录执行 9 项验收检查，覆盖 AC-001、AC-003、AC-004、AC-005、AC-007、AC-009、AC-011，全部通过；未接触真实书籍数据。
- 审查期间发现并修复：`.gitignore` 缺少 `docs/modules/` 与本任务文档的白名单（此前依赖强制添加），收尾提交已补齐。

## 20. 最终状态

`completed`
