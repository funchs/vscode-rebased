# 我把 JetBrains 的 Git 客户端搬到了 VS Code

写一个 VS Code 插件，专门补 VS Code 内置 git + GitLens **都不做**、但 IntelliJ 用户每天都用的那些 git 功能。

> **TL;DR**  
> 开源 VS Code 插件：[funchs/vscode-rebased](https://github.com/funchs/vscode-rebased)  
> 已上 Open VSX（Cursor / VSCodium / code-server 等可直接装）：`ext install funchs.vscode-rebased`  
> MIT 协议，47 个测试，i18n 支持中英文。

![Rebased](https://raw.githubusercontent.com/funchs/vscode-rebased/main/docs/screenshots/cover.png)

## 缘起

VS Code 用了一段时间，从 IntelliJ 切换过来。**前三周里有三件事让我每天烦躁**：

1. **没有拖拽式 interactive rebase**。GitLens 给了个表格 + 上下箭头按钮的编辑器，能用，但跟物理拖动那种顺手感差一截。
2. **没有「Update Project」**。JetBrains 的 Ctrl+T：脏树 → 自动 stash → fetch → pull --rebase → pop → 任一步冲突自动路由到 3-way merge。一条命令解决「我改完了想拉一下同事的代码」。
3. **没有 Changelists**。把未提交的改动按主题分组，每组单独 commit。在 IntelliJ 里我每天用 5 次。

GitLens 不补这些（它专注 blame / lens / search），VS Code 内置 git 更不补。所以自己写。

成品叫 **Rebased**。

## 核心能力

### 拖拽式 interactive rebase

终端跑 `GIT_SEQUENCE_EDITOR='code --wait' git rebase -i HEAD~5` 自动弹出 webview：每行是一个 commit，**直接拖动**改顺序，点动作 chip 在 `pick / reword / edit / squash / fixup / drop` 之间循环。⌘⏎ 保存继续 rebase。drop 行会自动加删除线预览。

![Interactive rebase editor](https://raw.githubusercontent.com/funchs/vscode-rebased/main/docs/screenshots/rebase-editor.png)

### Update Project（⌘⌥T）

一条命令跑完整流水线：

```
脏树？→ 静默 stash → fetch --all --prune → pull --rebase（或 merge）
                                            ↓
                                       pop stash
                                            ↓
                       任一步冲突 → 冲突解决面板
                                            ↓
                                  finalize（drop stash / continue）
```

三种真实冲突类型分别处理：

- **CONTENT 冲突**（双方都改了同一文件）→ VS Code 内置 3-way merge editor
- **UNTRACKED 碰撞**（远端刚加了一个文件，你的 stash 里也有同名文件）→ 弹模态：保留上游 / 用 stash 覆盖 / 逐文件对比 / 保留 stash
- **孤儿 UU**（工作区有 UU 文件但没有正在进行的 rebase / merge —— 通常是上次 reset 留下的残骸）→ 状态检测 + 收尾路径

我从 IntelliJ 切过来后这个命令是 day-1 想念的。它让 git 工作流从"操作一连串原子命令"变成"一个目标 + 一次按键"。

### 冲突解决面板

![Conflict resolver](https://raw.githubusercontent.com/funchs/vscode-rebased/main/docs/screenshots/conflict-panel.png)

JetBrains 风格的列表视图：每个冲突文件一行，行尾 4 个一键操作 —— **采用我方** / **采用对方** / **合并…** / **重置**。底部 finalize 按钮根据当前 op 类型自适应（rebase 时叫 Continue，stash-pop 时叫 Drop stash 等）。

注意：rebase 期间 git 的 `--ours` 和 `--theirs` 是反的（rebase 把你的提交 replay 到上游）。Rebased 在边界翻转了，"采用我方"始终 = 你分支的版本。

### Changelists

未提交的改动按命名分组。我现在常这样用：

- 默认列表：手头主要的功能改动
- "Lint cleanup" 列表：捎带把 linter 报错都修一下
- "WIP: rate limiter" 列表：另一个半成品

每组单独 `Commit Changelist...`，自动只 stage 该列表的文件再 commit。不需要反复 `git add -p` 或多 branch 切换。

### Log graph

底部 panel 一个 tab（不挤左侧栏的位置）：横向铺开 swim-lane 图，多色泳道、ref chip、虚拟滚动。顶部 5 字段过滤栏（subject / author / path / branch / since）服务端 `--grep --author --since -- path` 真过滤，不是客户端筛。

![Log graph](https://raw.githubusercontent.com/funchs/vscode-rebased/main/docs/screenshots/log-graph.png)

点任一 commit → 旁边弹详情面板：subject + body + refs + parents + 文件清单（+/- 统计） + 点文件查 diff against parent。

### 还有

- **Local history**：每次保存自动快照到 `globalStorage`，可以 diff / 恢复，**不依赖 git**（连未跟踪的文件都能恢复）
- **Conventional Commits 实时校验**：textarea 上方实时显示 type/scope/BREAKING chip + 校验状态。配套 5 步 Commit Wizard（⌘⌥C），scope 自动从最近 commit 里挖
- **Inline blame** + **整文件 gutter blame**（⌘⌥B），同 commit 连续行折叠
- **Stash / Branches / Tags / Remotes / Reflog / Submodules**：每个都有专门的 QuickPick 入口
- **i18n** 跟随 VS Code 设置自动切中英文，280+ 字符串中文化

## 跟 GitLens 的关系

GitLens 在 blame、lens、搜索上非常强。Rebased 故意**不抢它的活**：

| 功能 | GitLens | 内置 git | Rebased |
|---|---|---|---|
| 当前行 inline blame | ✓ | — | ✓ |
| 拖拽式 interactive rebase | 表格 | — | ✓ 拖拽 |
| Update Project 流水线 | — | — | ✓ |
| 冲突 dashboard | — | source control 列表 | ✓ webview |
| Changelists | — | — | ✓ |
| Local history | — | — | ✓ |
| Log 图 | ✓ 付费 | ✓ 简易 | ✓ 免费 |
| Commit 向导 + CC 校验 | — | — | ✓ |

两者可同时装，不冲突。

## 顺便聊聊怎么写的

整个项目是用 Claude 配对编程做的，约 50 小时。两个有意思的瞬间：

**节省一整天的 bug。** 本地测试全过，CI 全炸。troubleshoot 一阵发现：我的 `git log` 命令在 argv 里嵌了 NUL 字节做分隔符。Node 20 容忍，Node 22+ 的 `spawn` 校验 argv 不能含 NUL，直接 reject。修法是用 `git log -z`，让 git 在 stdout 上输出 NUL 分隔的记录，而不是在 argv 里塞。Claude 写测试脚手架时 30 秒抓到。

**差点上线的 bug。** checkout / merge / rebase 撞脏树时弹错误 toast。toast 标题是 `$(git-merge) Merge into current: <error>` —— VS Code 只在 QuickPick / 状态栏渲染 codicon，**toast 不渲染**。所以用户看到的是字面字符串 `$(git-merge)`。前后改了 4 轮才修对，因为每次 VS Code 窗口都没 reload，老实例缓存着旧代码。Lesson learned 不是 codicon，是 Extension Development Host 的 reload 语义。

## 工程化细节

不重要但有人在意：

- 纯 TypeScript + esbuild + 原生 HTML/CSS（无 React），整个 vsix ~80 KB
- Git 调用一律 `spawn(..., shell: false)` + argv 数组，无 shell 注入面
- Webview 严格 CSP + nonce-gated script，DOM 写入只用 `textContent`
- 47 个测试覆盖 5 套：smoke / integration（临时 git 仓库） / edge-cases / Conventional Commits parser / notify helpers
- CI 矩阵 3 OS × 2 Node 版本
- release.yml：tag 触发 → Open VSX 自动发布 + GitHub Release 自动挂 vsix

## 上手

Cursor / VSCodium / Antigravity 等用 Open VSX：

```bash
# 编辑器扩展面板搜 Rebased，或：
ext install funchs.vscode-rebased
```

VS Code 官方目前还没发到 Marketplace（要 Azure DevOps 账号 + PAT 流程，TODO），但可以直接下 vsix：

```bash
curl -L https://github.com/funchs/vscode-rebased/releases/latest/download/vscode-rebased-0.1.4.vsix -o r.vsix
code --install-extension r.vsix
```

仓库地址：https://github.com/funchs/vscode-rebased

issue 模板要求你贴一份 `Rebased: 仓库诊断` 的输出（命令面板找），这样我能少问一轮。功能请求按"JetBrains 有 / VS Code 没有"框架描述的优先级最高。

如果你也是从 JetBrains 切过来还在适应，欢迎一起折腾。
