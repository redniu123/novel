# 模块设计：模型成本账本（Cost Ledger）

## 1. 文档状态

- 状态：`approved`（2026-07-17 参数 P1-P8 全部冻结；Codex 红队轮处置完毕；设计审查通过）
- 起草日期：2026-07-17
- 对应任务：TASK-004
- 前置事实来源：本文档 §3 的源码核对结果（2026-07-17，develop = `f8daab72`）

## 2. 背景和问题定义

PROJECT-STATUS 风险项指出：

- InkOS 没有持久化 Provider 调用次数、重试次数和货币成本的统一审计账本；
- 第 1 章记录 67,637 tokens、体验期第 2 章 162,749 tokens，实际成本和计费口径待独立核对。

模块设计 `volume-production-strategy.md` §20 已冻结边界：TASK-003 只在
`VolumeProductionResult` 中透传 `tokenUsage`，不落盘、不算价、不汇总、不记重试；
"未来事件接口仅作为 TASK-004 占位"。§26 声明 TASK-004 可消费
`VolumeProductionResult.tokenUsage`。

本模块目标：为商业生产建立独立、按书隔离、可审计的成本账本，把 token 事实
和货币成本估算持久化到商业数据层，不污染故事权威状态。

## 3. 源码事实核对（2026-07-17）

1. `packages/core/src/llm/provider.ts`：`chatCompletion()` 是模块级自由函数，
   所有 agent 经 `BaseAgent.chat()` 调用；瞬时重试（429/502/503）在其内部完成，
   `TRANSIENT_LLM_RETRIES = 2`，线性退避，重试次数对调用方不可见。
2. `PipelineRunner` 一律使用注入的 `config.client`；仅当 `modelOverrides`
   指定不同 `baseUrl` 时才在内部 `createLLMClient` 自建 client（`runner.ts`
   `resolveOverride`）。`LLMClient` 是纯数据对象（无方法），包装 client 实例
   拦截不到调用。
3. 结论：**每次 Provider 调用级别的计量必须修改 `provider.ts`（InkOS 核心），
   违反"不改 Runner/Prompt/Provider/模型路由"约束，v1 不做**。
4. 编排器层可用事实：`VolumeProductionResult` 提供 `runId`、`bookId`、
   `chapterNumber?`、`productionStatus`、`pipelineStatus?`、`stopReason?`、
   `releaseEligible`、`tokenUsage?`（prompt/completion/total）。模型身份可从
   `PipelineConfig.model` 与 `modelOverrides` 获取。
5. 已有商业存储模式（TASK-002/003A）：`<projectRoot>/books/<bookId>/commercial/*.json`、
   zod schemaVersion、临时文件 + `rename` 原子替换、`StateManager` 书级写锁、
   损坏文件报错不静默覆盖。
6. 局限（诚实记录）：
   - `tokenUsage` 是整次管线的聚合值，多模型（modelOverrides）场景无法按模型拆分；
   - Provider 内置重试消耗的 token 是否计入取决于上游返回的 usage，本模块不猜测；
   - 原始入口（`write next --count`、`auto`、Scheduler）绕过商业编排器，其消耗
     不进入账本（与既有"入口治理留待后续任务"风险项一致）。

## 4. 方案比较

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A. Provider 调用级计量 | 在 `chatCompletion` 内埋点 | 违反核心不可改约束，拒绝 |
| B. 商业运行级账本（推荐） | 编排器结果驱动，每次商业运行一条账本记录 | 采纳 |
| C. 日志解析 | 从 Studio/CLI 日志反推 | 脆弱、不可审计，拒绝 |

## 5. 模块边界

新增（均在商业层，属本项目自有代码，非 InkOS 核心）：

- `packages/core/src/commercial/cost-ledger.ts`：Schema、账本存储、读取与校验
- `packages/core/src/commercial/model-price-table.ts`：价格表加载与匹配
- `packages/core/src/commercial/cost-ledger-recorder.ts`：从 `VolumeProductionResult`
  + 运行上下文构造账本条目并写入
- `VolumeProductionOrchestrator` 增加可选事件回调（兑现 §20 占位；纯扩展，
  不改既有行为，默认不传时行为与 TASK-003B 完全一致）
- `packages/core/src/index.ts` 最小导出

禁止修改：Runner、Prompt、Provider、模型路由、故事状态与 SQLite Schema、
`ChapterMeta.status`、TASK-003A 冻结策略与商业状态 Schema、CLI/Studio/daemon/Scheduler。

## 6. 数据模型（v1 草案，待冻结参数确认后定稿）

`CostLedgerEntryV1`（每次商业运行一条）：

- `schemaVersion: 1`
- `seq`：书内单调递增序号（锁内取末条 seq+1；权威顺序 = 文件行序 = seq 序，
  读取端校验二者一致，报表禁止按 `recordedAt` 作权威排序）【红队 C4】
- `entryId`（UUID）、`runId`（同书唯一，写入前锁内查重，重复报
  `LEDGER_DUPLICATE_RUN`，保证 at-most-once）【红队 C3】
- `bookId`：写入前强制三方一致校验（路径 bookId == 条目 bookId == 运行上下文
  bookId），不一致报 `LEDGER_BOOK_ID_MISMATCH`（写读两侧同码）【红队 B2】
- `chapterNumber?`
- `recordedAt`（ISO-8601 本机时钟，仅展示用途；时钟回拨不影响权威顺序）
- `productionStatus`、`pipelineStatus?`、`stopReason?`（冗余快照，便于独立审计）
- `tokenUsage?`：`promptTokens`/`completionTokens`/`totalTokens`（缺失即缺失，
  不补 0）；`usageExtra?`：上游 usage 对象的未知字段原样快照 + logger 告警，
  不无声丢弃【红队 U4】
- `inkosVersion`：core 包版本快照，供跨升级审计口径漂移【红队 U1】
- `model`：主模型标识（取自 `PipelineConfig.model`）；
  `overrideModels?`：agent 级覆盖的模型名列表（仅模型名，严禁纳入 baseUrl、
  apiKeyEnv、header 等任何端点/凭证派生信息）【红队 B3】
- `cost?`：`{ currency, promptCost, completionCost, totalCost, priceTableVersion,
  unitPriceSnapshot, approximate: boolean }`；存在 overrideModels 时按主模型
  计价且 `approximate: true`（见 §15 P7）；
  `costUnavailableReason?`：`"model_not_found" | "price_table_invalid" |
  "token_usage_missing"`——三种缺价原因显式区分，不写伪造 0 值【红队 D3】
- 条目一经写入不可变；金额用十进制字符串（decimal），杜绝二进制浮点累计误差

## 7. 存储与并发（已冻结：JSONL 追加式）

- 位置：`<book>/commercial/cost-ledger.jsonl`，每条一行，追加不重写
- 锁：复用 `StateManager` 书级 `.write.lock` 机制——源码核对（`state/manager.ts`
  138-199 行）确认这是跨进程 OS 级锁文件（O_EXCL 创建 + 心跳 + 陈旧锁恢复 +
  进程内 map 双保险），非纯进程内原语【红队 C2 反驳依据】
- 写路径临界区（【红队 C1】TOCTOU 防护）：以下步骤必须在同一把书级锁内完成——
  1) 打开 fd；2) 尾部完整性检查（见下）；3) runId 查重；4) 取末条 seq；
  5) 单次 `write()` 以 `O_APPEND` 追加完整一行（含结尾 `\n`）；6) `fsync`；
  7) 释放锁。禁止"先无锁校验再加锁追加"
- 撕裂尾行判定规则（【红队 D1】精确化）：
  - 文件非空且末字节不是 `\n` → `LEDGER_TORN_TAIL`（截断成合法 JSON 也逃不过）
  - 末行 JSON.parse 失败且其余行全部合法 → `LEDGER_TORN_TAIL`
  - 非末行 JSON.parse 失败 → `LEDGER_INVALID_JSON`（整体损坏，语义更重）
  - 任何行 parse 成功但 zod 校验失败 → `LEDGER_INVALID_SCHEMA`
  - 空文件 = 合法空账本
- 受控恢复（【红队 D2】闭环）：导出 `repairLedgerTornTail(bookId)` API——锁内
  校验前缀全部合法后，把撕裂尾字节原样移入 `commercial/cost-ledger.torn.<seq>.bak`
  （证据保全），再截断到最后一个合法 `\n`。仅显式人工调用，绝不自动触发；
  CLI 接线不在本任务范围
- 抗静默丢账最小防线（【红队 D4】）：账本写失败时 Recorder 尽力更新
  `commercial/cost-ledger-failures.json`（原子替换：失败计数、最近错误码、
  漏记 runId 列表）；聚合 API 返回值必须携带 `ledgerHealth`（含未决失败标记），
  使漏账在读取侧不可能被忽视；标记文件本身写失败则 logger error 兜底
- 汇总（项目级/书级合计）由读取端纯函数聚合，不落盘第二份事实

## 8. 价格表（已冻结：项目配置文件）

- 项目配置 `config/model-prices.json`，用户维护，按模型记
  prompt/completion 单价（每 1M tokens）与币种；可提交仓库（价格非密钥）
- 不内置默认价，匹配不到模型 → `cost` 置空并在条目上可见，不猜价
- 成本口径（已冻结：写入时快照）：条目存 `priceTableVersion` + 单价快照 +
  计算结果，历史成本不随价格表变动；报表可用当前表重算对比

## 9. 接入方式与失败语义（已冻结：事件回调 + fail-open）

- 编排器构造选项新增命名空间式事件容器 `events?: { onProductionSettled?:
  (event: VolumeProductionSettledEvent) => void | Promise<void> }`，事件类型
  独立定义、可扩展，不把裸回调塞进公开签名【红队 U3 部分采纳】
- 事件载荷是深冻结（`Object.freeze` 递归）的独立快照对象，不是活的
  `VolumeProductionResult` 引用；回调返回值被忽略；`VolumeProductionResult`
  类型与内容与 TASK-003B 完全一致、零新增字段——原设计的
  "返回值附 ledgerWriteFailed 诊断"已删除，诊断改走 §7 失败标记文件 +
  聚合 API `ledgerHealth`，杜绝商业诊断经结果对象回流【红队 B1 修复】
- 触发时机与次数语义（【红队 C3】）：每次 `produceNextChapter` 恰好触发一次，
  在商业状态终态落盘（finishRun/pause）并释放书级锁之后、结果返回之前，
  `await` 回调但 catch 一切异常；账本写入自行获取书级锁（时序上锁已释放，
  无自锁/锁序反转）；at-most-once 由 runId 查重兜底（编排器无重试，正常即
  exactly-once）
- 不传 `events` 时行为与 TASK-003B 完全一致
- 账本写失败/回调抛错均不改变生产结果（fail-open），logger 显式告警 +
  失败标记文件持久化

## 10. 数据边界

- 成本/运营数据只进 `commercial/`，绝不写入故事权威状态、Markdown 投影或 SQLite 记忆；
  `VolumeProductionResult` 零新增字段（见 §9）；
- 所有数据按 `bookId` 隔离，路径经 `safeChildPath` 校验；写入前 bookId 三方
  一致校验（§6）；
- 条目允许的模型身份字段闭集：`model`、`overrideModels`（仅模型名字符串）；
  任何 baseUrl、apiKeyEnv、header、query 派生值都在禁入清单，测试断言字段闭集；
- 不记录 prompt 正文、密钥；`unitPriceSnapshot` 只含数字与币种；
- Git 边界可验收化【红队 B4】：实现时核对并确保 `cost-ledger.jsonl`、
  `cost-ledger.torn.*.bak`、`cost-ledger-failures.json` 均被 ignore 覆盖，
  验收标准含"账本读写后 `git status` 无新增未忽略文件"；价格表 Git 策略
  见 §15 P8（待用户裁决）。

## 11. 错误模型

错误码（zod 枚举，风格沿用 TASK-003A）：`LEDGER_INVALID_PATH`、
`LEDGER_INVALID_JSON`、`LEDGER_INVALID_SCHEMA`、`LEDGER_UNSUPPORTED_VERSION`、
`LEDGER_BOOK_ID_MISMATCH`、`LEDGER_TORN_TAIL`、`LEDGER_DUPLICATE_RUN`、
`LEDGER_REPAIR_FAILED`、`LEDGER_READ_FAILED`、`LEDGER_WRITE_FAILED`、
`PRICE_TABLE_INVALID`。

## 12. 测试设计（提纲）

1. Schema 校验：合法/非法/超版本/负数与超大数值 token
2. 追加与读取往返；顺序稳定
3. 原子性：模拟中断后无半写状态（JSON）或可检测撕裂尾行（JSONL）
4. 并发：同书两个写入者串行化；锁失败报错
5. bookId 隔离与路径穿越拒绝
6. 价格匹配：命中/未命中/多模型指纹/币种
7. 成本计算：精度（用整数微分单位或 decimal 字符串，避免浮点累计误差——定稿时确定）
8. Recorder：从各类 `VolumeProductionResult`（成功/暂停/无 tokenUsage）构造条目
9. 事件回调：默认不传行为不变；回调抛错不影响生产结果
10. 损坏文件：不静默覆盖，错误码精确

## 13. 回滚

新文件 + 编排器可选参数扩展，删除新文件并还原可选参数即可回滚；
不迁移既有数据，无 schema 变更连带。

## 14. 非目标

- Provider 调用级/重试级计量（需上游核心埋点，另立任务）
- 预算控制与超额熔断
- 非商业入口的消耗记账
- CLI/Studio 展示层
- 自动对账与发票核对

## 15. 已冻结业务参数（2026-07-17 用户确认）

| 参数 | 冻结值 |
| --- | --- |
| P1 存储格式 | JSONL 追加式（`commercial/cost-ledger.jsonl`） |
| P2 存储归属 | 按书 `commercial/` 下；项目级只做读取端内存聚合 |
| P3 记录粒度 | 每次商业运行一条；Provider 重试 v1 不记（不可观测，已知限制） |
| P4 价格表来源 | 项目配置 `config/model-prices.json`，无内置默认价 |
| P5 成本口径 | 写入时快照单价 + priceTableVersion + 计算结果 |
| P6 接入与失败语义 | 编排器可选 `onProductionSettled` 回调 + fail-open 响亮告警 |

红队轮后新增两项（2026-07-17 用户裁决冻结）：

| 参数 | 冻结值 |
| --- | --- |
| P7 存在 modelOverrides 时的计价 | 按主模型计价并 `approximate: true` + 记录 overrideModels |
| P8 价格表 Git 策略 | `config/model-prices.json` 加 ignore，仓库只提交 `model-prices.example.json` 模板 |

## 16. Codex 设计红队轮处置记录（2026-07-17）

- 审查者：Codex（经用户网关；`gpt-5.3-codex-spark` 该网关 503 不可用，
  改用 `gpt-5.4`，reasoning_effort=low，分四个攻击面独立审查）
- 产出：16 条（7 Blocker / 7 Major / 2 Minor）
- 处置：14 条采纳修复（B1 结果对象零污染、B2 bookId 三方校验、B3 指纹字段
  闭集、B4 Git 边界可验收化、C1 单临界区写路径、C3 事件时序+runId 幂等、
  C4 seq 单调序号、D1 撕裂判定精确化、D2 受控恢复 API、D3 缺价原因显式区分、
  D4 失败标记文件+ledgerHealth、U1 inkosVersion 快照、U3 事件容器化 API、
  U4 usageExtra 保真）
- 1 条有据反驳：C2（"锁疑似进程内"）——`state/manager.ts:138-199` 确认
  `.write.lock` 为跨进程 OS 级锁文件（O_EXCL + 心跳 + 陈旧锁恢复）
- 1 条部分反驳：U3 的 Blocker 定级——`volume-production-orchestrator.ts` 是
  本项目商业层自有代码，上游 InkOS（Narcooo/inkos）不存在该文件，"上游抢占
  同一签名"前提不成立；但其 API 卫生建议（事件容器而非裸回调）已采纳
- 2 条转待裁决参数：U2 → P7；B4 价格表部分 → P8

## 17. 与上游同步风险

只依赖公开导出的 `VolumeProductionResult`、`PipelineConfig.model` 与既有商业层
基础设施；不触碰 InkOS 内部结构，上游 InkOS 升级时本模块随 TASK-003 商业层
一起适配即可。
