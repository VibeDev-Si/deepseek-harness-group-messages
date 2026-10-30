# DeepSeek Harness 会话群组

将同一 Harness Host 的原生会话组织成群聊，通过 @ 派发任务、成员互聊和轮次总结协调工作。界面采用社交群聊风格，在原生右侧标签页中打开。

## 功能

- 按工作区选择会话，支持跨工作区组群、群内别名和新建原生会话。
- 正文原样转发；Enter 发送、Shift+Enter 换行，兼容中文输入法。
- 为成员指定模型、推理等级和权限预设，保留每次执行配置。
- 文件与图片附件、粘贴和拖入、图片预览、原生斜杠指令。
- 显式开启成员互聊，通过 `group_send` 和 `group_read` 协作，并设置每轮投递上限。
- 任务暂停、继续、取消、重试，消息撤回，以及基于原生会话分支的对话回退。
- 结束轮次后生成带来源的总结，支持历史轮次与 Markdown 导出。

## 构建

需要 Node.js 24+，以及已经安装开发依赖的 DeepSeek Harness 源码。本插件针对 Harness `0.2.2-alpha.2` 和 Cordis `4.0.6-alpha.1` 开发。

若本仓库与 `deepseek-harness` 目录并列：

```sh
npm run bootstrap:local
npm run check
```

也可以明确指定 Harness 源码目录：

```sh
npm run bootstrap:local -- /absolute/path/to/deepseek-harness
npm run check
```

`bootstrap:local` 仅在本项目建立依赖链接。`check` 执行类型检查和构建，产物写入 `dist/`。

## 安装和使用

完成构建后，在 Harness 源码目录执行：

```sh
pnpm dsh plugin --profile web add /absolute/path/to/deepseek-harness-group-messages
pnpm dsh web
```

通过启动时打印的鉴权地址打开 Web 页面，在左侧栏选择“会话群组”。新建群组、选择会话，在输入框中 @ 接收者后发送正文；无 @ 消息仅保存在群内。

通过接收者标签的设置按钮配置模型与权限；从输入框 `＋` 添加附件或选择原生指令。在“群详情 → 成员互聊”开启自动投递后，可以要求 A 使用 `group_send` 将方案交给 B 评审，再由 B 将意见发回 A。该能力默认关闭，每轮最多自动投递 1–30 次。

附件每条最多 8 个，单个 10 MB、合计 25 MB；图片支持 PNG、JPEG、WebP、GIF，图片理解取决于目标模型的能力。

## 行为说明

Host 保存群组数据并调度任务，关闭页面不会停止工作。每个会话保留自己的上下文；群工具限定在已授权的群任务中。模型及权限配置应用于目标会话，不修改全局默认模型。

暂停需等待原生执行确认结束，继续会原文发起新一次尝试。撤回不删除原生会话历史；回退创建新分支并恢复草稿。二者都不会撤销已发生的文件修改、命令、权限配置或远程操作。状态不明的任务需先核对原会话，再明确重试。

## 源码结构

- `src/core/`：数据模型、持久化队列、任务控制、互聊路由和总结记录。
- `src/host/`：Harness 会话、模型、权限、附件和工具适配。
- `src/client/`：群聊侧栏、成员设置、输入框、附件和工作区选择。
- `src/rpc.ts`：Host 与 Client 的严格 Remote 协议。
- `scripts/`：依赖链接与构建脚本。
- `locale/`、`icon.svg`、`cordis.patch.yml`：插件注册资源。

许可证：Apache-2.0。
