# OpenCode Project Sessions

OpenCode Desktop 的项目会话导航插件。通过会话 header 中“摘要”右侧的文件夹按钮或命令面板中的 **打开项目会话 / Open project sessions**，在独立弹窗中查找并切换会话，不修改原生左侧导航。

## 功能

- 按 server 和完整项目根目录分组，同一项目的 worktree 合并展示；非 Git 目录分别分组。
- 分页读取所有已列出服务器的未归档主会话，不限于已打开的标签页；不展示子智能体会话。
- 搜索项目名、会话标题和目录，支持多关键词；保留项目分组。
- 筛选当前项目，或一键定位当前会话。
- 当前项目优先，其余项目及组内会话按最近更新时间排列；同一次打开期间不因后台更新重新排序。
- 每个项目先显示最近 8 条，可逐步展开；当前会话不受此数量限制，搜索时显示全部匹配结果。
- 保存项目折叠状态、展开数量、筛选范围和非搜索视图的滚动位置。第一次打开时仅展开当前项目。
- 加载期间逐页展示结果；连接中断时保留本窗口已缓存的会话，显示提示并支持重试。
- 中文和英文界面，跟随 OpenCode 语言与主题。

## 安装

面向 **OpenCode Desktop 2.2.5** 的 experimental GUI plugin API。其他版本需要核实插件 API 兼容性。

```sh
cd ~/repos/github.com/saltfishpr/opencode-project-sessions
pnpm install
pnpm run build
```

在全局 `~/.config/opencode/opencode.json(c)` 的 `plugins` 数组中追加插件目录。保留原有配置和其他插件，路径中的用户名替换为自己的用户名：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/Users/your-name/repos/github.com/saltfishpr/opencode-project-sessions",
  ],
}
```

配置会自动加载，无需重启。可以在 **Settings → Extensions → Plugins** 中停用 GUI。插件没有额外的 server 入口，不需要 API key，也不发送消息或修改会话。

## 操作

| 操作             | 交互                                               |
| ---------------- | -------------------------------------------------- |
| 打开导航器       | 会话 header 中“摘要”右侧的文件夹按钮，或命令面板中的“打开项目会话” |
| 展开 / 折叠项目  | 单击项目标题；搜索时匹配项目自动展开               |
| 切换会话         | 单击会话，或聚焦后按 Enter；实际切换成功后关闭弹窗 |
| 从搜索框进入列表 | ↓                                                  |
| 移动焦点         | ↑ / ↓；Home / End 移动到首尾                       |
| 展开 / 折叠项目  | 聚焦项目时按 → / ←；会话行按 ← 返回项目标题        |
| 关闭弹窗         | Esc、关闭按钮或单击弹窗外部                        |

插件不预设全局快捷键。可以在 **Settings → Shortcuts → Navigation** 中为“打开项目会话”设置快捷键。命令 ID 为 `opencode-project-sessions.open`。

文件夹按钮通过官方 `session.header` 插槽显示，支持顶部 tab 和 side tab 模式。主页没有会话 header，可通过命令面板或配置的快捷键打开导航器。

分支名仅在 OpenCode 已有对应 VCS 信息时显示，否则仅在会话目录与项目根目录不同时显示目录，不重复显示项目名。运行状态使用会话信息及宿主已同步的数据；“待授权 / 待输入”只在宿主已知对应请求时显示，不能替代原生通知或完整的待处理列表。已断开连接的服务器不显示实时状态。

## 开发

```sh
pnpm run typecheck
pnpm run build
pnpm run dev
```

`dev` 监听并重新构建 GUI bundle；配置为本地插件目录后，OpenCode 自动重新加载 GUI。构建产物为 `dist/gui-experimental.cjs`，修改 `src/`，不要直接修改产物。

### 官方 UI 对齐

弹窗、输入框、按钮、Tooltip、图标及快捷键提示直接使用 `ctx.ui` 中的官方组件。自定义列表继承宿主字体，使用官方 `--v2-*` 主题变量，不引入字体文件或硬编码主题颜色。

参考官方仓库快照 [`ffe6fed58334d921f64a86a8d86128bff5a4b566`](https://github.com/anomalyco/opencode/tree/ffe6fed58334d921f64a86a8d86128bff5a4b566)：

| 项目       | 对齐依据                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 弹窗       | `packages/ui/src/overlays/dialog/dialog.css`：使用原生弹窗，宽度收窄为 520px、高度上限 720px、6px 圆角；小窗口限制宽高。标题字号由官方组件控制。 |
| 列表文字   | `packages/app/src/shell/commands/dialog.css`：13px / 16px、字距 -0.04px；标题字重 530，描述字重 440。                            |
| 时间与状态 | `packages/app/src/shell/titlebar/inbox.tsx`：12px / 16px，弱化文字颜色，时间使用等宽数字。                                       |
| 交互组件   | `packages/app/src/runtime/plugin/ui.tsx`：通过 `ctx.ui` 直接使用宿主组件。                                                       |

数据查询使用 `ctx.servers.get(id).client`，复用 Desktop 已认证的连接。会话列表沿 `cursor.next` 分页读取，打开会话使用 `ctx.tabs.open`。关闭弹窗会取消请求并移除事件监听。
