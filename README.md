# WebHachimi · 空间化 Prompt 原型工具

> 让 AI 与人类基于"同一张空间画布"协作做原型：
> 你在画布上画几何图形、排版、给图形挂任务备忘；AI 读取整张画布的几何 + 备忘，把草图转译为真实代码、UI 组件或游戏行为。

## 🚀 快速启动（制作组成员）

**第一次使用：**
1. `git clone` 这个仓库
2. 双击 `start.bat`
3. 浏览器自动打开，场景自动加载

**之后每天：**
- `git pull` 拿到队友的最新场景
- 双击 `start.bat`
- 改完场景**自动落盘**到 `scene.json` + `assets/`
- `git add . && git commit && git push` 把变更分享给团队

### 没有 Node.js？

`start.bat` 会检测。如果提示缺失：
- 去 https://nodejs.org/ 下载 LTS 版安装
- 安装完重新双击 `start.bat`

> 如果是 AI 协作伙伴帮你跑这个项目，告诉它："**我没有 Node.js，请帮我把 WebHachimi 跑起来**"，它会按本节引导你完成。

### 离线模式
直接双击 `index.html`（不启动 server）也能用，但场景只存在浏览器 localStorage 里，**不会自动落盘到磁盘**，无法 git 同步。要团队协作必须用 `start.bat`。

## 📦 仓库里的"场景数据"

由 server 自动维护，**不要手改**（除非你知道自己在做什么）：

| 文件 | 说明 |
|---|---|
| `scene.json` | 场景布局：对象坐标、属性、任务文本、附件元数据。**纯文本可 git diff** |
| `assets/<id>.<ext>` | 附件实体（图片 / SVG / JSON）。每个独立文件，git 可单独追踪/替换 |

每次浏览器里改动 → 600ms 后自动 POST 给 server → server 重写 `scene.json` 并把附件拆成独立文件 → 同时清理孤儿附件。

## 模块结构

| 文件 | 职责 |
|---|---|
| `state.js` | 纯数据层：状态、常量、normalize、快照、localStorage 持久化、撤销栈、`serializeForAI()` |
| `engine.js` | 数学 / 坐标 / 视口变换 / 舞台 DOM 渲染 |
| `editor.js` | 编辑交互：拖拽 / 缩放 / 旋转 / 锚点 / 抽屉 / 属性 / 任务 / 上下文菜单 |
| `game.js` | 游戏循环：WASD 移动、AABB 碰撞、战斗判定框 |
| `sketchTool.js` | 超画笔规划：临时多笔画 + 提交为带 SVG/JSON 附件的任务 |
| `sceneIO.js` | 场景的 zip 离线导出/导入（互发 / 备份用，团队协作不依赖它） |
| `serverSync.js` | 检测本地 server，启动后自动同步状态 ↔ 磁盘 |
| `server.js` | Node.js 本地同步服务（仅监听 127.0.0.1:5577） |
| `app.js` | 引导：加载状态 → 收集 DOM → 启动 Editor + Game + ServerSync |
| `index.html` | 页面骨架 |
| `styles.css` | 暗色主题样式 |
| `start.bat` | 一键启动（检测 Node → 启 server → 开浏览器） |

依赖单向：`state ← engine ← editor / game ← app`。

## 模式与基本操作

- 启动默认进入**游戏模式**。按 `Z` 在编辑模式 / 游戏模式之间切换。
- 编辑模式：左侧浮动工具栏、底部任务抽屉、右键菜单出现。
- 游戏模式：以上 UI 隐藏，画面只剩舞台。

### 编辑模式

- 左栏点形状按钮 → 在视口中心创建（正方形 / 圆 / 三角 / 钢笔 / 柳叶笔）
- 拖拽对象移动；八向把手缩放；外圈把手旋转；中心把手调锚点
- 选中后底部抽屉显示**对象任务**和**对象属性**；未选中时显示**全局任务**和实体列表
- 右键对象 → 重命名 / 删除
- 滚轮缩放视口（0.1% – 300%），中键拖动平移视口
- 任务支持 `1 / 1.1 / 1.2` 自动编号、完成勾选
- `Ctrl+R` 还原到上次蓝图（`captureBaseline` 快照）

### 游戏模式

- `WASD` 移动主角
- 鼠标左键单击：普攻；按住 ≥ 1 秒后松开：蓄力攻击
- 鼠标右键：朝光标方向冲刺
- 同时按住左右键：弹反
- 战斗中产生的判定框是带 `lifetime` 的子实体，过期自动消亡
- 工具栏的"瞬间捕捉"按钮：把当前画面（含战斗中产生的判定框）凝固为可编辑实体

## 角色（role）模型

每个对象有一个 `role` 字段决定它在游戏循环里的行为：

| role | 含义 |
|---|---|
| `generic` | 普通装饰 / 草图（默认） |
| `player` | 受 WASD/鼠标控制的主角 |
| `floor` | 参与 AABB 碰撞的地板 |
| `hitbox` | 战斗判定框（带 `lifetime` 自动消亡） |

> **设计要点**：`role` 是运行时身份；`name` 是给人和 AI 看的备注。两者解耦，避免"备忘文本被算法直接执行"。新建对象默认 `generic`，只有显式赋予 `player` / `floor` 才会参与游戏逻辑。

## AI 接口

```js
const snapshot = State.serializeForAI();
```

返回一个 JSON 友好结构，包含：

- `world`：画布尺寸
- `view`：当前视口
- `globalTasks`：全局任务列表
- `objects`：每个非 hitbox 实体的 `id / name / role / type / parentId / x,y,width,height,rotation,pivot / look,theme / tasks`

AI 拿到这个快照即可推断"用户在画什么、希望什么"，进而生成代码。

## 持久化

- 存储键：`localStorage['named-graphic-editor-state-v3']`
- 兼容老版本：`named-graphic-editor-state-v2`
- 存进去的是 baseline（编辑态稳定快照），不是运行时状态——刷新页面会回到上一次编辑结束的样子。

## 已知设计取舍

- 任务文本框的输入是**纯备忘**，不会被前端 JS 解析为命令。命令解析交给外部 AI。
- 任务文本和对象重命名是高频输入，只触发 `persistState`，`baseline` 在结构性变更（拖拽结束、模式切换、加任务、改尺寸）时统一回收。
- 整个项目刻意保持零构建：直接拷贝目录就能跑。
