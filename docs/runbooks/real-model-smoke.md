# 真实模型最小冒烟验证 Runbook

## 安全边界

- 使用 Node 24.14.0、pnpm 9.15.9；
- 只在被忽略的隔离项目中验证；
- 不在命令、文档、日志或聊天中输出 API Key；
- 一次验收只选择一本书的一章，最多修订一次；
- 不修改核心代码、提示词、模型路由、审查标准或数据库结构；
- Studio 新建书籍表单的中文每章字数最小值是 1000，不使用 800。

## 凭证配置

CLI 支持全局 `~/.inkos/.env`、项目 `.env` 或进程环境变量。Studio 不直接使用 env 作为运行配置，应在服务页点击“导入环境配置”，由官方接口把密钥写入项目 `.inkos/secrets.json`。

必需配置名称：

```text
INKOS_LLM_PROVIDER
INKOS_LLM_SERVICE
INKOS_LLM_BASE_URL
INKOS_LLM_MODEL
INKOS_LLM_API_KEY
```

写入前后均执行：

```powershell
git check-ignore -v 小说key.txt
git check-ignore -v tmp/TASK-001B-real-model-smoke/.env
git check-ignore -v tmp/TASK-001B-real-model-smoke/.inkos/secrets.json
```

不要把真实值写入本 Runbook、`inkos.json` 或命令参数。

## 工具链与回归检查

```powershell
$env:PATH='C:\tmp\inkos-pnpm9-bin;C:\Users\zhubinhua\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;'+$env:PATH
$env:CI='true'
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

## 初始化与连接检查

从仓库根目录执行：

```powershell
node packages/cli/dist/index.js init tmp/TASK-001B-real-model-smoke
Set-Location tmp/TASK-001B-real-model-smoke
node ..\..\packages\cli\dist\index.js doctor
```

`doctor` 的全局配置提示不影响项目级 `.env`；以 `LLM API Key` 和 `API Connectivity` 是否通过为准。

## CLI 最小链路

在测试项目目录执行：

```powershell
node ..\..\packages\cli\dist\index.js book create --title "真实模型测试书" --genre urban --platform tomato --target-chapters 1 --chapter-words 1000 --brief brief.md
node ..\..\packages\cli\dist\index.js plan chapter
node ..\..\packages\cli\dist\index.js write next
node ..\..\packages\cli\dist\index.js audit
```

只有审查决策要求修订时，最多执行一次：

```powershell
node ..\..\packages\cli\dist\index.js revise
```

人工阅读后才能批准：

```powershell
node ..\..\packages\cli\dist\index.js review list
node ..\..\packages\cli\dist\index.js review approve 1
```

Codex 不代替用户做内容质量批准。

## Studio 链路

```powershell
node ..\..\packages\cli\dist\index.js studio -p 4567
```

访问 `http://localhost:4567`。首次使用先进入“服务”，导入项目 `.env`；直接建书表单位于 `#/book/new`。对话式建书会由模型推断题材并采用默认目标章数和每章字数，若需要精确参数应使用直接表单。

## 结果检查

- 故事基础：`books/<book_id>/story/`；
- 章节计划与 trace：`books/<book_id>/story/runtime/`；
- 正文索引：`books/<book_id>/chapters/index.json`；
- 结构化状态：`books/<book_id>/story/state/`；
- Markdown 投影：`current_state.md`、`pending_hooks.md`、`chapter_summaries.md`；
- SQLite：`books/<book_id>/story/memory.db`；
- token usage：`chapters/index.json` 的 `tokenUsage`。

SQLite 当前按每本书独立数据库文件实现物理隔离，表内不包含 `book_id` 列。检查时必须确认数据库路径位于目标 `books/<book_id>/` 下。

## Git 安全检查

```powershell
git status
git diff --stat
git diff
git diff --check
git diff --exit-code -- pnpm-lock.yaml
git log --all --oneline -- 小说key.txt
```

确认 `小说key.txt`、`.env`、`.inkos/`、`books/`、数据库、日志、模型响应和小说正文均未进入 Git。

## 已知限制

- 原版不持久化统一的 Provider 调用次数、重试次数、每阶段耗时或货币成本；
- token usage 不等于货币成本；
- Windows Studio E2E 的启动命令仍含 POSIX shell 语法；
- 真实模型输出可能超出目标字数，需检查 `lengthTelemetry` 和 `lengthWarnings`。
- 单次结构化输出解析失败可能被后续流程恢复，仍应记录错误分类并检查最终落盘完整性。
