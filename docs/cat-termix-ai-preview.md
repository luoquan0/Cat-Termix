# Cat-Termix AI 测试版

开发分支：`Cat-Termix`，基于仓库原有的 2.9.2。此分支不改变 `main`，测试镜像使用 `ghcr.io/luoquan0/cat-termix:ai-dev`，不覆盖 `latest`。只有校验、构建和容器启动检查通过后，发布流程才更新 `ai-dev`；每次构建也保留对应的 `sha-<完整提交 SHA>` 镜像。

## 功能入口

独立 AI 页面与 SSH 内聊天使用同一个完整聊天组件：按当前 SSH 主机隔离的聊天历史（打开、切换、删除），提供商选择、自动读取上游模型列表/下拉选择/刷新和自定义模型 ID、`@` 主机及资源提及、流式回复、命令结果、自然语言总结、新对话和停止按钮。

先在设置中启用 AI 插件及管理员 AI 总开关，然后配置自己的提供商地址、API Key 和默认模型。用户仍需拥有 AI 使用权限。SSH 中不再要求逐台开启主机 AI 开关：只要管理员总开关和用户个人开关已启用、有权连接该主机，就会出现 SSH 内的「AI 助手」入口（底部工具栏，或使用 Ctrl+Shift+A）。打开终端后点击带文字的 AI 助手入口；窗口可拖动、缩放，不会锁住终端。

`@` 提及用于告诉模型要查找哪个有权限访问的资源，不自动上传凭据或资源全部内容。SSH 聊天绑定当前主机；跨主机工作及修改 Termix 主机列表等操作请使用独立聊天。

## 执行模式与总结

默认是“逐次审批”。点击切换按钮并确认风险提示后，当前对话进入“免逐次审批”模式；模型调用受支持的操作工具时直接执行，然后将真实结果交回模型总结。新建对话、关闭并重新打开聊天会恢复默认审批模式。这不是绕过模型提供商自身内容政策的功能。

免逐次审批仍检查登录身份、AI 开关、`apply_proposals` 权限、主机访问权限和工具参数，并保留服务端执行记录。命令以该主机配置的 SSH 账号权限运行，因此可能修改或删除数据。先在非生产主机测试，保持备份，不要给 AI 提供不需要的权限。

手动审批后也会自动续接总结；审批完成时仍有流式回复，会先排队，避免丢失结果。失败的命令记录为失败，不再当成成功。总结使用服务端保存的结果，且总结请求不提供执行工具，避免为了解释结果重复运行命令。

## 与手动终端并行

AI 自动执行默认使用同一主机的独立非交互式 SSH exec 通道，执行过程和输出显示在聊天中。Preview 2 新增「共用当前 SSH 终端」执行模式；指令和输出出现在同一个 SSH 窗口，结果和退出码自动交回模型，支持逐次审批和免逐次审批。详见本文末尾说明。独立执行模式下，用户可同时操作原来的交互终端。共用模式下，AI 执行期间保留键盘输入，按 Ctrl+C 可以接管；不会往尚未输入完的命令行或 `vim`/`top` 会话注入指令。

两个通道不共享 `cd`、shell 变量或交互程序状态。涉及目录时应使用绝对路径，或在一条命令中明确执行 `cd /path && ...`。需要模型分析当前终端画面时，使用“附加终端输出”按钮，检查输入框内容后发送。它不会持续暗中同步终端输出。

输入通道独立不代表主机资源隔离：两边仍操作同一台主机上的文件、进程和服务，避免同时修改同一文件或执行互相冲突的维护任务。

“停止”或关闭聊天会取消当前流式 AI 请求及其自动执行通道，不关闭用户的 SSH 连接。通过审批卡片单独发起的执行请求不由聊天停止按钮取消，需要等待执行结果或在主机上核查。已经执行的修改不会回滚，已自行后台化的远程进程也不保证随通道关闭而结束。执行设有超时、输出长度上限和模型步数上限；最后一步只允许总结，未完成时应明确报告。

## 独立部署测试

在任意空目录保存仓库根目录的 `docker-compose.ai-test.yml`，执行：

```sh
docker compose -f docker-compose.ai-test.yml pull
docker compose -f docker-compose.ai-test.yml up -d
docker compose -f docker-compose.ai-test.yml ps
```

访问 `http://127.0.0.1:9080`。配置默认只绑定本机回环地址，使用独立数据卷，不复用现有实例数据库。SSH 与 AI 测试不需要 guacd；此简化配置未包含 RDP/VNC 所需的 guacd 服务。

在 NAS 或另一台服务器部署、需要从可信局域网访问时：

```sh
CAT_TERMIX_BIND=0.0.0.0 docker compose -f docker-compose.ai-test.yml up -d
```

随后访问该服务器的 9080 端口。不要直接暴露到互联网；对外使用 HTTPS 反向代理和适当访问控制。

若拉取 GHCR 返回 `denied`，需要用有该包读取权限的 GitHub 账号登录 GHCR，或由仓库所有者在包设置中将包设为公开；不要把 Token 填入聊天或 Compose 文件。

```sh
docker login ghcr.io -u luoquan0
docker compose -f docker-compose.ai-test.yml pull
```

提供商运行在 Docker 宿主机上时，可使用 `host.docker.internal`；私有地址必须在 AI 管理员设置的允许列表中显式允许。容器中的 `localhost` 指容器自身，不是宿主机。

升级测试版：重复 `pull` 和 `up -d`。复现某个版本时，用构建摘要中的完整提交 SHA 固定镜像：

```sh
CAT_TERMIX_IMAGE=ghcr.io/luoquan0/cat-termix:sha-<完整提交SHA> docker compose -f docker-compose.ai-test.yml up -d
```

停止测试但保留数据：

```sh
docker compose -f docker-compose.ai-test.yml down
```

不要使用 `down -v`，除非确实要删除测试实例的数据。不要把旧版本直接连接到已经被新版迁移的生产数据库。

## 验收建议

先在独立聊天进行普通问答，验证上游模型下拉和刷新；发几条消息并刷新页面，确认会话可恢复和删除；输入 `@` 确认资源建议正常。再在测试主机打开 SSH 聊天，要求执行只读检查，确认审批后的回复包含结论而不只是原始数据。开启免逐次审批后重复检查，确认无需逐条点击且聊天显示真实输出；同时在用户终端执行自己的命令，确认输入互不干扰。最后测试故意失败的命令、停止 AI、新建对话恢复审批模式。

自动化回归使用受控提供商响应与 SSH 通道替身来检查权限、结果反馈、失败记录、重复执行防护和取消行为；它不能替代对你自己的模型服务、真实 SSH 主机及代理网络的部署验收。

## AI Preview 2: shared PTY and conversation scrolling

In the SSH floating chat, the new **Command execution mode** selector offers:

- **Isolated execution**: the existing independent SSH exec channel, with results in chat only.
- **Shared SSH terminal**: commands are sent server-side to the SSH PTY already visible in the terminal. The terminal displays the readable command and its live output. Verified exit status and bounded output return to the agent automatically, in both per-command approval and automatic modes. There is no need to use Attach terminal output for AI-run commands in shared mode.

Shared mode requires an attached session owned by the signed-in user, access to its host, and an idle Bash/zsh prompt with Readline-style bracketed-paste signaling. It refuses partially typed input, foreground applications/alternate-screen programs, disconnected sessions, and concurrent AI runs. If readiness cannot be confirmed, finish the foreground program and press Enter at the shell prompt, or use isolated mode. It never silently falls back to a separate SSH connection.

AI scripts run as foreground subshells in that same PTY, inheriting the current shell's directory and environment. This deliberately prevents `exit`, `exec`, or `set -e` in an AI script from logging the user out; `cd`/`export` changes inside an AI script do not persist into the parent shell. Use absolute paths or a combined script for dependent commands. Multiline scripts are supported. Human command input is reserved while an AI command is active; **Ctrl+C** interrupts and takes over. Stop/timeout cancels the command without closing the SSH session. Completed changes and background processes are not rolled back.

Approval cards now stay next to their originating command and collapse after resolution, instead of being appended below every later answer. New output follows the bottom even after card/viewport resizing; scrolling up keeps the reader's position and shows a **Jump to latest reply** button.

The regression suite includes a real local Bash PTY check covering human `cd`, multiline AI commands, nonzero `exit`, interruption, and reuse of the same connection. This supplements, but does not replace, testing against your SSH server and model provider.


## AI Preview 3: clean composer and on-demand terminal context

The settings button immediately to the right of Chat history now contains provider/model selection, model refresh, isolated/shared execution and approval mode. Provider management and future chat options belong in the same collapsible panel. Settings are collapsed by default, but remain mounted so model discovery and the selected model continue to work. Automatic mode retains a small visible status badge.

Opening or resetting a chat leaves the composer empty. No terminal output is copied on launch, and there is no Attach terminal output button. The read-only `get_terminal_output` tool obtains recent server-side scrollback for the exact current SSH session or a host referenced with @. It works in both execution modes, does not execute commands, and sends results through the existing redaction and untrusted-data handling. Reads are visible in the conversation. Merely opening the chat does not transmit scrollback to a provider.

A read is limited to the authenticated user's own connected sessions and rechecks host connect access. It does not read another user's sessions or create a connection. A stale explicit session never falls back to a different tab. If @ identifies a host with multiple sessions, the tool returns session choices rather than merging outputs. Missing sessions, empty buffers and truncated recent output are reported explicitly. This is bounded live scrollback, not unlimited historical recordings. Mentioning another host allows reading its output, not redirecting execution away from a bound shared terminal.
