# 真实模型最小冒烟验证 Runbook

## 安全边界

- 使用 Node 24.14.0、pnpm 9.15.9；
- 只在 `tmp/TASK-001B-real-model-smoke/` 创建测试项目；
- 不在命令、文档、日志或聊天中输出 API key；
- 最多一本测试书、一章正文、一次修订；
- 不修改核心代码、提示词、模型路由、审查标准或数据库结构。

## 凭证配置

Studio 使用项目 `.inkos/secrets.json`。CLI 可使用全局 `~/.inkos/.env`、项目 `.env` 或进程环境变量，并按 InkOS 配置层合成。

必需配置名称：

```text
INKOS_LLM_PROVIDER
INKOS_LLM_SERVICE
INKOS_LLM_BASE_URL
INKOS_LLM_MODEL
INKOS_LLM_API_KEY
```

不要把真实值写入本 Runbook。推荐在 Studio 服务配置页保存项目密钥，或使用用户认可的秘密管理器注入进程环境。

## 验证命令

在仓库根目录确认工具链并执行：

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
node packages/cli/dist/index.js init tmp/TASK-001B-real-model-smoke
```

进入测试项目后：

```powershell
node ..\..\packages\cli\dist\index.js doctor
node ..\..\packages\cli\dist\index.js book create --title "TASK-001B真实模型测试书" --genre urban --platform tomato --target-chapters 1 --chapter-words 800 --brief brief.md
node ..\..\packages\cli\dist\index.js plan chapter
node ..\..\packages\cli\dist\index.js write next
node ..\..\packages\cli\dist\index.js audit
```

只有审查结果要求修订时，最多执行一次：

```powershell
node ..\..\packages\cli\dist\index.js revise
```

## 结果检查

- 记录 Provider、模型、Base URL 类型、调用次数、耗时、重试、错误和 token usage，不记录密钥；
- 确认故事基础、章节计划、正文、审查报告和 metadata 存在；
- 检查 `story/state/*.json`、Markdown 投影、快照和 `story/memory.db`；
- 确认 SQLite 的 `facts`、`chapter_summaries`、`hooks` 只属于当前测试 `book_id`；
- 不在报告中粘贴整章正文。

## Git 安全检查

```powershell
git status
git diff --check
git diff
```

确认 `.env`、`.inkos/`、`books/`、数据库、日志和测试正文均未进入 Git。
