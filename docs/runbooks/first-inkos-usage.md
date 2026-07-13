# 第一次使用 InkOS

## 测试项目

当前体验项目位于：

```text
tmp/TASK-001B-real-model-smoke/
```

该目录、模型配置、小说正文、SQLite 和日志均被 Git 忽略。现有测试书已经产生用户体验数据，不要重复点击批量写章。

## 1. 切换工具链

在仓库根目录打开 PowerShell：

```powershell
$env:PATH='C:\tmp\inkos-pnpm9-bin;C:\Users\zhubinhua\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;'+$env:PATH
node --version
pnpm --version
```

应显示 Node `v24.14.0` 和 pnpm `9.15.9`。

## 2. 启动 Studio

```powershell
Set-Location 'E:\Users\zhubinhua\Desktop\小说智能体\tmp\TASK-001B-real-model-smoke'
node ..\..\packages\cli\dist\index.js studio -p 4567
```

浏览器地址：`http://localhost:4567`。保持终端运行；停止 Studio 时在该终端按 `Ctrl+C`。

## 3. 检查模型服务

进入左侧“服务”。项目 `.env` 已通过 Studio 官方导入接口导入；界面应显示服务已连接。不要在截图、聊天或文档中展示 API Key。

CLI 连接检查：

```powershell
node ..\..\packages\cli\dist\index.js doctor
```

## 4. 查看 CLI 帮助

```powershell
node ..\..\packages\cli\dist\index.js --help
node ..\..\packages\cli\dist\index.js book create --help
node ..\..\packages\cli\dist\index.js write --help
node ..\..\packages\cli\dist\index.js audit --help
node ..\..\packages\cli\dist\index.js revise --help
```

## 5. 创建书籍

Studio 左侧“新建书籍”包含两条路径：

- 直接表单：填写书名、题材、平台、目标章数、每章字数和创作简报；
- 对话式建书：模型从自然语言推断设置，未指定时会使用默认值。

中文项目的直接表单每章字数最小值为 1000。需要可重复测试时使用直接表单，不依赖对话默认值。

CLI 示例：

```powershell
node ..\..\packages\cli\dist\index.js book create --title "测试书" --genre urban --platform tomato --target-chapters 1 --chapter-words 1000 --brief brief.md
```

真实模型调用会产生费用。提交前确认只创建一本测试书。

## 6. 生成章节计划

```powershell
node ..\..\packages\cli\dist\index.js plan chapter <book-id>
```

Studio 中可在书籍工作台使用章节规划入口。规划产物位于 `story/runtime/`。

## 7. 生成一章

```powershell
node ..\..\packages\cli\dist\index.js write next <book-id> --count 1
```

测试时固定 `--count 1`，等待完成后先检查章节状态和 token usage，不连续点击。

## 8. 审查与修订

```powershell
node ..\..\packages\cli\dist\index.js audit <book-id> 1
```

只有审查问题需要修订时执行一次：

```powershell
node ..\..\packages\cli\dist\index.js revise <book-id> 1
```

不要反复修订同一章；原版尚无商业成本上限配置。

## 9. 人工审核

```powershell
node ..\..\packages\cli\dist\index.js review list <book-id>
```

人工阅读正文和审查问题后，才可以执行：

```powershell
node ..\..\packages\cli\dist\index.js review approve <book-id> 1
```

若不通过，使用 `review reject` 并说明原因。系统不会代替作者做最终内容判断。

## 10. 查看状态与记忆

```text
books/<book-id>/book.json
books/<book-id>/story/state/current_state.json
books/<book-id>/story/state/hooks.json
books/<book-id>/story/state/chapter_summaries.json
books/<book-id>/story/current_state.md
books/<book-id>/story/pending_hooks.md
books/<book-id>/story/chapter_summaries.md
books/<book-id>/story/memory.db
```

SQLite 的 `facts`、`chapter_summaries` 和 `hooks` 位于每本书自己的 `memory.db`，通过 `books/<book_id>/` 路径隔离。

## 11. 导出

Studio 书籍页面支持 TXT、Markdown 和 EPUB。CLI：

```powershell
node ..\..\packages\cli\dist\index.js export --help
```

导出文件仍属于生成内容，不提交到源码仓库。

## 12. 清理测试项目

先停止 Studio，确认路径确实是 `tmp/TASK-001B-real-model-smoke/`，再决定是否清理。当前项目保存了 TASK-001B 的本地验收证据，在任务归档前不要删除。

## 不能提交 Git 的文件

- `小说key.txt`；
- `.env`、`.inkos/secrets.json`；
- `books/` 和小说正文；
- `memory.db`、SQLite WAL/SHM；
- Studio/CLI 日志和模型原始响应；
- 导出 TXT、Markdown、EPUB。

检查命令：

```powershell
git status --short
git check-ignore -v ..\..\小说key.txt
git check-ignore -v .env
git check-ignore -v .inkos/secrets.json
```
