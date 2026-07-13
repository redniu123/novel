# InkOS 1.7.0 功能教程与缺口指南

副标题：面向单本走量小说前 20-30 章可控生产的使用手册与二次开发地图

文档版本：1.0
适用代码：InkOS 1.7.0，基线提交 `7ac8d530557154653cdac83c07dd7488c1460191`
编制日期：2026-07-13
适用项目：基于 InkOS 的小说智能体

> 阅读结论：InkOS 已经提供“建书 - 规划 - 编排 - 写作 - 审查 - 修订 - 状态结算 - 人工通过 - 导出”的大部分技术底座，真实模型单章主链也已通过。当前先完成 TASK-002 的设计与评审，再决定最小 production_mode 实现；可审计成本账本和商业运营层继续保持独立边界。

## 阅读导航

本书分为四部分：

1. 第一部分帮助第一次接触 InkOS 的人理解它是什么，以及当前哪些结论已经被验证。
2. 第二部分给出从安装到生成、审查、人工通过和导出的完整教程。
3. 第三部分解释 Studio、CLI、Agent、状态、记忆和模型配置等主要功能。
4. 第四部分对照本项目目标，给出缺口矩阵、优先级和后续开发地图。

如果只想尽快跑通主线，阅读第 1、3、4、5、6、7 章；如果准备二次开发，再继续阅读第 9 至 16 章。

# 第一部分：先认识 InkOS

## 1. InkOS 是什么

InkOS 是一个本地优先的故事创作智能体系统。它把模型调用、长篇小说生产、短篇、同人、续写、翻译、互动世界和 Web 工作台组织在同一个项目中。对本项目最有价值的是长篇小说生产线：

```text
创作简报
  -> 建书与基础设定
  -> 章节意图规划
  -> 上下文与规则编排
  -> 正文生成
  -> 连续性与质量审查
  -> 必要修订
  -> 故事状态结算与记忆同步
  -> 人工通过或驳回
  -> TXT / Markdown / EPUB 导出
```

InkOS 不是一个只靠单次 Prompt 续写正文的工具。它在每本书内部维护角色、地点、关系、资源、事件、时间、伏笔和章节摘要，并在每章结束后更新结构化状态和可读投影。

InkOS 也不是现成的商业运营系统。原版可以记录 token、审查结果和章节统计，但没有独立的货币成本账本、市场选题工作台、商业总编、真实读者反馈闭环、平台账号管理或自动发布能力。

![InkOS 整体系统架构](../assets/arch-system.svg)

### 1.1 本项目只取其中一条主线

本项目第一阶段已经冻结为“单本走量小说前 20-30 章可控生产”。因此当前主线是：

- 一次集中做好一本书，不做多书并发运营；
- 使用规划、写作、审查、修订、状态和记忆能力；
- 每章保留人工最终通过；
- 最终发布由人工完成；
- 商业运营数据与故事权威状态分离；
- 优先扩展和组合，不直接重写 InkOS 核心。

Studio Play、互动影游、短篇、翻译、守护进程和自动多书调度都是真实存在的功能域，但不是第一阶段的交付中心。

## 2. 如何判断一项功能“真的可用”

本书使用四个证据等级，避免把上游宣传、代码存在和真实运行混为一谈。

| 等级 | 含义 | 当前示例 |
| --- | --- | --- |
| A：本机实测 | 在当前 Windows 环境实际运行并留下结果 | 安装、构建、2351 项测试、CLI、Studio、真实 doctor、AI 建书、章节规划、正文、自动审查、状态与 SQLite 写入 |
| B：代码与测试确认 | 当前代码有实现和自动测试，但本轮没有完整执行相应人工或模型动作 | 实际修订改写、人工批准/驳回、导出、模型路由、状态回滚 |
| C：上游声明或扩展域 | README 和代码入口存在，但没有纳入本项目基线的端到端验收 | 短篇、封面、Play、互动影游、翻译、Radar、守护进程 |
| D：未验证或缺失 | 尚无项目级验收，或原版没有满足项目要求 | 20-30 章稳定生产、货币成本账本、自动发布 |

### 2.1 当前基线结论

截至 2026-07-13：

- InkOS 版本为 1.7.0；
- Node 24.14.0、pnpm 9.15.9 下冻结安装成功；
- 构建和类型检查通过；
- 265 个测试文件、2351 项测试全部通过，0 failed、0 skipped；
- CLI 和 Studio 服务入口已实际启动；
- 隔离项目初始化成功；
- SQLite 的 `facts`、`chapter_summaries`、`hooks` 完成实际建表和写入；
- `openai/custom` Provider 下的真实 `doctor`、AI 建书、章节规划、正文、自动审查、状态结算和 SQLite 写入已经通过；
- 第 1 章最终 3,617 字，状态为 `ready-for-review`，记录 2 条审查问题；配置门槛未触发修订，因此实际改写次数为 0；
- 官方 LLM stub 与当前建书基础设定协议不兼容，不能用来伪造成功；
- Windows 下 Studio Playwright E2E 启动命令仍使用 POSIX 语法，测试没有开始。

所以正确表述是：原版非模型底座和真实模型单章主链可信；20-30 章稳定性、实际修订改写、统一成本审计和 Windows Studio E2E 仍待独立验收。

### 2.2 TASK-001B 真实模型边界

本次真实模型验证使用 `openai` Provider、`custom` Service 和 `gpt-5.6-sol`，Base URL 只记录为第三方 HTTPS OpenAI-compatible 中转，不在文档中保留完整地址或密钥。

实测结果：

- `doctor` 的认证、网络、Chat Completions、流式响应和模型探针通过；探针约 7.4 秒，记录 4,393 tokens；
- AI 建书、章节规划、正文、自动审查、故事状态、Markdown 投影、快照和 SQLite 写入完成；
- 第 1 章记录 67,637 tokens，没有应用修订，人工最终批准仍由用户决定；
- 用户体验期间额外生成了第 2 章，记录 162,749 tokens；它是范围偏差，不属于 TASK-001B 验收样本，也没有进入 Git；
- 两章合计 230,386 tokens。原版没有统一持久化 Provider 调用次数、精确重试次数、建书 token、阶段耗时或货币成本，不能从现有数据推断这些数值；
- Studio 日志出现 1 次结构化输出解析失败信号，最终管线自行恢复并完整落盘。

SQLite 以 `books/<book_id>/story/memory.db` 的每书独立路径实现物理隔离；`facts`、`chapter_summaries`、`hooks` 表本身没有 `book_id` 列。验证结束时三表分别为 12、2、11 行，这些计数包含用户额外生成的第 2 章。

# 第二部分：从零跑通一本书

## 3. 环境准备

### 3.1 推荐版本

当前仓库已经固定：

```text
Node.js 24.14.0
pnpm 9.15.9
InkOS 1.7.0
```

项目声明最低 Node 20、pnpm 9，但本项目的可重复基线使用上面的精确版本。不要直接使用本机旧 Node 18 或 pnpm 11 作为生产验证环境。

### 3.2 从当前源码运行

在仓库根目录执行：

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

源码构建后的 CLI 入口是：

```powershell
node packages/cli/dist/index.js --version
```

为减少后续命令长度，可以在当前 PowerShell 会话中定义：

```powershell
$Repo = "E:\Users\zhubinhua\Desktop\小说智能体"
function inkos-local {
  node "$Repo\packages\cli\dist\index.js" @args
}
inkos-local --version
```

本书后续统一写成 `inkos`。使用源码时，把它替换为 `inkos-local`；通过 npm 全局安装时直接使用 `inkos`。

### 3.3 初始化独立创作项目

不要在 InkOS 源码根目录直接生成正式小说。建议在源码仓库之外建立独立目录：

```powershell
inkos init E:\NovelProjects\first-volume-novel
Set-Location E:\NovelProjects\first-volume-novel
inkos doctor
```

初始化后至少会出现 `inkos.json`、`books/`、`radar/` 以及本地忽略配置。正式项目的小说正文、数据库、日志和密钥都不应进入 InkOS 源码 Git。

## 4. 配置模型与密钥

### 4.1 推荐：在 Studio 的“服务”页配置

进入已经初始化的小说项目目录，执行：

```powershell
inkos studio -p 4567
```

或直接执行 `inkos`。根命令默认启动 Studio，端口为 4567。

打开浏览器后进入“服务”：

1. 选择服务商或自定义 OpenAI-compatible 服务；已有项目 `.env` 时可使用“导入环境配置”。
2. 确认 Provider、Service、Base URL、模型和 API Key 字段已导入。
3. 测试连接并保存。
4. 回到项目执行 `doctor` 或在 Studio 诊断页复查。

Studio 运行时使用项目内 `.inkos/secrets.json`，不会把密钥写入 `inkos.json`。环境配置导入后也由官方接口写入该 secrets 文件；它必须被 Git 忽略。

![InkOS Studio 首页](../assets/studio-dashboard.png)

### 4.2 CLI、daemon 和部署环境

CLI 可以读取用户全局 `~/.inkos/.env`、项目 `.env`、当前进程环境变量和一次性命令参数。关键变量是：

```text
INKOS_LLM_PROVIDER
INKOS_LLM_SERVICE
INKOS_LLM_BASE_URL
INKOS_LLM_MODEL
INKOS_LLM_API_KEY
```

安全原则：

- 不在聊天、文档、截图和命令历史中粘贴真实密钥；
- 不把密钥写入 `inkos.json`；
- 不提交 `.env`、`.inkos/secrets.json`、Cookie 或服务账号信息；
- 教程和测试报告只记录 Provider、模型、Base URL 类型和错误，不记录 key 值。

### 4.3 配置分层

InkOS 有三种有效配置模式：

| 模式 | 使用者 | 规则 |
| --- | --- | --- |
| `studio-project` | Studio | 只使用项目服务配置与 `.inkos/secrets.json`，忽略 env 覆盖 |
| `cli-project` | CLI、daemon | 以项目服务配置为基础，叠加全局 env、项目 env、进程 env 和 CLI 参数 |
| `legacy-env` | 旧项目 | 兼容只使用 env 的配置方式 |

不同 Agent 可以单独路由模型：

```powershell
inkos config set-model writer <model> --provider <provider>
inkos config set-model auditor <model> --provider <provider>
inkos config show-models --json
```

本项目在真实成本数据出现之前，不建议一开始就做复杂多模型路由。先用一个稳定模型跑通最小链路，再比较 Writer、Auditor、Reviser 的质量和成本。

## 5. 创建一本书

### 5.1 先写创作简报

建议先创建 `brief.md`，至少包含：

- 题材、平台和目标读者；
- 一句话卖点；
- 主角身份、核心欲望和不可破坏的人设；
- 世界观边界、力量或资源规则；
- 前 20-30 章的主要矛盾、阶段目标和爽点节奏；
- 必须保留与必须避免的内容；
- 单章目标字数和人工审核标准。

简报不是越长越好。它应表达稳定边界，不能把每章临时指令都混在长期设定里。

### 5.2 先选对 Studio 建书入口

Studio 有两条建书路径：

- 对话式建书：在 Book Chat 中描述想法，由模型推断题材和平台，并在没有明确指定时使用默认目标章数与每章字数。这里不会展示完整参数表单；
- 直接表单：进入“新建书籍”或地址 `#/book/new`，可明确填写书名、题材、平台、目标章数、每章字数和创作简报。

需要复现实验参数时应使用直接表单。中文直接表单的每章字数最小值是 1000，因此 `urban`、`tomato`、目标章数 1、每章 800 字不是可提交的表单组合；最小可用值应改为 1000。

### 5.3 执行建书

```powershell
inkos book create `
  --title "示例书名" `
  --genre urban `
  --platform tomato `
  --target-chapters 30 `
  --chapter-words 2500 `
  --brief .\brief.md
```

建书会调用 Architect 生成基础设定，因此必须配置合法模型凭证。TASK-001B 已在真实模型下验证这一链路。

### 5.4 建书成功后应检查什么

不要只看命令返回成功。至少检查：

1. `books/<book_id>/book.json` 中的书名、题材、平台、章节数和字数正确。
2. `story/outline/`、`story/roles/` 和书级规则文件已生成。
3. `story/author_intent.md` 保留了长期创作意图。
4. `story/current_focus.md` 可用于最近 1-3 章的动态控制。
5. `story/state/` 的结构化状态可以解析。
6. `inkos status <book_id> --json` 能读取书籍。

### 5.5 多书项目中的 `book_id`

InkOS 的数据目录以 `books/<book_id>/` 隔离，章节、状态、快照和 `memory.db` 都在书籍目录内部。只有一本书时，大多数命令可以省略 `book_id`；有两本以上时必须显式指定，避免误操作。

本项目第一阶段只生产一本书，但所有未来新增的运营数据仍必须包含 `book_id`，不能依赖“当前只有一本书”的隐含假设。

## 6. 控制一章的输入

### 6.1 三层控制思路

一章写得是否可控，取决于三种不同时间尺度的输入：

| 层级 | 文件或参数 | 作用 |
| --- | --- | --- |
| 长期 | `story/author_intent.md`、书级规则、故事框架 | 决定这本书长期是什么、不是什么 |
| 近期 | `story/current_focus.md` | 决定未来 1-3 章当前要解决什么 |
| 本章 | `--context`、章节 intent | 决定下一章必须保留、避免和推进的具体事项 |

不要把临时场景要求写进世界观，也不要让一句 `--context` 覆盖已经批准的长期规则。

### 6.2 规划章节

```powershell
inkos plan chapter <book_id> `
  --context "本章推进师徒信任破裂；必须保留上一章受伤状态；暂不揭晓幕后身份" `
  --json
```

`plan chapter` 会调用模型，生成下一章的 `intent.md`。它应该包含本章目标、must-keep、must-avoid、冲突处理等信息。

### 6.3 编排上下文

```powershell
inkos compose chapter <book_id> --json
```

`compose chapter` 主要编译本地控制文档和故事状态，不要求在线模型。它会生成：

```text
story/runtime/chapter-XXXX.intent.md
story/runtime/chapter-XXXX.context.json
story/runtime/chapter-XXXX.rule-stack.yaml
story/runtime/chapter-XXXX.trace.json
```

在正式写作前抽查这些文件：本章有没有带入正确角色、当前状态、伏笔和规则；过时信息有没有压过当前指令；上下文是否出现不属于本书的内容。

### 6.4 输入治理模式

项目配置 `inputGovernanceMode` 默认为 `v2`。它把规划、编排和写作分开，并记录本章实际选入的上下文。`legacy` 只用于兼容回退，不应作为新项目默认。

## 7. 写作、审查、修订与人工通过

![InkOS 章节生产管线](../assets/arch-pipeline.svg)

### 7.1 两种推荐工作方式

第一种是可观察的原子流程，适合 Provider 兼容问题调试和建立成本基线：

```powershell
inkos plan chapter <book_id> --context "本章目标..." --json
inkos compose chapter <book_id> --json
inkos draft <book_id> --words 2500 --json
inkos audit <book_id> <chapter> --json
inkos revise <book_id> <chapter> --mode spot-fix --json
inkos review approve <book_id> <chapter> --json
```

第二种是完整管线，适合流程稳定后的单章生产：

```powershell
inkos write next <book_id> --words 2500 --json
inkos review list <book_id> --json
inkos review approve <book_id> <chapter> --json
```

完整管线默认执行规划、编排、写作、审查、必要修订和状态结算。默认自动修订次数为 1，但最终仍需要人工通过。

### 7.2 审查模式

项目级配置支持：

```powershell
inkos config set writing.reviewMode auto
inkos config set writing.reviewRetries 1
inkos config set writing.revisionGate strict
```

- `auto`：写完后自动审查，必要时按次数修订，再进入待人工审核状态。
- `manual`：写完即停，不进入自动审查和修订；人工再执行 `audit`、`revise`。
- `reviewRetries`：0-10，默认 1；不是无限循环。
- `revisionGate strict`：只有关键指标不变差且至少一类问题改善时才应用修订。
- `lenient`：只要指标不变差即可应用。
- `always`：始终应用人工修订，风险最高。

TASK-001B 已验证原版完整单章管线。后续若核对各阶段成本或 Provider 兼容性，使用原子流程；批量生产前先完成 `production_mode` 设计与评审，不能依赖散落的默认值。

### 7.3 章节状态

常见状态包括：

- `ready-for-review`：审查通过或已完成流程，等待人工确认；
- `audit-failed`：仍有问题，需要人工判断或继续修订；
- `state-degraded`：正文保存了，但故事状态结算失败；必须先修复状态，不能继续写下一章；
- `approved`：人工通过；
- `rejected`：人工驳回。

`inkos write repair-state <book_id> <chapter>` 用于修复最新的 `state-degraded` 章节，不重写正文。`inkos write sync` 可在人工编辑章节正文后重建 truth 文件和 SQLite 索引。

### 7.4 人工审核清单

人工通过前至少检查：

- 本章是否完成既定目标，结尾是否产生下一章推动力；
- 主角人设、能力、资源和关系是否连续；
- 时间、地点和信息知情边界是否自洽；
- 伏笔是推进、延后还是回收，状态是否正确；
- 字数、段落节奏、对话比例和平台风格是否合格；
- 审查报告中的 critical、warning 是否可接受；
- 修订后是否引入新的逻辑问题；
- `story/state/`、Markdown 投影和章节摘要是否与正文一致。

通过：

```powershell
inkos review approve <book_id> <chapter>
```

驳回：

```powershell
inkos review reject <book_id> <chapter> --reason "人物知情边界错误"
```

警告：默认驳回会回滚到该章之前，并丢弃依赖它的后续章节、快照和运行时产物。`--keep-subsequent` 只标记本章而不回滚，可能留下状态不一致，只有在明确制定修复方案时才使用。

### 7.5 重写与人工编辑

```powershell
inkos write rewrite <book_id> <chapter> --brief "保留事件结果，重写冲突过程"
```

重写指定章节会涉及状态快照恢复和后续依赖。不要在已经连续生成多章后随意重写早期章节。

如果人工直接编辑章节 Markdown，编辑后必须执行 `write sync`，重新审查，并确认状态投影与 SQLite 索引同步。原版路线图仍把“重写半章并级联更新后续 truth 文件”列为未来能力，因此当前不应把局部改写当成成熟功能。

## 8. 导出与发布

InkOS 可以导出 TXT、Markdown 和 EPUB：

```powershell
inkos export <book_id> --format txt --approved-only
inkos export <book_id> --format md --approved-only
inkos export <book_id> --format epub --approved-only
```

第一阶段应始终使用 `--approved-only`，防止待审或失败章节进入交付物。

原版没有番茄、起点等平台专用格式导出，也没有自动登录和发布。平台格式导出仍在上游路线图中；自动发布明确不属于第一阶段。正确流程是人工检查导出文件，再人工发布。

# 第三部分：功能全景

## 9. Studio：面向日常使用的工作台

Studio 是本项目最适合非开发人员使用的入口。默认端口 4567，项目根目录来自 CLI 启动参数、`INKOS_PROJECT_ROOT` 或当前工作目录。

### 9.1 主要页面和能力

| 区域 | 主要能力 | 第一阶段用途 |
| --- | --- | --- |
| 首页 / 我的创作 | 查看书籍、进度、创建入口 | 进入当前单书 |
| 长篇小说 / Book Chat | 对话式建书、控制和生产 | 主入口之一 |
| 书籍设置 | 字数、目标章节、状态、审查模式 | 固化单书配置 |
| 章节阅读 | 查看和编辑章节、审查、修订、通过/驳回 | 人工审核核心 |
| 真相文件 | 查看故事规则、状态、伏笔和摘要 | 连续性复核 |
| 数据分析 | 章节统计、审查问题、token 用量 | 基础观测，不是货币成本账本 |
| 模型配置 | 服务、模型、密钥和连接测试 | 推荐配置入口 |
| 项目设置 | 语言、输入治理、提示词、Skill 等 | 高级配置 |
| 诊断 | 环境与模型连接排查 | 冒烟前必查 |
| 题材 / 文风 / 导入 / Radar | 扩展创作工具 | 后续按需使用 |
| 守护进程 / 日志 | 自动生产和运行日志 | 第一阶段不建议自动放开 |

### 9.2 Studio 建书入口

“长篇小说 / Book Chat”是对话式入口，适合用自然语言说明创意；模型会推断题材、平台等字段，并在未明确提供时采用默认目标章数和每章字数。它不是参数表单，因此在聊天页看不到 `urban`、`tomato`、目标章数和每章字数的独立控件。

需要精确控制时进入首页“新建书籍”的直接表单，或访问 `#/book/new`。中文直接表单允许填写书名、题材、平台、目标章数、每章字数和创作简报，其中每章字数最小值是 1000。

### 9.3 Studio Chat 的执行边界

Studio Chat、TUI、CLI Agent 和外部 `interact` 共享一套 action surface。聊天中的模型口头回答不等于任务完成；真正完成必须有工具结果和落盘产物。创建、删除、写章等重动作应先出现确认卡。

### 9.4 常见 `Failed to fetch`

如果 Studio 页面仍开着，但启动它的终端进程已经停止，浏览器继续请求后端会显示 `Failed to fetch`。这通常表示服务已停止，不代表 `inkos.json` 一定损坏。回到正确项目目录重新启动 Studio，并保持进程运行。

## 10. CLI 命令地图

### 10.1 项目与诊断

| 命令 | 作用 |
| --- | --- |
| `inkos init [name]` | 初始化项目 |
| `inkos doctor` | 检查 Node、SQLite、项目和模型配置 |
| `inkos status [book_id] --chapters` | 查看书籍和章节状态 |
| `inkos config show` | 查看项目配置 |
| `inkos config show-models` | 查看 Agent 模型路由 |
| `inkos studio -p 4567` | 启动 Web 工作台 |
| `inkos tui` | 启动终端全屏工作台 |

### 10.2 书籍与章节主线

| 命令 | 作用 |
| --- | --- |
| `book create/update/list/delete` | 建书、改设置、列书、删除书 |
| `plan chapter` | 生成下一章意图 |
| `compose chapter` | 编译上下文、规则栈和 trace |
| `draft` | 只写草稿，不自动审查/修订 |
| `write next` | 运行完整章节管线 |
| `audit` | 审查指定或最新章节 |
| `revise` | 按审查问题修订章节 |
| `review list/approve/approve-all/reject` | 人工审核 |
| `write rewrite` | 重写指定章节 |
| `write sync` | 人工编辑后重建状态和记忆 |
| `write repair-state` | 修复状态降级章节 |
| `export` | 导出 TXT、Markdown、EPUB |

`book delete` 和默认 `review reject` 都具有破坏性，必须先理解影响范围，不要在自动脚本中默认加 `--force`。

### 10.3 质量、观测与长书维护

| 命令 | 作用 | 限制 |
| --- | --- | --- |
| `analytics` | 审查通过率、问题频率、章节排名、token 用量 | 不包含完整货币成本审计 |
| `eval` | 输出结构化质量报告 | 需要模型或相应实现，未做真实基线 |
| `detect` | AIGC 检测和统计 | 依赖检测服务配置 |
| `consolidate` | 将章节摘要归并为卷级摘要 | 更适合长书，前 20-30 章不是首要瓶颈 |
| `auto` | 自动写到目标章节 | 第一阶段禁止在未验证前放开 |
| `up/down` | 启停守护进程 | 支持调度、并发和通知，但不符合当前单书人工闸门重点 |

### 10.4 扩展创作命令

| 功能 | 命令 |
| --- | --- |
| 自然语言 Agent | `agent`、`interact` |
| 市场扫描 | `radar scan` |
| 题材管理 | `genre list/show/create/copy` |
| 文风指纹 | `style analyze/import` |
| 续写导入 | `import chapters` |
| 正典/番外导入 | `import canon` |
| 同人 | `fanfic init/show/refresh` |
| 短篇 | `short run` |
| 翻译 | `translate init/run/export` |

这些入口说明 InkOS 的平台面很广，但不意味着每个入口都已经满足本项目的商业验收标准。

## 11. 多 Agent 与章节流水线

### 11.1 核心角色

| Agent | 职责 |
| --- | --- |
| Architect | 建书和基础设定 |
| Planner | 把长期意图、近期焦点和本章指令整理为章节意图 |
| Composer | 选择上下文并编译规则栈和 trace |
| Writer | 生成正文并结算章节状态输入 |
| Continuity Auditor | 检查连续性、质量和 AI 痕迹 |
| Reviser | 根据问题做局部修复、润色、重写或反检测修订 |
| Length Normalizer | 正文明显偏离 hard range 时最多做一次压缩或扩写 |
| State Validator | 在落盘前校验 truth 变化和结构化状态 |
| Consolidator | 长书阶段归并摘要、降低上下文压力 |

### 11.2 一章中的真实事务边界

`PipelineRunner.writeNextChapter` 会先取得单书写锁，然后：

1. 加载书籍配置和控制文档。
2. 计算下一章编号。
3. 准备 intent、context package 和 rule stack。
4. Writer 生成正文。
5. 根据审查模式运行 Auditor 和 Reviser。
6. 运行长度、标题、段落、敏感词、伏笔等确定性检查。
7. 生成并校验状态 delta。
8. 写入章节正文、metadata 和章节索引。
9. 更新结构化状态、Markdown 投影和 SQLite 记忆。
10. 创建章节快照并释放写锁。

模型调用失败、状态校验失败和内容审查失败是不同类型的问题。排查时要先看章节状态和错误阶段，不能一律归因于“模型不好”。

### 11.3 字数治理

`--words` 是目标，不是逐字精确值。中文按字符、英文按单词计数。超出允许区间时最多追加一次归一化；仍超出 hard range 会保存章节并留下 warning，而不是硬截断正文。

## 12. 故事权威状态与长期记忆

![InkOS 长期记忆结构](../assets/arch-memory.svg)

### 12.1 三层记忆

| 层 | 典型位置 | 角色 |
| --- | --- | --- |
| 权威结构化状态 | `story/state/*.json` | 程序校验和后续计算的事实来源 |
| 人类可读投影 | `story/*.md` | 供作者和审稿人阅读、复核 |
| 时序检索记忆 | `story/memory.db` | 按相关性检索历史事实、摘要和伏笔 |

结构化状态至少包括：

```text
story/state/manifest.json
story/state/current_state.json
story/state/hooks.json
story/state/chapter_summaries.json
```

SQLite 每本书一个数据库，路径为 `books/<book_id>/story/memory.db`，主要表为：

- `facts`：带有效起止章节的时序事实；
- `chapter_summaries`：章节摘要和状态变化；
- `hooks`：伏笔状态、推进章节和预期回收。

### 12.2 为什么既有 JSON 又有 Markdown

JSON 是程序权威状态，可通过 Zod schema 校验；Markdown 是人类可读投影。模型不再直接重写整份状态文档，而是输出 JSON delta，由代码做 immutable apply、校验和投影生成。

人工可以阅读 Markdown，但不应绕开同步机制随意修改 JSON 或数据库。需要人工改正文时，使用 `write sync` 让系统重新结算。

### 12.3 伏笔状态

伏笔状态限定为 `open`、`progressing`、`deferred`、`resolved`，并可记录预期回收时机、依赖关系和推进次数。它解决的是“故事中已经发生了什么和还欠什么”，不是市场表现或商业价值。

### 12.4 快照和回滚

每章会在 `story/snapshots/<chapter>/` 保存状态快照。重写和驳回可以恢复快照并清理后续依赖。这是安全网，但不是无成本的版本控制；越早的章节被修改，后续状态和正文受影响越大。

## 13. 配置、可靠性与安全边界

### 13.1 可靠性能力

原版已经提供：

- 单书写锁和异常锁恢复；
- `AbortSignal` 贯穿 Agent、管线和模型请求；
- 429、502、503 等瞬态错误最多两次额外重试，约 0.8 秒和 1.6 秒退避；
- OpenAI Chat Completions 和 Responses 兼容；
- 流式和非流式调用；
- 模型服务与模型归属校验；
- 章节状态降级和修复入口；
- 快照、回滚和章节索引恢复；
- 确定性写后检查，减少不必要模型调用。

普通内容调用没有统一默认硬超时。生产层后续需要明确单阶段超时、整章超时、取消和重试预算。

### 13.2 数据边界

以下属于故事权威状态：角色事实、地点、关系、资源、事件、时间、伏笔、章节摘要、作者意图和创作规则。

以下属于商业运营数据，不应写入故事状态：模型价格、货币成本、渠道、发布时间、平台数据、曝光、点击、完读、评论、人工工时、选题评分、实验分组和收入。

未来运营层应使用独立目录或数据库，并以 `book_id`、`chapter_number`、`run_id` 关联，不修改 `story/state` 的职责。

### 13.3 Git 与内容安全

不得提交：

- API Key、Cookie、账号信息和 secrets；
- 生成小说正文和正式书籍数据；
- `memory.db`、测试数据库；
- `inkos.log` 和缓存；
- 本地 `.env`；
- 未脱敏的模型请求和响应日志。

InkOS 使用 AGPL-3.0-only。未来如果提供网络服务、对外分发修改版或与闭源商业系统集成，必须单独进行许可证合规评估。

## 14. 扩展功能：知道它们存在，但不要偏离主线

### 14.1 Radar

Radar 提供市场扫描入口，可作为未来选题数据的一部分，但它不等于完整市场选题系统。当前缺少对数据来源、授权、时效、可审计评分和商业决策闭环的项目级验收。

### 14.2 文风与 AIGC 检测

`style analyze/import` 可以提取统计文风指纹并生成风格指南；`detect` 可以接入 GPTZero、Originality 或自定义检测服务。检测分数不能代替人工质量判断，也不能作为唯一发布门槛。

### 14.3 续写、同人和番外

`import chapters` 能导入已有章节并逆向重建状态；`fanfic` 支持 canon、au、ooc、cp；`import canon` 支持番外读取正典。这些流程涉及版权、来源授权和事实重建质量，必须另设任务验证。

### 14.4 短篇、封面、Play、互动影游与翻译

原版提供独立短篇链、封面图片、开放世界、分支互动、互动影游和多语言翻译。它们共享部分模型配置和交互入口，但状态模型不同。第一阶段不应为了“功能齐全”把这些生产线混入单本长篇验收。

# 第四部分：我们还缺什么

## 15. 原版能力与项目目标对照

| 第一阶段要求 | 原版能力 | 证据 | 当前判断 |
| --- | --- | --- | --- |
| 生成故事规划 | Architect、Planner、outline 和 intent | A/B | 真实单章链路已通过，可复用 |
| 生成前 20-30 章 | `write next`、`auto`、daemon | B，20-30 章 D | 管线存在，稳定性未验收 |
| 控制自动修订次数 | `writing.reviewRetries`，0-10，默认 1 | A/B | 决策链已验证，实际修订改写尚未触发；仍需产品 preset |
| 连续性检查 | 结构化状态、Auditor、写后规则 | A/B | 自动审查、状态与投影已实测，可复用 |
| 人工最终审核 | review list/approve/reject、Studio UI | A/B | `ready-for-review` 边界已实测；批准/驳回仍由人工执行 |
| 人工发布 | approved-only 导出 | B | 可复用；无自动发布 |
| 模型成本数据基础 | chapter token usage、analytics | A/B | 真实 token 已记录，无可审计货币成本 |
| 所有小说按 `book_id` 隔离 | 每书目录、每书 SQLite、单书锁 | A/B | 底座存在；新增运营层仍须遵守 |
| 市场选题与商业总编扩展 | Radar 和 Agent 扩展入口 | C | 不是完整商业层 |
| 真实反馈闭环 | 无项目级实现 | D | 后续独立开发 |

## 16. 缺口矩阵与建议任务顺序

### 16.1 第一阶段必须补齐

| 优先级 | 缺口 | 为什么必须先做 | 建议任务 |
| --- | --- | --- | --- |
| 已完成 | 合法凭证下的真实模型最小端到端 | TASK-001B 已取得单章实证 | 保留当前证据；不要把一章结果外推为 20-30 章稳定性 |
| P0 | 可重复的 `production_mode` | 默认配置分散，无法保证每次使用同一审查和修订策略 | TASK-002：先完成设计文档与评审，获批后才实现 |
| P0 | 20-30 章验收协议 | 一章成功不能证明连续生产 | 新任务：固定题材、模型、字数、人工门槛和停止条件 |
| P1 | 独立货币成本账本 | token 不能直接等于真实费用，缺少价格版本和重试归因 | 新任务：运营数据边界、run/chapter/agent 级账本 |
| P1 | 人工审核工作台最小增强 | 需要记录通过理由、修改量和阻塞问题 | 新任务：不改故事状态职责，独立保存审核事实 |
| P1 | Windows Studio E2E | 当前 UI 回归验证在 Windows 未启动 | 新任务：跨平台启动命令和最小 E2E |

### 16.2 建议但不阻塞首轮 20-30 章

| 优先级 | 能力 | 说明 |
| --- | --- | --- |
| P2 | Provider/模型兼容矩阵 | 基于真实冒烟记录模型、协议、流式、耗时和失败模式 |
| P2 | 超时与调用预算 | 为建书、规划、写作、审查、修订设独立上限 |
| P2 | 质量与人工修改量统计 | 记录问题类型、修订轮数、人工改动比例，不写入故事状态 |
| P2 | 商业总编最小层 | 读取故事产物和运营事实，给建议但不直接改权威状态 |
| P2 | 市场选题数据接入 | 先解决数据来源、授权和可追溯性，再做评分 |
| P3 | 读者模拟和真实反馈 | 先积累真实章节与审核数据，再校准模拟结果 |

### 16.3 第一阶段明确不做

- 多本或多账号并行运营；
- 自动登录或自动发布到内容平台；
- 大规模抓取完整小说正文；
- 根据评论实时改写已发布正文；
- 完全无人审核；
- 深度头牌小说优化；
- 重写 InkOS 核心；
- 未完成合规评估的闭源 SaaS 化。

### 16.4 推荐开发顺序

```text
TASK-001B 真实模型冒烟（已完成）
  -> TASK-001C 教程归档（已完成）
  -> TASK-002 设计文档与 Claude Code 审查
  -> 设计获批后再实现 TASK-002 最小 production_mode
  -> 单本 3 章小样验证
  -> 独立成本账本最小版
  -> 单本 10 章稳定性验证
  -> 人工审核记录与质量指标
  -> 单本 20-30 章验收
  -> 再评估市场、总编、反馈和多书能力
```

TASK-001B 已完成，但 TASK-002 仍只允许进入设计阶段。设计文档获批并完成 Claude Code 审查前，不创建实现分支、不修改代码；也不要在当前数据量下先设计复杂成本或商业评分模型。

## 17. 二次开发代码地图

| 关注点 | 位置 | 开发原则 |
| --- | --- | --- |
| CLI 命令注册 | `packages/cli/src/program.ts`、`commands/` | 优先新增外围命令，不复制 core 逻辑 |
| Web 工作台 | `packages/studio/src/pages/`、`components/` | 通过 API 调用 core，保持 CLI/Studio 一致 |
| Studio API | `packages/studio/src/api/server.ts` | 保持安全校验、错误码和 SSE 进度 |
| 章节事务 | `packages/core/src/pipeline/runner.ts` | 高风险核心，非必要不改 |
| Agent | `packages/core/src/agents/` | 优先配置和组合，不平行重写 |
| 项目/书配置 | `packages/core/src/models/project.ts`、`book.ts` | 新字段必须有 schema、默认值和测试 |
| 权威状态 | `packages/core/src/models/runtime-state.ts`、`state/` | 不混入成本和运营事实 |
| 模型配置 | `packages/core/src/utils/effective-llm-config.ts` | 保持 Studio/CLI 分层和密钥边界 |
| Provider | `packages/core/src/llm/provider.ts` | 复用统一传输、重试和中断 |
| 分析 | `packages/core/src/utils/analytics.ts` | 原版以 token 为主，货币成本另建边界 |

### 17.1 哪些模块第一阶段不建议碰

- Architect、Planner、Writer、Auditor、Reviser 的核心提示词和协议；
- `PipelineRunner` 的章节持久化事务；
- `story/state` schema 和 SQLite 表结构；
- Provider 的统一传输和重试；
- Studio 和 CLI 的既有业务行为。

只有独立任务、明确验收和回归测试证明必要时，才对核心做小范围修改。

# 附录 A：一本书的目录心智模型

```text
books/<book_id>/
├─ book.json                         # 单书配置
├─ chapters/
│  ├─ index.json                    # 章节元数据、状态、审查与 token
│  └─ 0001_*.md                     # 章节正文
└─ story/
   ├─ author_intent.md              # 长期创作意图
   ├─ current_focus.md              # 近期 1-3 章焦点
   ├─ book_rules.md                 # 书级规则
   ├─ outline/                      # 故事框架、卷纲等
   ├─ roles/                        # 角色设定
   ├─ runtime/                      # intent/context/rule-stack/trace
   ├─ state/                        # 权威 JSON 状态
   ├─ current_state.md              # 当前状态投影
   ├─ pending_hooks.md              # 伏笔投影
   ├─ chapter_summaries.md          # 章节摘要投影
   ├─ snapshots/<chapter>/          # 章节状态快照
   └─ memory.db                     # SQLite 时序记忆
```

# 附录 B：单章标准作业清单

## 写之前

- [ ] 当前分支、项目目录和 `book_id` 正确。
- [ ] `doctor` 无阻塞错误。
- [ ] `author_intent.md` 和 `current_focus.md` 没有冲突。
- [ ] 上一章已经人工处理，不存在 `state-degraded`。
- [ ] 本章目标、must-keep、must-avoid 已写清楚。
- [ ] 模型、审查模式、修订次数和字数配置已记录。

## 生成时

- [ ] 查看 intent、context、rule-stack 和 trace。
- [ ] 记录调用耗时、重试和 token，不记录密钥或完整正文。
- [ ] 不在失败后无上限重试。
- [ ] 不并发写同一本书。

## 生成后

- [ ] 检查章节状态和审查报告。
- [ ] 对照人物、时间、资源、关系、知情边界和伏笔。
- [ ] 检查状态 JSON、Markdown 投影和 SQLite 同步。
- [ ] 人工通过或明确驳回；不默认批量通过。
- [ ] 只导出 approved 章节。
- [ ] Git 中没有小说、数据库、日志、密钥或缓存。

# 附录 C：常见故障排查

| 症状 | 优先检查 | 不要做什么 |
| --- | --- | --- |
| `inkos.json not found` | 是否在已初始化的项目目录 | 不要在源码根目录乱建配置 |
| Studio `Failed to fetch` | 后端进程是否仍运行、端口是否正确 | 不要直接认定 JSON 损坏 |
| `doctor` 报 key 缺失 | Studio secrets、env 层和模型服务 | 不要把 key 粘进文档或 Git |
| 建书报 foundation 不完整 | 真实模型协议、输出和 Architect 日志 | 不要用当前 stub 伪造成功 |
| 结构化输出解析失败 | 最终任务状态、重试/恢复信号和落盘完整性 | 不要只看单条 stderr，也不要无上限重试 |
| `BOOK_BUSY` | 是否有同书并发写入或活跃进程 | 不要删除真实活动锁 |
| `state-degraded` | 最新章节的 truth 校验和状态结算 | 不要继续写下一章 |
| 审查未通过 | critical/warning、修订前后指标 | 不要只凭模型口头说“已修好” |
| 字数偏差 | length warning、目标区间和 counting mode | 不要硬截断正文 |
| Windows E2E 启动失败 | Playwright webServer 的 POSIX 命令 | 不要记录成“测试通过” |
| 导出包含未审章节 | 是否使用 `--approved-only` | 不要直接上传平台 |

# 附录 D：术语表

| 术语 | 解释 |
| --- | --- |
| 权威状态 | 程序用于后续推理和校验的结构化故事事实 |
| Markdown 投影 | 从结构化状态生成的人类可读版本 |
| truth 文件 | 角色、规则、当前状态、伏笔、摘要等长期故事资料的统称 |
| intent | 下一章的目标、保留项、避免项和冲突处理 |
| context package | Composer 实际选入本章的上下文集合 |
| rule stack | 本章规则的优先级和覆盖关系 |
| trace | 本章输入如何被选择和编译的记录 |
| state delta | 一章结束后对故事状态的增量变更 |
| revision gate | 决定修订稿是否可以覆盖原稿的指标门槛 |
| state-degraded | 正文保存但状态结算不可信，需要修复的章节状态 |
| production_mode | 本项目拟新增的最小生产 preset，不是重写管线 |
| 商业运营数据 | 成本、平台、反馈、人工工时等，不属于故事权威状态的数据 |

# 附录 E：事实来源

本教程主要依据以下仓库事实编制：

- `docs/00-product-brief.md`
- `docs/PROJECT-STATUS.md`
- `docs/02-inkos-baseline.md`
- `docs/tasks/TASK-001-baseline-validation.md`
- `docs/tasks/TASK-001B-real-model-smoke.md`
- `docs/decisions/ADR-001-volume-first-mvp.md`
- `docs/runbooks/baseline-validation.md`
- `docs/runbooks/real-model-smoke.md`
- `README.md`
- `packages/cli/src/program.ts` 与 `packages/cli/src/commands/`
- `packages/studio/src/App.tsx`、`packages/studio/src/pages/`、`packages/studio/src/api/server.ts`
- `packages/core/src/pipeline/runner.ts`
- `packages/core/src/models/project.ts`、`book.ts`、`runtime-state.ts`
- `packages/core/src/state/`
- `packages/core/src/utils/effective-llm-config.ts`、`analytics.ts`
- `packages/core/src/llm/provider.ts`、`secrets.ts`
- 当前自动测试、2026-07-12 基线记录与 2026-07-13 TASK-001B 真实模型记录

本教程记录 TASK-001B 已通过的真实单章边界，但不能替代实际修订、货币成本或 20-30 章生产验收；TASK-002 设计获批前不得开始实现。
