# TASK-004：模型成本账本

## 1. 基本信息

- 任务编号：TASK-004
- 任务名称：模型成本账本（Cost Ledger）
- 当前状态：`in_progress`（设计审查通过，004A 实现中）
- 前置依赖：TASK-003A `completed`、TASK-003B `completed`（TASK-003 总验收可并行）
- 建议实现分支：`feature/TASK-004-cost-ledger`
- 模块设计：`docs/modules/cost-ledger.md`
- 源码事实核对：2026-07-17，基于 develop `f8daab72`，见模块设计 §3

## 2. 目标

1. 为商业生产建立按书隔离、可审计的成本账本（token 事实 + 货币成本估算）。
2. 兑现模块设计 §20 的事件接口占位：编排器可选结果回调，默认行为不变。
3. 提供价格表加载/匹配与成本计算，未知模型不猜价。
4. 提供读取端聚合（书级/项目级合计），不落盘第二份事实。
5. 回应 PROJECT-STATUS 风险项："无统一审计账本"与"成本口径待核对"的数据基础。

## 3. 拆分（沿用 TASK-003 惯例）

- TASK-004A：账本 Schema v1 + 存储（追加/读取/校验/损坏检测）+ 价格表 + 成本
  计算 + 聚合纯函数。可独立测试、独立回滚。
- TASK-004B：Recorder + 编排器可选事件回调接线 + 根导出。依赖 004A。

一次只交付一个子任务；004A 合并后再开 004B。

## 4. 允许修改范围

- `packages/core/src/commercial/cost-ledger.ts`（新增）
- `packages/core/src/commercial/model-price-table.ts`（新增）
- `packages/core/src/commercial/cost-ledger-recorder.ts`（新增，004B）
- `packages/core/src/commercial/volume-production-orchestrator.ts`（仅新增可选
  回调参数与触发点，004B；不改既有控制流）
- `packages/core/src/index.ts` 最小导出
- 对应单元测试与临时目录集成测试
- `.gitignore` 仅追加本任务文档白名单条目
- 本任务、模块设计、TASK-INDEX、PROJECT-STATUS Markdown

## 5. 禁止修改范围

- Runner、Planner/Writer/Auditor/Reviser、Prompt、Provider（含 `chatCompletion`）、模型路由
- 故事权威状态、Markdown 投影、SQLite Schema、`ChapterMeta.status`
- TASK-003A 冻结策略与商业状态 Schema（账本不写入 volume-production-state.json）
- CLI、Studio、daemon、Scheduler
- 依赖与锁文件

## 6. 功能要求（FR 编号在参数冻结后定稿）

### FR-L01 Schema v1
`CostLedgerEntryV1` 按模块设计 §6；zod 校验；schemaVersion=1；token 缺失即缺失不补 0。

### FR-L02 存储
按书 `commercial/` 下；复用 StateManager 书级写锁；原子写；损坏（含撕裂尾行）
显式报错、不静默覆盖、不自动截断。

### FR-L03 价格表
按冻结参数 P4；未命中模型 `cost` 置空且条目可见标识；金额精度避免二进制浮点
累计误差。

### FR-L04 成本口径
写入时快照：条目存单价快照 + `priceTableVersion` + 计算结果（P5 已冻结）。

### FR-L05 Recorder 与事件回调（004B）
编排器构造选项新增事件容器 `events.onProductionSettled`（深冻结事件快照，
非活结果引用；`VolumeProductionResult` 零新增字段）；触发时机 = 商业状态终态
落盘并释放锁之后、返回之前，await + catch；不传时行为与 TASK-003B 一致；
回调抛错/账本写失败不改变生产结果（fail-open）。

### FR-L08 撕裂尾行受控恢复（004A）
`repairLedgerTornTail(bookId)`：锁内证据保全（`.torn.<seq>.bak`）后截断到
最后合法行；仅显式调用，绝不自动触发。

### FR-L09 抗静默丢账（004B）
写失败更新 `commercial/cost-ledger-failures.json`（原子替换）；聚合 API 返回
`ledgerHealth`；runId 写入前查重（`LEDGER_DUPLICATE_RUN`）。

### FR-L06 聚合
读取端纯函数：按书合计与项目级跨书合计（仅内存计算）。

### FR-L07 数据边界
只进 `commercial/`；bookId 隔离 + safeChildPath；不记 prompt 正文/密钥；
账本运行数据不进 Git。

## 7. 验收标准（草案，参数冻结后定稿）

1. 合法条目追加/读取往返一致，顺序稳定。
2. 非法 JSON、非法 Schema、超版本、bookId 不匹配、撕裂尾行分别报精确错误码。
3. 同书并发写串行化；异书互不阻塞。
4. 路径穿越 bookId 被拒绝。
5. 价格命中、未命中、多模型指纹场景的 cost 行为符合冻结参数。
6. 成本计算无浮点累计误差（对抗用例含超大 token 数）。
7. 编排器不传回调时行为与 TASK-003B 一致（回归）。
8. 回调抛错/账本写失败不改变 `VolumeProductionResult` 语义与形状（零新增字段）。
11. 撕裂尾行：检测规则四分支（TORN_TAIL/INVALID_JSON/INVALID_SCHEMA/空文件合法）
    行为精确；修复 API 证据保全且不自动触发。
12. 写失败后失败标记文件存在且聚合 `ledgerHealth` 可见；同 runId 二次写入被拒。
13. 条目模型身份字段为闭集，不含任何 baseUrl/凭证派生值。
14. 账本读写后 `git status` 无新增未忽略文件。
9. 故事权威状态与商业状态文件在账本读写前后无变化。
10. 全量 typecheck、test、build 通过。

## 8. 自动测试

见模块设计 §12 提纲；每个 FR 至少一组正反用例；Codex 对抗测试轮筛选后补充
（非法输入、损坏 JSON、时钟回拨、并发交错、超大数值）。

## 9. 数据安全与回滚

- 不提交密钥、价格外的账户信息、账本运行数据；
- 新文件 + 可选参数扩展，删除即回滚，无数据迁移。

## 10. 非目标

- Provider 调用级/重试级计量（v1 不可观测，见模块设计 §3；如需要另立任务
  评估上游最小埋点）
- 预算控制、熔断、自动对账
- 非商业入口（write next/auto/Scheduler）的记账
- CLI/Studio 展示

## 11. 审查记录

- 2026-07-17：任务单与模块设计起草完成。
- 2026-07-17：关键业务参数 P1-P6 由用户冻结（见模块设计 §15）：JSONL 追加式、
  按书隔离、运行级粒度、项目价格表、写入时快照、事件回调 + fail-open。
- 2026-07-17：Codex 设计红队轮完成（16 条：7 Blocker/7 Major/2 Minor；
  14 采纳、1 有据反驳、1 部分反驳、2 转待裁决参数 P7/P8），处置明细见
  模块设计 §16。
- 2026-07-17：P7（主模型计价+估算标记）、P8（价格表 ignore+提交模板）由用户
  裁决冻结；设计审查通过，进入 TASK-004A 实现。

## 12. 已知仓库不一致（记录，不在本任务静默修复）

TASK-003 系列文档与 `volume-production-strategy.md` 未加入 .gitignore 白名单
（当时以 `git add -f` 入库）。本任务只为 TASK-004 文档补白名单；是否回填
TASK-003 条目由用户裁决。

## 13. 实际结果

（实现完成后回填）

## 14. 遗留问题

（实现完成后回填）

## 15. 最终状态

（实现完成后回填）
