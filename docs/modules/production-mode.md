# Production Mode 模块设计

## 1. 文档状态

- 模块名称：Production Mode
- 关联任务：TASK-002
- 当前状态：`implemented_pending_review`
- 设计目标：为每本小说建立独立、版本化、可校验的生产模式元数据
- 当前推荐方案：独立商业元数据目录
- 说明：Codex 已根据真实 InkOS 代码完成架构核查和实现；当前等待 Claude Code 完成架构与代码审查。

## 2. 背景与问题定义

后续系统计划支持：

- `volume`：低成本、有限修订、快速验证
- `flagship`：更高质量、更深审查、更高人工参与

在绑定具体生产策略之前，系统首先需要稳定回答：

> 当前这本小说属于哪种生产模式？

该信息属于商业运营元数据，不属于故事事实，不应进入：

- 人物状态
- 世界观规则
- 时间线
- 伏笔
- 章节摘要
- `story/state`
- Markdown 故事投影
- `memory.db`

TASK-002 只建立模式身份和存储基础，不改变任何写作行为。

## 3. 设计目标

1. 支持 `volume` 和 `flagship`。
2. 每本书独立配置。
3. 按 `book_id` 隔离。
4. 缺失配置时默认 `volume`。
5. 默认读取不产生写操作。
6. 非法、损坏和版本不兼容配置明确报错。
7. 旧书无需迁移即可继续使用。
8. 商业数据与故事状态严格分离。
9. 存储格式可版本化。
10. 写入安全、原子、可回滚。
11. API 可供后续策略、成本账本和 Studio 使用。
12. 不迫使 TASK-002 修改 InkOS 核心创作管线。

## 4. 非目标

当前不负责：

- 模型选择或模型路由
- Prompt 调整
- 章节字数策略
- 修订次数策略
- 审查门槛
- Token 与费用统计
- 运行账本
- 人工审核记录
- 市场选题
- 商业总编
- 读者模拟
- 自动发布
- Studio UI
- 多本任务调度

## 5. 已核实的 InkOS 现状

### 5.1 项目与书籍根目录

- CLI 以 `process.cwd()` 作为 `projectRoot`。
- Studio 使用命令行参数、`INKOS_PROJECT_ROOT` 或当前目录解析 `projectRoot`。
- `StateManager.booksDir` 固定为 `<projectRoot>/books`，`bookDir(bookId)` 固定为 `<projectRoot>/books/<bookId>`。
- InkOS 没有统一 `BookContext` 类型；本模块使用 `projectRoot + expected bookId` 作为可信调用上下文。

### 5.2 `book_id`

- InkOS 已有稳定 `book_id`，由标题派生，必要时使用时间戳回退。
- ID 同时作为书目录名并持久化在 `book.json.id`；正常 CLI/Studio 更新接口不修改 ID。
- `isSafeBookId`/`assertSafeBookId` 限制长度、空白、控制字符、分隔符和 `..`。
- 本模块始终用调用方传入的 expected `bookId` 决定路径，策略文件不能反向选择当前书籍。

### 5.3 扩展、Schema 与存储工具

- InkOS 没有官方书级 `metadata`、`extensions` 或 `commercial` 扩展目录。
- 原生 `book.json` 已包含创作设置，但商业模式写入该文件会增加内核耦合和上游冲突。
- 仓库使用 Zod，但 `StateManager.loadBookConfig` 当前只执行 JSON 解析和类型断言。
- 没有通用原子 JSON 写入工具；建书只在整目录层使用 staging + rename。
- 错误体系以带稳定 `code` 的错误类为主，本模块沿用该形式。

### 5.4 故事数据边界

- 权威结构化状态位于 `story/state/*.json`。
- `story/*.md` 是人类可读投影与控制文档。
- `story/memory.db` 是可删除、可重建的检索加速层，不是商业元数据存储。
- TASK-002 模块不导入或调用 runtime state、投影、Observer/Reflector 或 MemoryDB。

### 5.5 并发模型

- `StateManager.acquireBookLock` 使用书根目录 `.write.lock`，覆盖同进程多实例和跨进程写入。
- 锁冲突 fail-fast 抛出 `BookWriteLockError`，错误码为 `BOOK_BUSY`；它不是等待队列。
- 本模块保存时复用该锁，读取保持无锁和无副作用。

## 6. 候选方案

## 6.1 方案 A：写入 InkOS 现有书级配置

### 优点

- 配置入口集中
- 生命周期与书籍一致
- CLI/Studio 可能更容易访问
- 文件更少

### 缺点

- 商业数据与创作内核耦合
- 需要修改原有 Schema
- 增加上游同步冲突
- 后续商业字段容易膨胀
- 原版工具可能重写未知字段
- 回滚和迁移成本较高

### 风险

- 上游升级冲突
- 配置职责模糊
- 商业模式被错误视为故事配置

## 6.2 方案 B：独立商业元数据目录

建议逻辑路径：

```text
<book-project-root>/commercial/book-strategy.json
```

如真实结构为 `books/<book_id>`，则等价于：

```text
books/<book_id>/commercial/book-strategy.json
```

### 优点

- 商业数据与故事状态清晰分离
- 不污染 InkOS 原生配置
- 不写故事 SQLite
- 易扩展成本、审核和平台数据
- 删除商业目录即可回到原版
- 上游冲突少
- 符合外置商业运营层架构

### 缺点

- 需要独立加载、校验和保存
- 需要定义损坏与版本行为
- 需要处理路径安全和原子写入
- 后续 UI 接入要增加接口

### 风险

- `book_id` 不稳定会破坏隔离
- 并发写入可能产生覆盖
- 项目根目录解析错误可能跨书读取

## 6.3 方案 C：独立商业数据库

例如：

```text
<workspace>/commercial.db
```

### 优点

- 查询和统计方便
- 适合未来多书管理
- 支持事务与并发
- 成本账本可统一

### 缺点

- 对 TASK-002 过度设计
- 引入全局数据库生命周期
- 书籍迁移和备份复杂
- 容易与故事 SQLite 混淆
- 需要迁移机制

### 结论

TASK-002 不采用。后续成本账本或多书管理阶段再评估。

## 7. 推荐方案

在真实代码没有更合适的官方扩展点时，采用方案 B：

```text
<book-project-root>/
├── story/
├── chapters/
├── ...
└── commercial/
    └── book-strategy.json
```

要求：

- 不写故事状态
- 不写故事 SQLite
- 按书隔离
- 可删除、可回滚
- 不改变写作行为

选择理由：

1. 符合“创作内核 + 商业运营层”架构。
2. 减少修改上游核心配置。
3. 为成本、人工审核和平台数据保留扩展空间。
4. 旧书无需迁移。
5. 删除商业目录不破坏小说。

## 8. 数据模型

建议：

```typescript
export const PRODUCTION_MODES = ["volume", "flagship"] as const;

export type ProductionMode = (typeof PRODUCTION_MODES)[number];

export interface BookStrategy {
  schemaVersion: 1;
  bookId: string;
  productionMode: ProductionMode;
  updatedAt: string;
}
```

### `schemaVersion`

- 当前固定为 `1`
- 不支持的版本明确报错
- 不静默当作版本 1

### `bookId`

- 必须与当前可信书籍上下文一致
- 不得由策略文件反向决定当前书籍
- 不一致时拒绝
- 必须防止路径穿越

### `productionMode`

仅允许：

```text
volume
flagship
```

### `updatedAt`

- 使用仓库统一格式
- 若无统一规范，使用 UTC ISO 8601
- 成功保存或更新时刷新
- 不使用本地语言格式

## 9. Schema

真实实现导出严格 Schema：

```typescript
export const ProductionModeSchema = z.enum(["volume", "flagship"]);

export const BookStrategySchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string().refine(isSafeBookId),
  productionMode: ProductionModeSchema,
  updatedAt: z.string().datetime(),
}).strict();
```

- 未知字段被拒绝。
- 数值型未知 `schemaVersion` 在完整 Schema 校验前转换为显式版本错误。
- 非法 `bookId`、模式、时间或缺失字段转换为 Schema 错误。

## 10. 默认策略与 `updatedAt` 语义

最终采用方案 3，区分持久化对象与解析结果：

```typescript
type ResolvedBookStrategy =
  | {
      schemaVersion: 1;
      bookId: string;
      productionMode: "volume";
      source: "default";
    }
  | (BookStrategy & { source: "file" });
```

- 文件不存在时返回 `source: "default"`，不包含 `updatedAt`，也不创建目录或文件。
- 文件存在时返回 `source: "file"` 和持久化 `updatedAt`。
- 只有成功保存或更新才生成新的 UTC ISO 8601 `updatedAt`。

## 11. 实际接口

```typescript
const store = new BookStrategyStore(projectRoot);

store.resolvePath(bookId);
await store.load(bookId);
await store.save(expectedBookId, { bookId, productionMode });
await store.setProductionMode(bookId, productionMode);
```

- `load` 缺失文件时返回默认解析结果。
- `save` 同时校验 expected `bookId` 与输入 `bookId`，并在写入前读取已有文件；损坏文件不会被覆盖。
- `setProductionMode` 是只更新模式的便捷入口。
- `BookStrategyStoreOptions.now` 和 `atomicReplace` 用于确定性时钟及文件系统适配/故障测试；生产默认使用系统时钟和 `fs.rename`。
- Writer、Planner、Agent、CLI 和 Studio UI 均未接入本模块。

## 12. 路径安全

路径固定解析为：

```text
<projectRoot>/books/<bookId>/commercial/book-strategy.json
```

保护措施：

1. 先使用 `assertSafeBookId` 拒绝空值、`..`、绝对路径形状、分隔符和控制字符。
2. 使用 `safeChildPath` 分别约束 books 根、书根、策略文件和临时文件。
3. 策略文件中的 `bookId` 不参与路径解析，只与 expected `bookId` 比较。
4. 错误仅记录相对路径和安全转义后的 ID，不记录策略内容、正文或密钥。

符号链接策略沿用 InkOS 现有词法路径边界：不新增 `realpath` 或 `lstat` 拒绝规则。能够在本地书目录预置符号链接的主体被视为受信任的文件系统操作者；该限制已记录为 Minor 风险。

## 13. 读取行为

### 文件不存在

- 返回默认 `volume`
- 可返回 `source = "default"`
- 不创建目录或文件

### 文件存在且合法

- 解析 JSON
- Schema 校验
- `bookId` 校验
- 返回策略

### JSON 损坏

- 明确解析错误
- 保留原文件
- 不返回默认
- 不覆盖

### Schema 非法

- 明确校验错误
- 返回安全字段路径
- 不偷偷降级

### 版本不支持

- 明确版本错误
- 不自动猜测

### `bookId` 不一致

- 明确隔离错误
- 不自动改写

## 14. 保存与更新

保存顺序：

1. 校验 expected `bookId` 和输入 Schema。
2. 获取 InkOS 书级写锁。
3. 在锁内读取现有策略；损坏、非法、未知版本或 ID 不一致时停止。
4. 构造 `schemaVersion: 1` 和新的 UTC `updatedAt`。
5. 在 `commercial` 同目录以 `wx` 创建随机临时文件。
6. 写入完整 JSON 和尾部换行，执行文件句柄 `sync()`，关闭句柄。
7. 使用 `rename` 原子替换目标。
8. 任一步失败时关闭句柄并删除临时文件，保留旧目标文件。
9. 在 `finally` 中释放书级锁。

仓库没有目录 fsync 先例，且 Windows 对目录句柄同步不具备一致可移植语义；TASK-002 对临时文件执行 flush/fsync，不额外引入平台分支或依赖。

## 15. 并发边界

- 同一本书的 InkOS 写入复用 `.write.lock`，竞争写不会 last-write-wins，而是 fail-fast 返回 `BOOK_BUSY`。
- 不同 `bookId` 使用不同目录和锁，可独立写入。
- 读取不加锁；原子 rename 保证读取者只看到旧文件或完整新文件。
- 非 InkOS 进程绕过 Store 直接写 JSON 不受锁协调，也没有 CAS；这是当前 Minor 限制。
- TASK-002 不新增队列、重试、修订号、分布式锁或商业数据库。

## 16. 错误模型

`BookStrategyError` 提供稳定 `code`、`bookId` 和相对路径：

- `BOOK_STRATEGY_INVALID_PATH`：非法 ID 或路径越界。
- `BOOK_STRATEGY_INVALID_JSON`：JSON 损坏。
- `BOOK_STRATEGY_INVALID_SCHEMA`：模式、字段、ID 格式或时间不合法。
- `BOOK_STRATEGY_UNSUPPORTED_VERSION`：不支持的数值型版本。
- `BOOK_STRATEGY_BOOK_ID_MISMATCH`：持久化或输入 ID 与 expected ID 不一致。
- `BOOK_STRATEGY_READ_FAILED`：非缺失类读取失败。
- `BOOK_STRATEGY_WRITE_FAILED`：锁获取之外的写入、flush、rename 或清理失败。

文件不存在不是错误。书锁竞争继续使用现有 `BookWriteLockError` / `BOOK_BUSY`，不重复包装。

## 17. 向后兼容

- 旧书无 `commercial` 目录时正常返回 `volume`
- 独立目录不影响原版 InkOS
- 删除策略文件后回到默认 `volume`
- 不迁移故事状态
- 未来版本升级使用显式迁移，不静默转换

## 18. 测试设计

### 单元测试

1. ProductionMode Schema
2. BookStrategy Schema
3. 默认读取
4. 默认读取不创建文件
5. 保存读取 `volume`
6. 保存读取 `flagship`
7. 非法模式
8. 损坏 JSON
9. 缺字段
10. 未知版本
11. `bookId` 不一致
12. 路径穿越
13. 原子写入
14. 写入失败保留旧文件
15. `updatedAt`
16. 两书隔离

### 集成测试

1. 使用真实 InkOS 测试书目录
2. 旧书加载不产生行为变化
3. 策略操作不改变 `story/state`
4. 不写 `memory.db`
5. 重启后读取一致
6. 原版流程不受影响

### 回归测试

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 19. 可观测性

错误信息应：

- 包含安全的书籍标识摘要
- 包含相对路径或可定位位置
- 不含小说正文或密钥
- 区分默认读取与异常
- 不吞掉损坏配置

## 20. 安全要求

- 防止路径穿越
- 不接受任意绝对路径
- 明确符号链接策略
- 不记录完整策略内容
- 测试目录隔离
- 不提交运行数据
- 不写故事数据库
- 不把异常吞掉后继续写作

## 21. 与后续任务的接口

### TASK-003：走量生产策略

只读取 `productionMode`，不重新实现存储。候选策略：

- 一章一生成
- 自动审查
- 修订次数限制
- 人工闸门
- 字数目标
- 失败停止

### TASK-004：成本账本

使用相同 `book_id`，但独立存储运行和成本数据。

### TASK-005：人工审核记录

读取书籍和章节标识，不修改 BookStrategy。

### Studio

后续通过 Store/API 读写模式，不直接操作 JSON。

## 22. 已确认结论

1. InkOS 已有稳定 `book_id` 和安全校验工具。
2. 真实书根是 `<projectRoot>/books/<bookId>`。
3. 没有官方商业元数据扩展目录。
4. 没有通用原子 JSON 写入工具。
5. 已有跨实例、跨进程书级写锁，冲突行为为 `BOOK_BUSY`。
6. 默认解析结果与持久化对象分型，默认值无 `updatedAt`。
7. 持久化 Schema 使用 `.strict()`。
8. 错误采用带稳定 code 的 `BookStrategyError`。
9. TASK-002 不提供 CLI 或 Studio 接口。
10. 符号链接沿用本地受信任文件系统边界。

## 23. 最终设计

采用方案 B：

```text
<projectRoot>/books/<bookId>/commercial/book-strategy.json
```

并遵循：

- 缺失默认 `volume`，读取不写文件。
- 默认解析结果没有虚假 `updatedAt`。
- 非法配置、未知版本和 ID 不一致明确失败。
- 写入复用书级锁并执行同目录临时文件 + sync + 原子 rename。
- 每本书按 expected `bookId` 隔离。
- 不写故事状态、Markdown 投影或故事 SQLite。
- 不改变模型、Prompt、字数、审查、修订或成本行为。

## 24. 实现结果

- 实现：`packages/core/src/commercial/book-strategy.ts`。
- 导出：`packages/core/src/index.ts`。
- 测试：`packages/core/src/__tests__/book-strategy.test.ts`，16 项全部通过。
- 回归：266 files、2367 tests、typecheck 和 build 全部通过。
- 状态：`implemented_pending_review`。
- 下一步：让 Claude Code 审查 `feature/TASK-002-production-mode`。
