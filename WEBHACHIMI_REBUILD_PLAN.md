# WebHachimi 整体重构与功能承接计划

## 任务定义

当前任务不是把 `E:\Hachimi\WebHachimi` 原样复制到 `E:\WebForAll\WebForAll`，也不是只做少量 UI 美化。

准确目标是在当前工作区中重构一个新的 WebHachimi 项目：

- 以 `E:\Hachimi\WebHachimi` 作为功能原型、行为证据和设计参考。
- 在 `E:\WebForAll\WebForAll` 中建立新的主项目。
- 承接核心功能和产品思路，重做 UI 信息架构，改善工程结构。
- 保留并强化“编辑器 + 运行时 + 任务系统 + 超级画笔 + AI 自动修改 + AI 自主测试”的闭环。
- 优先保证桌面编辑器体验，玩家端保持可直接运行和发布。

“迁移”只表示提取可用素材和行为证据；真正的工程动作是重构。旧结构不是目标，新结构才是目标。

## 当前项目判断

WebHachimi Engine 是一个 2D 网页游戏引擎 / 编辑器原型。

它目前包含三条主要线索：

| 部分 | 内容 | 当前状态 |
| --- | --- | --- |
| Legacy 编辑器 | `index.html`、`styles.css`、`app.js` | 功能多，但代码集中，适合作为重构参考 |
| v2 TypeScript 重构 | `src/` 下的项目模型、运行时、AI、测试、编辑器、玩家端 | 架构已搭起，但仍有原型痕迹 |
| 构建产物 | `dist-v2/` 下的 `v2.html`、`player.html` 和打包资源 | 可作为发布参考，但不应当作源码重构主体 |

整体评价：

- 产品方向清楚，有特色。
- 架构文档和数据模型比较成熟。
- 原型完成度中等偏上。
- 工程成熟度还需要整理。
- v2 主入口过大，存在继续膨胀成第二个 `app.js` 的风险。
- AI / 自动测试闭环概念很好，但当前更接近规则式原型。

## 运行入口与数据边界

### Legacy 入口

```powershell
npm run serve
```

默认访问：

```text
http://localhost:5577/
```

Legacy 项目数据：

```text
data/project.json
```

### v2 开发入口

```powershell
npm run dev
```

主要页面：

```text
v2.html
player.html
```

v2 项目数据：

```text
data/v2-project.json
```

### 构建入口

```powershell
npm run build
```

输出目录：

```text
dist-v2/
```

### 接口风险

Legacy 和 v2 都使用过 `/api/project` 这个接口语义，但保存目标和数据结构不同：

- Legacy 服务端保存 `data/project.json`
- v2 Vite 插件保存 `data/v2-project.json`

后续应明确区分：

- Legacy: `/api/project`
- v2: `/api/v2/project`

或者在统一服务端中明确标注并隔离两种数据结构。

## 架构资产

### 项目数据层

核心目录：

```text
src/project/
```

关键模块：

- `schema.ts`
- `projectStore.ts`
- `transactions.ts`
- `diff.ts`
- `persistence.ts`
- `tasks.ts`
- `maintenance.ts`

这部分是项目最有价值的资产之一。它已经围绕以下概念建立结构：

- `Project`
- `Scene`
- `Entity`
- `Resource`
- `Task`
- `Transaction`
- `RuntimeSnapshot`
- `TestRecord`
- `AutonomyRun`

后续翻新时应保留并强化这一层，让所有用户编辑、AI 修改、测试记录和回滚点都落到稳定项目数据上。

### 运行时层

核心模块：

- `src/runtime/world.ts`
- `src/runtime/collision.ts`
- `src/runtime/time.ts`

已有能力：

- 固定步进
- 游戏 / 冻结编辑模式切换
- 玩家控制
- 敌人巡逻
- 重力
- AABB 碰撞
- 攻击 / 格挡 / 战斗事件
- 临时实体
- 运行态快照
- 快照恢复

“按 Z 冻结运行态并生成快照”的方向很重要，应该保留为核心产品特性。

### AI / 任务执行层

核心模块：

- `src/ai/intentPlanner.ts`
- `src/ai/taskExecutor.ts`
- `src/ai/autonomyLoop.ts`

当前更准确的定位是“规则式 AI 规划器”，不是通用大模型式 AI。

建议后续产品表述拆成三类：

- 规则式 AI 任务规划器
- 外部 LLM / 代码修改器接口
- AI 自主测试器

这样可以避免用户误以为当前系统已经能理解任意复杂需求并自由改代码。

### 自主测试层

核心目录：

```text
src/testing/
```

已有思路：

- 输入序列回放
- 冻结并检查状态
- 战斗事件检查
- trace 记录
- 失败任务生成
- AI 自主测试轮次
- timing sweep

这部分非常适合支撑“AI 修改后自动验证”的目标，但后续需要补更多稳定测试和端到端验证。

## 主要风险

### P0: v2 主文件过大

`src/v2/main.ts` 约 2000 多行，承担职责过多：

- UI 初始化
- 状态管理
- Canvas 交互
- 属性面板
- 任务面板
- AI 执行
- 自主测试
- 保存加载
- 键盘输入
- 超级画笔
- 运行时控制
- 面板 resize
- notice 渲染

这是当前最明显的维护风险。

建议拆分方向：

- `editorState.ts`
- `canvasController.ts`
- `keyboardController.ts`
- `toolbar.ts`
- `propertiesPanel.ts`
- `tasksPanel.ts`
- `assetsPanel.ts`
- `aiPanel.ts`
- `persistenceController.ts`
- `runtimeController.ts`

### P0: 编辑器操作没有完全事务化

文档目标是：编辑器不直接拥有权威状态，修改应通过项目层、事务、diff、测试结果和回滚点呈现。

当前风险是：v2 中部分操作可能直接改 `RuntimeWorld` 里的实体，然后保存时再同步回项目。这会导致：

- 移动 / 缩放 / 旋转不一定形成 transaction
- undo / redo 难以覆盖所有编辑操作
- AI 看到的 `ProjectStore` 状态可能和画布状态不一致
- 保存前执行 AI 任务可能基于旧数据
- diff 和回滚点不完整

目标流程应统一为：

```text
UI 操作
-> 生成 ProjectPatch
-> ProjectStore.applyTransaction()
-> RuntimeWorld 根据事务热更新
-> UI 重新渲染
```

优先事务化的操作：

- 移动实体
- 缩放实体
- 旋转实体
- 修改属性
- 创建实体
- 删除实体
- 添加资源绑定
- 编辑任务
- 超级画笔生成任务

### P1: `runAutonomousRound()` 存在重构残留风险

审查建议指出：`src/v2/main.ts` 中 `runAutonomousRound()` 可能在 `renderAll(); return;` 后保留不可达旧代码。

后续开工时需要核实并清理。

### P1: Legacy 与 v2 边界混淆

当前并存：

- `index.html`
- `app.js`
- `styles.css`
- `v2.html`
- `src/v2/*`
- `player.html`
- `src/player/*`
- `server.js`
- `vite.config.ts`
- `data/project.json`
- `data/v2-project.json`
- `dist-v2/`

后续需要在 README 和项目结构中明确：

- 推荐入口是什么
- Legacy 是否只作为参考保留
- v2 编辑器怎么运行
- v2 玩家端怎么运行
- 哪个接口保存哪个文件
- 发布包和源码包分别包含什么

### P1: 打包卫生

重构和交付时不要带入：

- `.git/`
- `node_modules/`
- 旧构建产物 `dist-v2/`

建议区分两种包：

- 源码包：`package.json`、`package-lock.json`、`src/`、`data/`、文档和配置。
- 发布包：只保留 `dist-v2/` 和必要静态资源。

### P2: 物理系统还处于基础阶段

当前物理更接近原型级：

- AABB 为主
- circle / polygon 尚未形成真实碰撞差异
- 没有连续碰撞
- 高速物体可能穿透
- kinematic 行为不完整
- trigger / sensor 事件体系还不完整
- 斜坡、单向平台、墙面检测还没有真正补齐

后续增强方向：

- swept AABB
- trigger event
- sensor query
- body mode 语义
- collision layer / mask 完整测试
- one-way platform
- wall / ground detection
- projectile / hitbox 生命周期

### P2: 跨平台脚本偏 Windows

当前风险点：

- `serve:preview` 使用 Windows CMD 的 `set ...&&` 写法。
- `server.js` 自动打开浏览器可能使用 Windows 风格命令。

建议后续改成跨平台方案，或者默认不自动打开浏览器，只打印 URL。

## UI 翻新原则

UI 优化是本次重构的优先级核心，不做局部换皮。

### 产品定位

这是一个桌面 2D 游戏编辑器工作台，不是营销页，也不是普通后台管理系统。

UI 应该优先满足：

- 长时间编辑
- 快速选择对象
- 快速看清运行态
- 快速理解 AI 任务和测试结果
- 方便回滚和审查修改
- 不让用户在 Legacy / v2 / player 概念中迷路

### 信息架构

建议主界面分成：

- 顶栏：项目、运行、保存、加载、构建状态。
- 左侧工具栏：选择、超级画笔、形状、辅助视图等高频工具。
- 左侧层级面板：场景、文件夹、实体树。
- 中央画布：最高优先级区域。
- 右侧检查器：属性、资源、行为、任务。
- 底部状态栏：保存状态、运行状态、当前帧、最近操作、错误提示。

### 任务与 AI 区域

不要继续堆叠大量同级按钮。

建议按意图分组：

- 任务输入：写需求、绑定选中对象、绑定超级画笔上下文。
- 执行：排队、执行下一条、执行选中任务。
- 验证：运行自主测试、运行 timing sweep、查看失败帧。
- 维护：清理快照、维护记录、回滚点。

### 视觉原则

- 画布优先，面板服务画布。
- 控件密度高但不拥挤。
- 文字按钮只用于明确命令；高频工具尽量用图标或短标签。
- 不使用营销式 hero 或装饰性大卡片。
- 不使用单一色系堆满全屏。
- 保持稳定尺寸，避免按钮、卡片、状态文本导致布局跳动。
- 中文文案要短、准、可扫描。

## 建议实施阶段

### 阶段 0：重构前验证

在源项目做一次干净验证：

```powershell
npm ci
npm run typecheck
npm run build
npm run smoke:sweep
npm run smoke:autonomy
```

注意：验证结果必须区分清楚。

- 命令开始运行不等于成功。
- 进程存在不等于目标成功。
- 构建产物存在不等于源码可构建。
- 浏览器打开不等于 UI 正确渲染。

### 阶段 1：建立重构素材池

目标工作区：

```text
E:\WebForAll\WebForAll
```

可保留为重构素材的内容：

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `vite.config.ts`
- `src/`
- `data/`
- `README.md`
- 架构文档
- 必要入口 HTML
- 必要静态样式与 legacy 参考文件

不作为源码基础继承：

- `.git/`
- `node_modules/`
- `dist-v2/`
- 临时日志
- 本地缓存

### 阶段 2：文档和入口收敛

目标：

- 明确当前推荐入口为 v2 编辑器。
- Legacy 标记为重构参考。
- player 标记为玩家端运行入口。
- 明确开发、构建、发布、保存路径。
- 明确源项目和目标工作区的关系。

### 阶段 3：UI 壳层重建

优先重建：

- 顶栏
- 工具栏
- 左侧层级
- 中央画布容器
- 右侧检查器
- 任务 / AI 面板
- 状态栏

这阶段的目标是先建立稳定、清晰、可扩展的界面骨架。

### 阶段 4：功能承接与接线

将现有 v2 功能逐块接入新 UI：

- 场景树
- 实体选择
- transform 操作
- 属性展示
- 资源绑定展示
- 任务队列
- 超级画笔上下文
- AI 任务执行
- 自主测试结果
- 保存 / 加载
- 游戏 / 冻结切换

每接入一块，都要确认它连接到正确的数据源和状态更新路径。

### 阶段 5：事务化编辑

把所有编辑操作改成事务驱动。

完成标准：

- 每个编辑动作生成 transaction。
- 每个 transaction 有 patch / inverse patch。
- undo / redo 能覆盖主要编辑路径。
- AI 任务和用户编辑共享同一套项目修改路径。
- 运行态只作为渲染和模拟层，不再成为编辑权威源。

### 阶段 6：测试与验证

至少覆盖：

- `npm run typecheck`
- `npm run build`
- v2 编辑器浏览器渲染
- player 浏览器渲染
- 画布非空
- 实体选择
- 移动 / 缩放 / 旋转
- 保存 / 加载
- AI 任务排队和执行
- 自主测试按钮结果
- 窄屏布局不崩

后续补充自动化测试：

- transaction apply / rollback
- undo / redo
- project normalize
- runtime snapshot capture / restore
- super brush 无描述不能入队
- AI intent planner 常见指令解析
- simulation test runner 检查规则
- player movement / jump / attack / parry
- persistence fallback

## 优先级摘要

### P0

- 建立目标工作区并形成可运行的重构基线。
- 做干净 install / typecheck / build 验证。
- 明确 v2 为主入口，Legacy 为参考。
- 重建 UI 壳层。
- 把核心编辑操作接入事务系统。

### P1

- 拆分 `src/v2/main.ts`。
- 清理 `runAutonomousRound()` 等重构残留。
- 统一 v2 持久化接口。
- 整理 README 和开发文档。
- 改善任务 / AI / 测试面板的信息架构。

### P2

- 增强物理系统。
- 增加更完整的自动化测试。
- 改善跨平台脚本。
- 区分源码包和发布包。
- 为未来外部 LLM 执行器预留接口。

## 开工原则

后续实施时遵守以下原则：

- UI 优先，但不能牺牲数据一致性。
- 功能承接不是照搬旧 UI。
- Legacy 只作为参考，不作为新架构中心。
- v2 的项目数据层、事务层、运行态快照和测试闭环是核心资产。
- 先建立可维护结构，再继续扩功能。
- 每次跨系统验证都区分控制器状态、传输状态和目标状态。
- 不从“命令已发送”推断“目标已成功”。
- 不从“页面已打开”推断“UI 已正确渲染”。
