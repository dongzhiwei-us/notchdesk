# 悬屿 NotchDesk

悬屿是一个 Electron 桌面刘海。它把待办、常用剪贴、开发资讯和会话提醒放在屏幕顶部中央，数据默认保存在本机。内置功能由插件提供，可逐个关闭，也可通过本地 MCP 调用。

GitHub 仓库：[dongzhiwei-us/notchdesk](https://github.com/dongzhiwei-us/notchdesk)（私有仓库，访问和克隆需使用已授权账号）。

从源码压缩包在 Mac 构建，请直接查看 [macOS 安装包：从解压到生成 DMG](#macos-安装包)。同一台 Mac 可以生成 Apple Silicon（arm64）和 Intel（x64）两套安装包。

## HTTP MCP 连接

默认地址为 `http://127.0.0.1:49318/mcp`，采用官方 MCP SDK 的 Streamable HTTP。后台服务随桌面启动，设置中的 MCP 连接页可以复制地址和完整客户端配置。

```json
{
  "url": "http://127.0.0.1:49318/mcp",
  "headers": {
    "Authorization": "Bearer <从设置页复制的访问令牌>"
  }
}
```

端点仅监听本机回环地址，支持多个独立会话、GET 事件流和 DELETE 会话结束。插件热加载、启停和 MCP 权限变更会触发工具列表变更通知。令牌保存在业务数据目录的 mcp-token 文件，重启后继续有效，勿将真实令牌写入项目文档。端口可用 `NOTCH_PORT` 指定，测试使用 0 自动分配端口，设置页始终显示实际地址。本机浏览器客户端支持 CORS，外部网页 Origin 被拒绝。后台服务可单独用 `pnpm run server` 启动。

原有 `pnpm run mcp` 的 stdio 入口用于兼容已经配置的客户端。设置页默认导出 HTTP 配置。

## 启动和使用

源码开发需要 Node.js 24.13 或更高版本和 pnpm 11.20.0。项目通过 `packageManager` 固定 pnpm 版本，`pnpm-lock.yaml` 是唯一依赖锁文件。尚未安装 pnpm 时，先运行 `npm install --global pnpm@11.20.0`；该命令只用于准备包管理器。然后在项目目录运行以下命令。

```powershell
pnpm install --frozen-lockfile --prod=false
pnpm start
```

`pnpm start` 会构建界面并启动 Electron。后台服务随桌面启动。关闭桌面 UI 后，本地 MCP 客户端仍可按需启动后台服务。托盘中可以展开悬屿、进入设置、打开插件目录或退出。

- 鼠标移到屏幕上方的刘海，顶边停靠时展开半圆插件轮盘，悬浮停靠时展开完整圆盘。鼠标滚轮或触控板滑动会旋转圆盘并吸附到对应刻度；也可直接点击插件图标选择并打开对应内容。悬停图标会显示反馈，拖动图标不会切换插件。面板的图钉可固定当前内容。鼠标移出后，未固定且未编辑的面板会收起。`Esc` 可返回或关闭当前面板。
- 点击展开区域的设置齿轮，可切换浅色、深色或跟随系统，选择顶边半圆或悬浮完整圆盘、主题色和磨砂/实色材质，配置各插件、仓库账号和 MCP。
- 铃铛入口保留通知、操作和投递原因。已到点的提醒可在桌面在线时进入刘海。勿扰、锁屏和优先级会影响何时浮出，仍可在通知列表查看已记录的提醒。

## 内置功能

| 功能 | 使用方式 |
| --- | --- |
| 待办 | 新增、编辑、删除、标记待办、进行中或完成。设置截止时间后，可在到点提醒里直接完成或稍后提醒。 |
| 悬挂剪贴 | 手动收录系统剪贴板，或拖入文字和文件。挂件可预览、置顶或写回剪贴板。文件移动后可重新定位原文件引用。 |
| 文本片段 | 保存命令、Prompt、问题模板和其他常用文字，支持编辑、删除和一键复制。 |
| 词汇复习 | 自带一组开发词汇，可添加自己的词、释义和例句。按记忆结果安排下次复习，并在活动列表留下每日提醒。 |
| 仓库趋势 | 读取公开的 GitHub Trending，支持日榜、周榜、月榜和语言筛选。连接账号后可添加自己关注的 GitHub/GitLab 仓库或组织。 |
| 开发晨报 | 默认本地时间 10:00 提醒，汇总逾期和当天到点的待办、昨天完成的待办，以及授权账号可见的待审查 PR/MR、分配给自己的 Issue 和昨天的仓库活动。可把仓库建议加入待办，重复采用同一条建议会返回已建待办。首次启用时若当天已过提醒时间，晨报进入活动列表。 |
| 会话召回 | 接收 MCP 会话请求。通知可打开对应会话、稍后提醒或标记已处理。Codex 通过验证后的会话 UUID 定位。Hermes 使用本机可执行的 `hermes`，Vanish 需提前登记会话跳转模板。 |
| 喝水走动 | 默认为工作时段内累计活跃 60 分钟提醒喝水，累计 120 分钟提醒走动。两项一起到期时合并。锁屏、离线和长时间无操作会暂停计入，可稍后提醒或暂停当天。 |

### 剪贴与文件预览

剪贴绳横跨当前显示器，默认跟随圆盘下方，直接展示绳子与挂件，不带包围挂件组的背景方框。拖动绳身可调整悬挂位置，手动位置保存为插件数据库中的屏幕相对坐标与显示器标识，关闭再开及完整重启后均会恢复。分辨率变化时按比例适配，原显示器不可用时回到刘海所在的显示器。恢复默认位置会重新跟随圆盘。点击外部、切换到其他窗口或失去焦点会收起展示；圆盘与绳子之间切换焦点、选择文件和正在进行的拖出操作会保持当前交互。

0.5.1 起，每个挂件可以沿整条屏幕绳子独立摆放，拖动距离不再限制为 180px，也不再被中间列表裁切。拖动夹子到任意空白位置即可保存，拖动图片或文件内容仍可交付给其他软件。位置按屏幕宽度比例保存，重启恢复，边缘留出挂件可见空间。聚焦夹子后使用左右方向键微调，Shift 加速，Home 恢复该挂件的自动布局；移动绳身会同时平移已摆放的挂件。

MCP `clip_move({id,x})` 使用 `0..1` 的横向屏幕比例定位，`clip_list` 返回每个挂件的 `hangX`；`clip_move({id,resetPosition:true})` 恢复自动布局。保留 `beforeId` 排序兼容性。`clip_layout_set` 的可选 `shiftX` 按屏幕宽度比例平移已定位的挂件，`reset:true` 只恢复绳子位置。Windows 原生鼠标拖动、重启持久化、MCP 定位与跨软件文件/图片拖出专项验收见 `scripts/shelf-smoke.mjs`。

鼠标悬停挂件时，轻微抬起并出现快速预览；点击可展开更大的图片、PDF、Markdown、HTML 或视频预览。拖动夹子进行绳内排序，拖动照片或文件内容可发送到支持文件拖放的软件输入区，也可拖动大预览标题栏中的「拖到其他软件」。原挂件在拖出后保留，鼠标释放后收起浮层。Windows 使用系统 FileDrop 格式交付本地文件；剪贴图片以保存的 PNG 文件交付。未覆盖的桌面区域可点击穿透。

MCP 开启「文件」权限后，可调用 `clip_layout_get {}` 查询位置。`anchor: "notch"` 表示跟随圆盘下方；调用 `clip_layout_set {"x":0.5,"y":0.4}` 会改为屏幕相对坐标模式，坐标范围为 0–1，可选的 `displayId` 指定显示器。`clip_layout_set {"reset":true}` 恢复默认跟随。靠近屏幕边缘时位置会约束在可操作范围内，绳身把手也可使用方向键微调。

文字和剪贴图片随应用保存。文件默认以原路径引用保存，也可在插件设置中为较小文件启用副本。直接收录图片上限为 12 MB，独立副本上限为 96 MB。较大的图片、文档和影片适合直接拖入并保留原文件引用。原路径失效时，重新选择同一内容的文件即可恢复预览。

可查看常见图片、纯文本、Markdown、静态 HTML、PDF 和 Chromium 支持编码的 MP4/WebM 等视频。HTML 和 Markdown 预览会过滤脚本和外部资源，保留可安全展示的正文。其他格式显示文件卡片，仍可复制原文件或文件路径。系统剪贴板承载的截图使用 PNG，文件写回使用系统文件剪贴格式。

## 连接 GitHub 与 GitLab

在「设置 → 账号与来源」选择平台。GitHub 使用 github.com，GitLab 可填写 gitlab.com 或自建的 HTTPS 实例。每个平台保存一个账号。

1. **访问令牌**。创建具有所需项目读取权限的令牌，粘贴到设置并保存。GitLab 可使用 `read_api`。GitHub 可用授权指定仓库读取权限的细粒度令牌。组织的审批和单点登录策略仍适用。
2. **浏览器 OAuth**。在平台登记自己的 OAuth 应用，把本机回调填为 `http://127.0.0.1:49317/callback`，把 Client ID 填到设置并点击「发起 OAuth」。如平台注册类型要求 Client Secret，在启动桌面的进程环境提供 `NOTCH_GITHUB_CLIENT_SECRET` 或 `NOTCH_GITLAB_CLIENT_SECRET`。也支持用 `NOTCH_GITHUB_CLIENT_ID` 或 `NOTCH_GITLAB_CLIENT_ID` 预填 Client ID。需要调整本机端口时，用 `NOTCH_OAUTH_PORT` 并同步修改平台登记的 URI。 [GitHub OAuth 应用注册](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) · [GitLab OAuth 应用注册](https://docs.gitlab.com/integration/oauth_provider/)
3. 授权完成后回到应用。在仓库趋势中添加仓库或组织，在晨报中查看连接状态和汇总。私有项目只会在令牌或 OAuth 授权可读时出现。GitHub 浏览器授权默认采用 `read:user`，读取私有仓库时使用带对应权限的令牌。失效的令牌可在设置中重连。凭据由 Electron `safeStorage` 加密保存。

未连接账号时，公开 GitHub Trending、待办和其他本地模块均可用。网络中断时，趋势使用已取到的缓存，晨报继续提供可用的本地项目。初次访问趋势时需要网络。

## MCP

打开「设置 → MCP 连接」，复制 HTTP 服务地址及包含 `Authorization` 请求头的完整配置。将其作为名为 `notchdesk` 的 Streamable HTTP 服务加入 MCP 客户端。有些 JSON 客户端把 `url` 和 `headers` 放在 `mcpServers.notchdesk` 下，具体按客户端自己的配置格式填写。应用随带后台运行时，客户端无需配置 Node.js 路径。连接时保持后台服务运行。

默认授予「工作区」和「桌面」。剪贴板、文件、管理权限可在同一页面打开。修改权限后，让客户端刷新工具列表。权限会限制实际调用，工具清单会随已启用插件变化。可用 `todo_list {}` 做首次连通测试，再调用 `todo_add {"title":"从 MCP 新增的测试任务"}` 检查刘海中的待办。

MCP 动作使用下划线命名。下面示例是一条会话请求。

```json
{
  "provider": "codex",
  "sessionId": "01937eab-7ab1-7c9f-8043-2b5a1e7fdaa1",
  "title": "构建结果等待查看",
  "body": "这个会话中有待确认的结果。",
  "eventId": "build-42",
  "priority": "scheduled"
}
```

把示例参数传给 `attention_request` 时，换成真实会话 UUID，并为同一来源事件重复使用同一个 `eventId`。可用 `attention_list` 查询状态，用 `attention_resolve` 或 `attention_snooze` 处理。Vanish 适配器通过桌面权限下的 `session_register` 登记，模板需含 `{sessionId}`，并使用 `vanish://` 或 HTTPS URL。Hermes 会话跳转要求系统可找到 `hermes` 命令。

## 插件开发

从「设置 → 插件 → 插件目录」打开当前插件根目录。把下面三个文件放进新建的 `quick-note` 子目录。保存后，插件服务会重新扫描，界面会读取新的设置定义和动作。应用内可禁用插件，插件自己的数据会保留。仅装入你信任的代码，后端插件以当前用户权限运行。

`quick-note/manifest.json`

```json
{
  "id": "quick-note",
  "name": "快捷便签",
  "icon": "box",
  "version": "1.0.0",
  "entry": "index.cjs",
  "ui": "panel.js",
  "settings": {
    "label": { "type": "string", "label": "便签文字", "default": "今天先做什么？" }
  }
}
```

`quick-note/index.cjs`

```js
exports.activate = (ctx) => {
  ctx.action(
    'quick_note_get',
    '读取快捷便签',
    { type: 'object', properties: {}, additionalProperties: false },
    () => ({ label: ctx.config().label })
  );
};
```

`quick-note/panel.js`

```js
export function mount(root, ctx) {
  const label = document.createElement('p');
  label.textContent = ctx.settings.label;
  root.append(label);
  return () => label.remove();
}
```

- `settings` 支持 `string`、`number`、`boolean`、`select` 和 `time`。运行时通过 `ctx.config()` 读当前配置。面板可调用 `ctx.rpc(method, params)`，省略 `ui` 时由应用按动作类型生成通用面板。
- `presentation: { "wheel": false }` 声明默认后台插件，不占轮盘位置；省略时默认显示。该字段与 `defaultEnabled`、运行时、通知、配置和 MCP 动作独立，支持目录热加载。设置页为所有插件提供“显示在轮盘”开关，用户偏好优先于 manifest 默认值，并跨重启和插件升级保存。MCP `plugins_presentation({id,wheel})` 需要管理权限，`state_get` 返回解析后的 `presentation.wheel`。隐藏入口不停止插件，也不删除数据；显式 `ui_activate` 仍能打开插件详情，但不会错误选中其他轮盘项。
- `ctx.store.get/set` 保存本插件的 JSON。需要共享数据时，用 `ctx.shared.get/set/subscribe` 并给键加上插件前缀。共享数据可被其他本地插件读取。
- `ctx.invoke(method, params)` 调用另一个动作，`ctx.native(method, params)` 使用宿主提供的桌面能力。用 `ctx.onTick` 实现调度，用 `ctx.notify` 发通知。提醒使用稳定事件键，多次提交同一个键只产生一条通知。
- 响应用户动作后需要自动展示插件时，在 `ctx.action(name, description, schema, handler, { activate: true })` 的最后一个参数声明。动作成功后统一激活所属插件，圆盘选中项、旋转位置和插件 UI 同步；动作失败或被前置钩子拒绝时不激活。内置的文件导入、剪贴板收录，以及待办、片段和单词新增已声明此行为。只读查询、定时轮询保持当前界面。
- 后台插件可以在处理函数或钩子中调用 `ctx.ui.activate({ itemId, reason, transient })`，动态 UI 的 `mount(root, ctx)` 中提供 `ctx.activate({ itemId, reason, transient })`。宿主自动补全所属插件 ID，`itemId` 可省略，默认保持界面打开以便查看结果。MCP 可调用 `ui_activate {"pluginId":"todo"}`，需要「桌面」权限。后台动作在桌面离线时仍可成功保存数据，激活请求返回离线状态。
- 激活沿用 `before:ui.activate` / `after:ui.activate` 与现有 `before:ui.transition` 钩子。阻止自动激活不会撤销已成功的业务动作；可通过统一日志追踪。已选中的插件再次响应时会取消未结束的滚动切换，保持圆盘与 UI 一致。
- 用 `ctx.hook('before:ui.transition', callback)` 对面板切换作判断。回调收到 `method`、`params` 和 `origin`，返回 `{ allowed: false, reason: '…' }` 可拒绝切换。也可订阅 `after:<动作名>` 观测结果。热重载时，服务会释放旧实例注册的钩子、订阅和定时回调。若插件自行建立其他资源，`activate` 可返回清理函数。

## 本机路径与发行

当前 Windows 项目按 D 盘规范落位。开发和安装使用相同的后台服务协议。

| 内容 | 当前机器路径 |
| --- | --- |
| 源码与开发插件 | `D:\src\local\dongzw\notchdesk` 与其中的 `plugins` |
| SQLite 数据、剪贴素材与安装版插件 | `D:\environments\data\NotchDesk` |
| 桌面配置 | `D:\environments\state\notchdesk\desktop` |
| 日志 | `D:\environments\logs\notchdesk` |
| 构建缓存 | `D:\environments\cache\notchdesk` |
| 发行物 | `D:\environments\data\artifacts\notchdesk` |
| 测试临时状态 | `D:\environments\temp\notchdesk` |

自定义运行目录可用 `NOTCH_DATA`、`NOTCH_PLUGINS` 和 `NOTCH_LOGS`。未设置 Windows 的 `XDG_DATA_HOME` 时，应用在系统应用数据目录下使用 `NotchDesk`。macOS 默认使用 `~/Library/Application Support/NotchDesk`。开发入口仍为 `pnpm start`。

| 目标 | 命令 |
| --- | --- |
| 当前平台解包目录 | `pnpm run pack:dir` |
| Windows x64 | `pnpm run dist:win:x64` |
| Windows ARM64 | `pnpm run dist:win:arm64` |
| macOS 双架构安装包 | `pnpm run dist:mac` |
| macOS Intel x64 | `pnpm run dist:mac:x64` |
| macOS Apple Silicon | `pnpm run dist:mac:arm64` |
| macOS 双架构签名并公证 | `pnpm run dist:mac:signed` |
| macOS 解包目录 | `pnpm run pack:mac:arm64` / `pnpm run pack:mac:x64` |

发行包包含 Electron 桌面、本地服务、MCP 入口、内置插件以及对应平台和 CPU 的 Node 运行时，用户安装后无需另装 Node。打包脚本固定使用 `package.json` 中的 `notchdesk.runtimeNodeVersion`，从 Node 官方发行文件准备运行时、核对官方 SHA-256，再检查 Node 与 Electron 主程序的二进制架构，避免把构建机的 Windows 或另一种 CPU 运行时装进包内。运行时许可证随包分发。

### macOS 安装包

请从当前 GitHub 仓库获取最新源码，包含 README、完整源码、八个内置插件、打包脚本、资源文件、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml`。依赖在 Mac 上重新安装，源码不携带 Windows 的 `node_modules`、本机业务数据、账号凭据或已有安装包。首次构建需要联网下载 pnpm 依赖、Electron、构建工具及两套 Node 运行时，不是离线构建包。

**1. 准备环境。** 在 Apple Silicon 或 Intel Mac 安装 Node.js 24.13+（本项目打包运行时为 24.19.0）以及 pnpm 11.20.0；如果没有 pnpm，运行 `npm install --global pnpm@11.20.0`。首次使用命令行开发工具时，在终端执行：

```sh
xcode-select --install
```

等待系统安装完成；若提示已安装，可直接继续。后面的命令使用普通用户执行，无需 `sudo`，默认 ad-hoc 签名也无需 Apple 开发者账号。

**2. 获取源码并进入项目。** 私有仓库需先为 Git 配置已授权的 GitHub 登录，浏览器登录不会自动给所有终端配置 Git 凭据。在终端执行：

```sh
git clone https://github.com/dongzhiwei-us/notchdesk.git
cd notchdesk
```

也可在仓库页面通过 Code → Download ZIP 下载最新源码，在 Finder 双击解压，再进入解压后的 `notchdesk-main` 目录，继续第 3 步。已有 Git 工作副本可执行 `git pull --ff-only` 更新。pnpm 迁移前分发的源码 ZIP 仍是旧版本，请重新获取当前源码。

若当前电脑已配置该账号的 GitHub SSH 公钥，也可用 `git clone git@github.com:dongzhiwei-us/notchdesk.git`。先运行 `ssh -T git@github.com`，返回 `Hi dongzhiwei-us!` 表示身份正确；GitHub 不提供交互式 shell，因此该验证命令返回退出码 1 属正常行为。另一台 Mac 需配置自己的 SSH 密钥，不能仅凭 Windows 上的密钥备注邮箱完成认证，也不要把私钥提交到仓库。

**3. 安装依赖并生成两个架构的安装包。**

```sh
node --version
pnpm --version
xcode-select -p
pnpm install --frozen-lockfile --prod=false
pnpm run check
pnpm run dist:mac
open release
```

`pnpm install --frozen-lockfile --prod=false` 保留构建所需的 Vite、TypeScript、Electron 和 electron-builder。不要从 Windows 复制 `node_modules`，也不要使用 `--prod` 或 `--no-optional`；Vite 使用的 esbuild/Rollup 原生依赖需要按当前 Mac 架构安装。`pnpm-workspace.yaml` 显式允许 Electron、esbuild、fsevents 与 electron-winstaller 所需的安装脚本。不要用其他包管理器重新生成锁文件。构建不依赖 Git 仓库元数据，可直接在解压后的源码目录执行。

同一台 Mac 可以依次构建两个架构。也可以通过上表命令只构建其中一种。这里的 Intel / `x86` 指 **64 位 x64**，`dist:mac:x86` 是 `dist:mac:x64` 的别名；不提供 32 位安装包。`dist:mac:all` 与 `dist:mac` 等价。

默认输出到项目的 `release` 目录，可用 `NOTCH_ARTIFACTS` 指定产物根目录。每种架构生成可拖入 Applications 安装的 DMG，以及包含 `.app` 的 ZIP，例如当前版本：

```text
release/
  mac-arm64/
    NotchDesk-0.6.8-mac-arm64.dmg
    NotchDesk-0.6.8-mac-arm64.zip
    SHA256SUMS.txt
    build-manifest.json
  mac-x64/
    NotchDesk-0.6.8-mac-x64.dmg
    NotchDesk-0.6.8-mac-x64.zip
    SHA256SUMS.txt
    build-manifest.json
```

**4. 安装。** Apple Silicon 使用 `mac-arm64` 下的 DMG，Intel Mac 使用 `mac-x64` 下的 DMG。打开对应 DMG，将 NotchDesk 拖到 Applications（应用程序），再从应用程序启动。每个 ZIP 同样包含对应架构的 `.app`，可以解压后放入应用程序。构建命令成功只说明安装包生成完成，另一种架构的实际启动仍需在对应机器验收。

**下载或依赖失败时：** 先检查网络及代理是否可用。原生依赖缺失时，在当前 Mac 上重新运行 `pnpm install --frozen-lockfile --prod=false`；不要手动复制另一个系统的依赖。Electron 下载可通过 `ELECTRON_MIRROR` 配置兼容镜像，Node 运行时镜像配置见下文。若报 Node 版本过低，先切换到 24.13+ 再重新安装依赖。构建失败时保留终端中第一条错误，重新运行同一个架构命令即可，无需清除业务数据。

`SHA256SUMS.txt` 校验最终安装包；`build-manifest.json` 记录版本、架构、Electron/Node 版本、运行时来源与最终产物哈希。运行时缓存可用 `NOTCH_RUNTIME_CACHE` 覆盖；本机遵循 D 盘规范，使用 `D:\environments\cache\notchdesk\runtimes`。需要镜像时可设置 HTTPS 的 `NOTCH_NODE_MIRROR`（版本目录的父地址），文件仍按 Node 官方清单校验。

默认使用 ad-hoc 签名，不需要 Apple 证书；从网络下载后，macOS 可能要求确认来源。公开分发建议使用 Developer ID 签名和公证。在当前进程环境中提供以下凭据，再运行 `pnpm run dist:mac:signed`：

- `CSC_LINK`：Developer ID Application 的 `.p12` 证书文件路径或 electron-builder 支持的证书内容；`CSC_KEY_PASSWORD` 为证书密码。也可改用已装入钥匙串的 `CSC_NAME` 或 `NOTCH_MAC_IDENTITY`。
- 公证使用 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 三项；也支持 `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`，或 `APPLE_KEYCHAIN_PROFILE`。

只签名可执行 `pnpm run dist:mac --signed`；脚本会提前检查凭据，给嵌入的 Node 设置执行权限并纳入应用签名，签名模式启用 hardened runtime。凭据仅通过环境或 CI Secrets 提供，不提交到源码。具体签名与公证机制见 [electron-builder macOS 文档](https://www.electron.build/v26/docs/mac/)。

### Windows 准备与云端构建

Windows 可以运行 `pnpm run dist:mac:plan` 查看两个架构的构建计划，运行 `pnpm run prepare:mac` 下载、校验并缓存两套 Mac Node 运行时。DMG 制作和 macOS 签名依赖 macOS 工具，实际构建须在 Mac 执行；Windows 的打包命令会提前提示，不会把 Windows 程序改名当作 Mac 应用。

项目包含 `.github/workflows/package.yml`。将源码提交到自己的 GitHub 仓库后，在 **Actions → Desktop packages → Run workflow** 选择 `mac`，会分别使用 Apple Silicon 和 Intel runner 构建，完成后下载 `NotchDesk-mac-arm64` 与 `NotchDesk-mac-x64` 两组 Artifacts。选择 `all` 时同时构建 Windows。`v*` tag 也会触发全部架构构建；工作流仅上传构建产物，不自动发布 Release。

需要 CI 签名时，在仓库 Secrets 配置 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`，并勾选 `sign_mac`；需要公证时再配置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 并同时勾选 `notarize_mac`。默认不使用这些凭据。

本次在 Windows 完成脚本语法、类型检查、生产构建，以及两套 Mac Node 下载、官方校验和 Mach-O 架构检查。尚未在 Mac 执行打包、安装和运行验收，本机没有生成 DMG。补充打包脚本不需要重启正在使用的 Windows 桌面程序。

## 测试

```powershell
pnpm run check
pnpm run build
node scripts/plugin-smoke.cjs
node scripts/plugin-smoke.cjs --online
node scripts/windows-smoke.mjs
```

插件测试验证 CRUD、提醒计划、剪贴资产、会话请求状态、晨报和仓库趋势解析。`--online` 会读取真实 GitHub Trending，账号和桌面 I/O 在该测试中使用模拟宿主。Windows 桌面脚本使用隔离的数据与插件目录，启动 Electron 和 MCP 客户端验证交互。可设置 `NOTCH_TEST_EXE` 指向解包版 Windows 可执行文件，再运行同一脚本验证安装包。

默认石墨主题采用银白与中性深灰，蓝色标记选中与主要操作。主刘海和剪贴绳窗口在 Windows、macOS 都保持逐像素透明，可见组件使用 CSS 底色、边框和局部材质，不在整块透明窗口上启用原生 Acrylic、DWM blur 或 macOS vibrancy。系统减少透明度、增强对比度和减少动态效果有对应降级。Apple Design Skill 安装于 `C:\Users\dongz\.codex\skills\apple-design`，本次圆盘设计参考其材质、动效和无障碍规范。

### macOS 启动白色置顶矩形修复（2026-11-25）

原实现会在 Mac 的透明主窗口和整屏剪贴绳窗口上启用 `setVibrancy('popover')`。原生材质作用于完整窗口，而 Mac 不支持用 `setShape` 裁去空白区域；即使轮盘已收起，500×620 左右的主窗口仍可能留下浅色矩形，并随刘海保持置顶。现已统一清除这两个窗口的整窗 vibrancy 并重设透明底色，启动 HTML 也在加载样式前声明透明背景。组件自身的底色、圆角、半透明效果及鼠标穿透逻辑继续保留。Electron 的 [vibrancy](https://www.electronjs.org/docs/latest/api/base-window#winsetvibrancytype-macos) 与 [窗口形状](https://www.electronjs.org/docs/latest/api/base-window#winsetshaperects-windows-linux-experimental) 文档说明了这些 API 的作用范围和平台支持。

在 Mac 更新源码后执行 `pnpm install --frozen-lockfile --prod=false`、`pnpm start`；使用安装版时，需重新运行 `pnpm run dist:mac:arm64` 或 `pnpm run dist:mac:x64` 并替换旧应用。更新前先通过菜单栏托盘退出旧实例，避免单实例保护将启动请求转发给旧进程。本修复在 Windows 完成类型检查与生产构建，Mac 原生启动、浅色/深色切换及剪贴绳展开仍需在 Mac 上确认。


## 语言与插件语言规范

外观设置中的界面语言支持跟随系统、简体中文和 English。语言枚举集中在 `src/shared/locales.ts`，宿主文案集中在 `src/locales/zh-CN.json` 与 `en-US.json`。语言偏好持久化在服务端主题配置，所有桌面窗口即时同步。系统语言来自 Electron 的系统语言列表，中文系统选中文，其余语言回退英文。MCP 的 `locale_list` 枚举选择，`locale_set({locale:"system"|"zh-CN"|"en-US"})` 设置偏好，需要开启管理能力。`theme_set` 也支持 locale 字段。

新插件应提供两个独立 JSON 语言文件，并在 manifest 中声明。宿主兼容已有未声明语言资源的插件。

```json
{
  "locales": {
    "zh-CN": "locales/zh-CN.json",
    "en-US": "locales/en-US.json"
  }
}
```

语言 JSON 是文案键到字符串的映射，例如中文文件 `{"greeting":"你好，{{name}}"}` 和英文文件 `{"greeting":"Hello, {{name}}"}`。资源必须位于插件目录内，每个文件上限 512 KiB。资源文件会随插件一起校验、复制和热加载，加载失败保留上一个可用版本。内置八个插件均提供语言文件。缺失的文案回退到中文，再回退到文案键。第三方独立 mount 面板使用 `ctx.locale` 获取当前解析后的语言，用 `ctx.t('greeting',{name:'Ada'})` 翻译，语言切换时宿主重新挂载该面板并调用旧清理函数。

后台插件使用 `ctx.locale()` 和 `ctx.t(key, values)`。`ctx.hook('locale.changed', callback)` 可以响应语言设置变更，`ctx.hook('after:ui.settled', callback)` 可以响应面板过渡完成。插件的动态配置标签也应出现在语言资源中。用户输入的任务标题、笔记、文件名与片段内容保留原文。

内置 React 面板的开发源文件位于各插件文件夹，随 Vite 构建。通过 manifest 声明的独立 UI ES 模块支持运行时替换，扩展应以该模块作为发布入口。

八个插件的运行与轮盘入口独立：默认轮盘保留待办、剪贴绳、片段、词汇、趋势、晨报六个主动浏览入口；会话召回与喝水走动默认后台运行，在设置中配置并通过通知处理。词汇仍保留词库管理和主动复习，晨报仍保留报告浏览，因此保留入口。系统调度、通知等级、去重、勿扰、工作空闲检测和 MCP 能力不受隐藏入口影响。

0.6.0 的收起过程保留旧面板与 Windows 原生绘制范围：圆盘在 240ms 内向顶端收拢，面板上移淡出，260ms 后恢复 88×12 收起条的命中区域，避免 `setShape` 提前裁掉动画。收起期间重新打开会取消旧收起计时器，系统减少动态效果时立即完成。MCP `ui_snapshot` 提供 `closing` 状态，过渡结束继续触发 `after:ui.settled` 钩子。真实工作调度通知、设置/MCP/热加载展示偏好、重启恢复和逐帧收起验证位于 `scripts/presentation-smoke.mjs`。

0.6.1 修正 Windows 收起后整块桌面仍被模糊的问题：主窗口使用真正的逐像素透明，Windows 主窗口和剪贴绳均不再启用整窗 Accent/Acrylic 模糊。系统合成的整窗模糊会越过透明内容的可见范围，形成常驻矩形；改由可见组件的 CSS 材质表现半透明和层次。此版按用户要求停止继续运行测试，仅完成构建与本机运行更新。

0.6.2 调整内容可读性：圆盘和内容面板采用约 94%–96% 的不透明度，预览采用约 96%–98%，剪贴绳背景约 79%–86%。浅色和深色均提高底色遮挡，保留局部高光、边框和半透明层次；窗口空白处继续完全透明，不启用整窗系统模糊。

0.6.3 移除包住挂件组的背景方框及其鼠标命中区域，只保留整屏绳子、夹子、挂件与独立操作按钮。绳身全宽可拖动，夹子可沿整屏绳子独立摆放并保存位置，空白处让鼠标穿透到其他软件；悬停和点击时的内容预览继续保留。按用户要求仅构建并更新运行版本，不运行测试。

0.6.4 优化剪贴绳拖动路径：鼠标事件通过 requestAnimationFrame 合帧，夹子拖动的尺寸在按下时读取，移动过程中只写合成位移；整条绳子移动使用 translate，松手后提交位置。修正拖动时 CSS 缓动导致的跟手延迟。内部拖动开始时临时准备透明绘制范围，暂停窗口形状重建和后台列表刷新，松手后恢复精确输入区域；该机制不用于原生文件拖出。命中区域改为按实际结构变化更新，忽略鼠标高光与 SVG 绳形变化，移除原先连续 650ms 的全列表测量循环。挂件松手后只对垂直拉伸和摆动做短暂回弹，避免横向位置重复叠加。已完成类型检查和构建，未运行桌面测试。

0.6.5 将 Windows 外部点击和前台切换监听从剪贴绳推广到所有展开视图，修复片段、待办、词汇、趋势等表单处于编辑状态时不响应失焦的问题。“编辑中”只保护鼠标移开时的自动收起，真正切换到其他软件或点击外部仍执行收起动画。系统文件选择器使用所属窗口和显式保护计数，应用自身的原生菜单与设置窗口不误判为外部窗口；原生拖出与内部拖动继续保护。鼠标事件携带发生时的物理坐标和窗口进程，按屏幕 DPI 转换，避免异步处理时读取已移动的鼠标位置。内置四个编辑表单及宿主通用操作表单采用共享的内存草稿机制，关闭后在本次运行中可恢复，保存/取消清除对应草稿；独立插件 UI 可继续通过自身 SDK 存储管理草稿。已完成代码检查、类型检查和构建，未运行桌面交互测试。

0.6.6 在剪贴绳右侧工具栏增加整条绳子的固定图钉，与挂件“置顶”独立。点亮后鼠标离开、失焦、点击外部、复制内容与拖出文件均保留当前展示；取消固定恢复自动收起。关闭按钮、Esc、打开设置和主动切换插件仍可收起或离开，固定偏好保存后在下次打开剪贴绳时沿用，重启不主动展开。MCP `clip_window_get` / `clip_window_set({pinned:true|false})` 读取、保存并同步固定状态，属于剪贴绳文件权限组；桌面离线时保存偏好并返回 `synced:false`，下次打开恢复。`ui_snapshot` 的 `rope.pinned` 返回桌面当前固定状态。切换固定状态不重新打开窗口或清空预览。已完成类型检查、构建与运行更新，未运行桌面交互测试。

0.6.7 将固定内容与圆环显示彻底分离：Pin 只固定剪贴绳和挂件，圆环继续按鼠标离开、失焦、主动关闭等规则收起；切换其他插件和打开设置也不撤下固定内容。鼠标经过固定内容不展开圆环，预览、复制、拖动、拖出、文件选择等操作在圆环收起时独立工作。圆环相关的 `ui_open({view:"closed"})` 只关闭圆环，新增 `clip_window_hide` 单独收起剪贴绳；绳子自己的“×”或在绳子内按 Esc 使用独立收起动作。取消固定时，如果圆环已经离开剪贴绳视图则收起内容；固定偏好保持原有持久化方式。`ui_snapshot` 可以同时呈现 `view:"closed"` 与 `rope.visible:true, rope.pinned:true`。禁用或卸载插件会撤下固定内容。已完成类型检查、构建与运行更新，未运行桌面交互测试。

0.6.8 修正预览遮挡挂件操作栏及移动鼠标时预览消失的问题。操作按钮点击区域扩大到 32px，操作栏保持单排，靠近屏幕边缘时向内避让。悬停预览先避开整排操作栏，下方不足时改到侧边或上方；点击后的大预览也根据可用区域调整位置和高度。图片、操作栏和悬停预览组成连续交互组，透明连接区域只负责鼠标过渡，不绘制容器背景；真正离开后延迟 400ms 关闭悬停预览。当前预览所属挂件的按钮保持可见，窗口原生命中区域显式包含完整操作栏和连接区域，避免点击穿透。未改变整条绳子的固定与圆环独立收起规则。已完成类型检查和构建，未运行桌面交互测试。


## 0.2.0 交互调整

收起状态为 88×12 逻辑像素，圆盘直径为 312 逻辑像素。拖动收起条或圆盘内圈标题可移动刘海位置，松手后持久化位置，靠近屏幕顶边时吸附为半圆。MCP 的 `theme_set` 支持 `position:{x,y}` 与 `wheelPlacement`，坐标采用桌面逻辑像素。

剪贴绳默认直接展示绳子与挂件，操作按钮在悬停和键盘聚焦时显示。按住挂件拉动会带动绳子弯曲，松手后回弹，拖到其他挂件上可排序。普通 Ctrl+V 在已聚焦的刘海中收录，系统级快捷键默认为 Ctrl+Alt+V，macOS 使用 Command+Option+V。可在插件设置的上绳快捷键中修改，格式遵循 Electron accelerator。快捷键收录后会直接展示绳子，鼠标持续在外时约 4.5 秒后收起。复制挂件、打开外部内容和完成通知操作会收起浮层，实际输入和文件选择期间保留编辑状态。

账号与来源页面为 GitHub、GitLab 提供浏览器登录按钮。首次登录需配置自己注册的 OAuth 应用，页面包含平台注册入口和回调地址。Client ID 与 Client Secret 使用本机系统凭据加密保存，后续可直接登录。GitHub 授权码交换需要 Client Secret，GitLab 可以使用启用 read_api 的非机密 PKCE 应用。回调固定为 http://127.0.0.1:49317/callback，成功后自动返回设置。访问令牌方式收在高级连接选项中。平台要求与注册方法见 GitHub 和 GitLab 的官方 OAuth 文档。

本机 0.2.0 发行物放在 `D:\environments\data\artifacts\notchdesk\0.2.0\win-x64`。首次升级会备份并更新未声明自定义 UI、版本仍匹配旧内置版本的内置插件，旧目录备份在业务数据的 plugin-backups 下。第三方插件和业务数据保留原配置。


0.2.1 修正剪贴绳展开时隐藏转盘的问题。剪贴绳显示在转盘下方，可直接点击转盘切换其他插件，并保留转盘的原生鼠标命中区域。


0.2.2 规定轮盘只通过鼠标滚轮或触控板横向、纵向滑动切换插件。插件图标只显示状态，内圈标题与收起条继续负责拖动刘海位置。


0.2.3 默认从顶部收起条展开为完整圆盘，显示全部插件。悬停在下一帧发起展开，使用 240ms 缩放与淡入过渡。Windows 绘制范围按完整布局尺寸一次准备，避免动画期间的缩小尺寸造成延迟裁切。轮盘的插件切换仍只响应鼠标滚轮与触控板滑动。


0.2.4 支持将本地文件直接拖到收起的刘海、转盘或插件区域。接近时展开接收区域并提示，释放后按剪贴绳原有的引用或复制配置挂载文件，自动展示绳子。支持一次拖入多个文件，重复文件沿用去重规则，个别文件失败时保留已成功挂入的文件并提示。


0.2.5 固定展开前后的收起条触发范围，原生窗口绘制与命中范围始终包含该区域。悬停状态统一由桌面指针位置判定，修复鼠标停在顶部边缘时反复展开收起的闪烁。
