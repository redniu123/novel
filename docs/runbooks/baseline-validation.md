# InkOS 基线验证 Runbook

适用基线：InkOS 1.7.0 / `7ac8d53`
平台：Windows PowerShell；其他平台可使用等价 shell 命令

## 1. 环境要求

- Git；
- Node 20、22 或 24，不能使用 Node 18；
- pnpm 9.x，本次验证使用 9.15.9；
- 不需要全局安装 InkOS；
- 真实模型步骤需要用户在本地安全配置合法凭证。

先检查：

```powershell
git status
git remote -v
git branch --all
git log -1 --oneline
git tag --list
node --version
pnpm --version
npm --version
git --version
[System.Environment]::OSVersion.VersionString
```

若 pnpm 版本不为 9.x，请通过已有 Node 版本管理器或 Corepack 选择 pnpm 9.15.9，不要无故更新锁文件。

## 2. 安装与构建

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
```

当前 `pnpm lint` 会退出 0，但各 workspace 没有 lint script，应记录为“未配置”。构建可能报告 Studio chunk 大于 500 kB，这是警告，不是失败。

```powershell
git status --short
git diff -- pnpm-lock.yaml package.json
```

## 3. 测试

```powershell
pnpm test
```

当前基线预期：

```text
Core:   172 files, 1658 tests
Studio:  55 files,  484 tests
CLI:     38 files,  209 tests
Total:  265 files, 2351 tests, 0 failed, 0 skipped
```

Studio E2E 命令：

```powershell
pnpm --filter @actalk/inkos-studio test:e2e
```

当前 `packages/studio/playwright.config.ts` 的 `webServer.command` 使用 POSIX inline env 和进程控制语法，在原生 Windows 上会在测试启动前失败。不要记录为测试通过；应由独立修复任务改成跨平台启动方式。

## 4. CLI 验证

```powershell
node packages/cli/dist/index.js --version
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js book create --help
node packages/cli/dist/index.js plan chapter --help
node packages/cli/dist/index.js compose chapter --help
node packages/cli/dist/index.js write next --help
node packages/cli/dist/index.js audit --help
node packages/cli/dist/index.js revise --help
node packages/cli/dist/index.js export --help
node packages/cli/dist/index.js studio --help
```

预期版本为 `1.7.0`。若出现 `Invalid regular expression flags` 并指向 `/v`，通常是命令实际用了 Node 18；先修正 PATH 或版本管理器选择。

## 5. 创建隔离测试项目

```powershell
node packages/cli/dist/index.js init tmp/baseline-test-book
Set-Location tmp/baseline-test-book
node ..\..\packages\cli\dist\index.js doctor
```

`inkos init` 应生成 `.env`、`.gitignore`、`.node-version`、`.nvmrc`、`inkos.json`、`books/` 和 `radar/`。验证 JSON：

```powershell
Get-Content .\inkos.json -Raw | ConvertFrom-Json | Out-Null
```

测试目录位于根 `tmp/` 下，默认不提交 Git。不要使用真实用户数据或受版权保护小说正文。

## 6. Studio 启动

必须从包含合法 `inkos.json` 的项目目录启动：

```powershell
Set-Location tmp/baseline-test-book
node ..\..\packages\cli\dist\index.js studio -p 4577
```

保持该终端运行，访问 `http://localhost:4577/`。另一个终端可检查：

```powershell
Invoke-WebRequest http://localhost:4577/ -UseBasicParsing
```

若页面显示 `Failed to fetch`：

1. 检查启动 Studio 的终端是否仍在运行；
2. 检查端口是否正确；
3. 确认启动目录包含 `inkos.json`；
4. 执行 `Get-Content .\inkos.json -Raw | ConvertFrom-Json`；
5. 不要在源码仓库根目录提交临时 `inkos.json`。

验证完成后在启动终端按 `Ctrl+C` 正常停止服务，不留下后台进程。

## 7. API 凭证配置与最小模型验证

不要在命令历史、文档、代码或聊天中粘贴真实密钥。推荐从 Studio 的“模型配置”保存到项目 `.inkos/secrets.json`；该目录已被 Git 忽略。也可由用户认可的秘密管理器向进程注入 `INKOS_LLM_PROVIDER`、`INKOS_LLM_BASE_URL`、`INKOS_LLM_MODEL` 和 `INKOS_LLM_API_KEY`。

配置后只做最小规模验证：

```powershell
node ..\..\packages\cli\dist\index.js doctor
node ..\..\packages\cli\dist\index.js book create --title "基线测试小说" --genre xuanhuan --platform tomato --target-chapters 30 --chapter-words 1200
node ..\..\packages\cli\dist\index.js plan chapter
node ..\..\packages\cli\dist\index.js write next
node ..\..\packages\cli\dist\index.js audit
node ..\..\packages\cli\dist\index.js revise
```

记录命令状态、错误摘要和生成路径，不提交生成正文。官方 `INKOS_AGENT_LLM_STUB=1` 在此基线上不能替代真实建书验证，因为其输出不满足当前 foundation 协议。

## 8. 状态和 SQLite 检查

```powershell
Get-ChildItem .\books -Recurse -File | Select-Object FullName,Length
```

重点位置：

```text
books/<book-id>/story/state/*.json
books/<book-id>/story/current_state.md
books/<book-id>/story/pending_hooks.md
books/<book-id>/story/chapter_summaries.md
books/<book-id>/story/snapshots/<chapter>/
books/<book-id>/story/memory.db
```

SQLite 应包含 `facts`、`chapter_summaries`、`hooks`。不要把 `.db`、`.db-wal`、`.db-shm` 加入 Git。

## 9. 清理测试数据

先返回仓库根目录并确认目标路径：

```powershell
Set-Location ..\..
$target = (Resolve-Path .\tmp\baseline-test-book).Path
$root = (Resolve-Path .).Path
$target
$root
```

确认 `$target` 位于 `$root\tmp\` 内后，才执行：

```powershell
Remove-Item -LiteralPath $target -Recurse -Force
```

## 10. 最终检查

```powershell
git status
git diff --stat
git diff
```

基线任务只应修改允许的 Markdown 和 `.gitignore`。若 `package.json`、`pnpm-lock.yaml`、核心源码或测试出现差异，应先查明来源，不能直接覆盖用户修改。
