# 项目状态

最后更新时间：2026-07-23

## 基本信息

| 项目 | 当前值 |
| --- | --- |
| 项目名称 | 基于 InkOS 的小说智能体 |
| 当前阶段 | TASK-004 成本账本完成；TASK-003 总验收仍待真实模型人工验收；BIZ-001 商业计划完成 |
| InkOS 版本 | 1.7.0 |
| 基线 Commit | `7ac8d530557154653cdac83c07dd7488c1460191` |
| 远程默认稳定分支 | `origin/master` |
| 本地兼容稳定分支 | `main`，跟踪 `upstream/master`，本轮保留 |
| 集成分支 | `develop` |
| 当前工作分支 | `docs/BIZ-001-fanqie-short-story-business-plan` |
| origin | `https://github.com/redniu123/novel.git` |
| upstream | `https://github.com/Narcooo/inkos.git` |

## 任务状态

- 已完成：TASK-001 `completed`；TASK-001A `completed`；TASK-001B `completed`；TASK-001C `completed`；TASK-002 `completed`（2026-07-15 Claude Code 审查通过，代行人工验收 9 项检查通过，已合并 `develop`）。
- 当前总任务：TASK-003（走量小说生产策略）`in_progress`。
- 已完成子任务：TASK-003A `completed`（2026-07-17 复审通过并合并 develop）；TASK-003B `completed`（2026-07-17 实现并自审通过，28 项新测试）。
- 已完成：TASK-004 `completed`（004A 账本/价格表/聚合；004B Recorder/settled event；设计红队和代码复审全部闭环）。
- 商业发现任务：BIZ-001（番茄短故事商业化生产计划）`completed`；独立于第一阶段长篇 MVP，不占用已预留的 TASK-005 编号。
- 2026-07-16：TASK-003 首轮设计审查结论为 `rejected`；用户已确认 1-12 全部推荐参数并批准拆分，文档已按 Blocker/Major/Minor/Suggestion 修订。
- 2026-07-16：进一步核对 Runner、审查循环、长度治理、Abort、状态、CLI/Scheduler 和根导出；文档已明确直接字段与派生字段、真实配置链和公共接入方式。
- 2026-07-16：TASK-003 设计复审结论为 `approved_with_changes`，无 Blocker；projectRoot 绑定 API 和公开 API 导入边界已澄清。
- 2026-07-17：TASK-003A 代码复审结论 `approved_with_changes`，无 Blocker；唯一 Major（Store `save()` 逃逸口）已修复（`1e3c00d`）并回归通过；随后合并 `develop`。
- 下一步：用户在真实凭证环境按 TASK-003 第 12 节完成人工验收；按 BIZ-001 商业计划执行两篇短故事人工投稿试验。工程后续建议见 [TASK-004 完成与后续报告](tasks/TASK-004-COMPLETION-AND-NEXT-STEPS.md)。

任务明细见 [TASK 索引](tasks/TASK-INDEX.md)。

## 当前 MVP 目标

完成一本走量网络小说前 20-30 章的可控生产：复用 InkOS 的规划、写作、审查、修订、状态和记忆能力，保留人工最终审核和发布，并为后续商业运营层保留独立扩展空间。

## 当前非目标

- 多本并行生产和多账号运营；
- 自动登录或自动发布到内容平台；
- 大规模正文抓取和根据评论实时改写已发布内容；
- 完全无人审核；
- 重写 InkOS 核心或建设闭源商业 SaaS。

完整范围见 [产品方向](00-product-brief.md)。

## 最近一次测试结果

2026-07-13 在 Node 24.14.0、pnpm 9.15.9 上完成：

- `pnpm install --frozen-lockfile` 通过，1011 packages；
- `pnpm build` 通过；
- `pnpm typecheck` 通过；
- `pnpm test` 通过：266 files、2367 tests、0 failed、0 skipped；
- CLI、Studio 和 SQLite 运行验证通过；
- Studio E2E 因 Windows 下 POSIX 启动命令不兼容而未执行测试；
- 真实 `doctor`、AI 建书、章节规划、正文、自动审查、状态投影和 SQLite 写入通过；
- TASK-001B 验收以用户生成的第 1 章为准，停在 `ready-for-review`，没有替用户执行人工批准；
- TASK-001C 为纯文档任务，DOCX 已重新生成并完成逐页渲染检查。
- TASK-002 新增 16 项 production mode 测试；固定 Node 24.14.0、pnpm 9.15.9 下 typecheck、test、build 均通过。
- TASK-002 验收：2026-07-15 基于 `pnpm build` 产物在隔离临时目录完成 9 项手动验收检查（默认值、落盘持久化、书籍隔离、非法值、损坏文件、路径穿越、故事状态不受影响），全部通过。
- TASK-003 设计轮已完成纯文档修订；完成 15 项源码事实静态核对和 Markdown 一致性检查。
- TASK-003A 实现验证：2026-07-16 固定 Node 24.14.0、pnpm 9.15.9；`pnpm --filter @actalk/inkos-core typecheck`、`pnpm --filter @actalk/inkos-core test -- volume-production-policy-state.test.ts book-strategy.test.ts`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过。全量测试通过 core 174 files / 1697 tests、studio 55 files / 484 tests、cli 38 files / 209 tests。
- TASK-003A 复审验证：2026-07-17 在 Linux 沙箱 Node 22.22.3、pnpm 9.15.9 下按包/分片重跑 typecheck、全量测试和 build 均通过（cli 1 项发布打包测试因沙箱单命令 45 秒限制未执行，与本任务无关）；npm registry 因本机安全软件拦截改走 npmmirror 镜像，lockfile 未变更。Major-1 修复后精确测试 39 项回归通过。
- TASK-003B 实现验证：2026-07-17 同环境下新增编排器/审核测试 28 项通过；TASK-003 精确测试共 67 tests；core 全量 175 files / 1725 tests、studio 484、cli 208/209（同一沙箱限制项）与三包 build 全部通过。
- TASK-004 最终验证：2026-07-17，Windows Node 24.18.0、pnpm 9.15.9；TASK-004 精确测试 4 files / 95 tests；core 1792 tests、studio 484 tests、CLI 209 tests；三包 typecheck/build 全部通过。CLI 长测试按 45 秒环境限制分批，未跳过用例。

详见 [InkOS 基线分析](02-inkos-baseline.md)。

## 已确认架构决策

- [ADR-001](decisions/ADR-001-volume-first-mvp.md)：第一阶段采用单本走量小说 MVP；
- 优先扩展和组合，不直接重写 InkOS 核心；
- 故事权威状态与商业运营数据分离；
- 保留人工最终审核和人工发布；
- TASK-003 商业完整管线重试固定为 0，只保留 Provider 现有有限重试；
- TASK-003A 先交付策略和商业状态，TASK-003B 再交付薄编排器；
- TASK-004 使用按书 JSONL 追加账本、写入时价格快照和运行级计量；多模型按主模型估算并标记 approximate；编排器事件 fail-open 且不污染生产结果；
- BIZ-001 只授权纯文档市场发现；生成短故事不得提交 Git，真实投稿继续保留人工闸门。

## 当前风险

- 第 1 章记录 67,637 tokens；体验期间额外生成的第 2 章记录 162,749 tokens，实际成本和计费口径仍需独立核对；
- TASK-004 已提供商业运行级 token/成本账本，但 Provider 调用次数和内部重试仍不可观测；
- 原始 `write next --count`、`auto` 和 Scheduler 可绕过商业入口；TASK-003 只保证商业入口互斥，严格全局治理留待后续任务；
- 用户体验时多生成了第 2 章，超出 TASK-001B 的单章建议范围，但未进入 Git；
- Studio 日志出现 1 次结构化输出解析失败信号，最终管线自行恢复并完成落盘；
- 本机 LibreOffice 当前以 `0xC0000142` DLL 初始化失败；TASK-001C 的 DOCX 改用 Word 只读导出和 `pdftoppm` 完成逐页 QA；
- 官方 LLM stub 与当前 Phase 5 建书协议不兼容；
- Windows Studio E2E 启动命令不兼容；
- 系统默认 Node/pnpm 可能绕过仓库版本声明；
- 全局 Git 代理当前不可用，GitHub 命令需临时绕过代理；
- AGPL-3.0-only 对未来网络服务和分发方案有合规约束；
- 番茄活动、费率、AI 辅助、签约和版权规则可能变化，正式投稿必须重新核对作者后台和合同；
- 短篇链尚未接入 TASK-004 自动成本账本，首批试验需要手工记录模型成本和人工工时。
