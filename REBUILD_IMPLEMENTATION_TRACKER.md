# WebHachimi 重构落实表

## 任务口径

本项目执行的是重构，不是迁移。

- 源项目 `E:\Hachimi\WebHachimi` 是参考实现、功能原型和行为证据。
- 目标项目 `E:\WebForAll\WebForAll` 是新的主项目。
- 旧代码可以被复制进目标工作区作为素材池，但不能默认继承旧结构。
- 功能要承接，UI 要重做，工程结构要重新组织。

## 已完成

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 建立目标工作区素材池 | 已完成 | 已复制源码，排除 `.git/`、`node_modules/`，初始未带入旧 `dist-v2/` |
| 目标工作区安装依赖 | 已完成 | `npm ci` 成功，0 vulnerabilities |
| 类型检查 | 已完成 | `npm run typecheck` 通过 |
| 构建 | 已完成 | `npm run build` 通过，生成 `dist-v2/` |
| Smoke: timing sweep | 已完成 | `npm run smoke:sweep` 通过 |
| Smoke: autonomy | 已完成 | `npm run smoke:autonomy` 通过 |
| v2/legacy 数据边界 | 已开始落实 | v2 默认改为 `/api/v2/project`，legacy 保持 `/api/project` |
| README 口径 | 已修正 | 已改为“重构 / rebuild”，不再把任务称为迁移 |
| 重构计划口径 | 已修正 | `WEBHACHIMI_REBUILD_PLAN.md` 已改为“整体重构与功能承接计划” |
| v2 UI 壳层第一轮 | 已开始落实 | 顶栏、工具栏、检查器、资源区、任务区和状态栏已按重构口径重排 |
| 浏览器截图验证 | 已完成多轮 | Chrome headless 已验证 1365px 和 390px 页面渲染；任务面板经 CDP 验证可排队、预览、渲染时间轴摘要，并验证自治轮次后单独自测显示正确 |
| v2 壳层模块抽取 | 已完成第一刀 | `src/v2/editorShell.ts` 承载静态编辑器壳层，`main.ts` 保留启动和接线 |
| v2 视图文案工具抽取 | 已完成第一刀 | `src/v2/viewText.ts` 承载标签映射、格式化、HTML 转义等无副作用函数 |
| v2 摘要模型抽取 | 已完成第一刀 | `src/v2/summaryModels.ts` 承载测试/自治/维护摘要类型、解析和构造纯函数 |
| v2 面板布局控制器抽取 | 已完成第一刀 | `src/v2/panelLayout.ts` 承载面板状态、尺寸变量、resize 拖拽和右侧 dock 判断 |
| v2 面板视图 HTML 抽取 | 已完成第一刀 | `src/v2/panelViews.ts` 承载层级条目、检查器和资源列表 HTML；事件接线仍保留在 `main.ts` |
| v2 任务面板视图 HTML 抽取 | 已完成第一刀 | `src/v2/taskPanelViews.ts` 承载任务列表、AI 自治、自测、脚本测试、时间轴和清理摘要 HTML；状态和点击接线仍保留在 `main.ts` |
| v2 画布变换逻辑抽取 | 已完成第一刀 | `src/v2/canvasTransform.ts` 承载拖拽状态、移动/缩放/旋转计算和光标映射；为后续 transform 事务化集中入口 |
| v2 画布独立舞台与浮层 UI | 已完成第一轮 | `.v2-stage` 已改为工作区底层全铺画布；工具栏、场景层级和右侧 dock 改为浮层面板，避免画布继续被 UI grid 裁切 |
| v2 画布视口与滚轮控制 | 已完成第一轮 | 新增 `src/v2/viewportMath.ts`；renderer 支持 camera zoom/pan、光标锚定滚轮缩放和中键拖动画布；Browser 前台验证画布滚轮缩放与面板滚动边界 |
| viewport math 自动化验证 | 已完成第一轮 | 新增 `src/testing/viewportMathSmoke.ts` 和 `npm run smoke:viewport`，覆盖 screen/world 互转、光标锚定缩放、pan 方向和 zoom clamp |
| v2 独立浮动/停靠窗口系统 | 已完成第二轮 | 左侧工具栏和右侧固定 dock 已下线；顶栏 `窗口` 菜单统一管理工具与四个窗口；每个面板可独立拖动、置顶，并支持靠左/靠右/靠上/靠下吸附填充 |
| 游戏模式窗口收起 | 已完成第一轮 | 按 Z 进入 `game` 时窗口层、窗口菜单、窗口按钮和编辑选择叠加自动隐藏；回到 `editorFrozen` 后保留原窗口位置和打开状态 |
| floating/docking panels 自动化验证 | 已完成第二轮 | `src/testing/floatingPanelLayoutSmoke.ts` 和 `npm run smoke:floating-panels` 已覆盖窗口尺寸 clamp、左/右/上/下边缘吸附识别、同边缘堆叠和四边同时停靠不重叠 |
| v2 场景树控制器抽取 | 已完成第一刀 | `src/v2/sceneTreeController.ts` 承载层级 HTML、树选择、拖拽进文件夹和文件夹状态更新；`main.ts` 保留 notice/render 接线 |
| v2 画布 transform 事务化 | 已完成最小切片 | 持久实体拖拽结束时提交 `actor: user` transaction；pointer move 仍做实时预览；CDP 已验证落盘事务 path 与 inverse transform |
| transform transaction 自动化验证 | 已完成第一轮 | 新增 `src/testing/transformTransactionSmoke.ts` 和 `npm run smoke:transform`，覆盖 apply、inverse、undo/redo、rollback |
| v2 键盘控制器抽取 | 已完成第一刀 | `src/v2/keyboardController.ts` 承载 Z 运行切换、方向输入、跳跃输入；CDP 已验证输入框聚焦时不会触发快捷键 |
| AI 自测摘要显示优先级 | 已修正 | 单独运行 AI 自测会清除旧自治轮次摘要遮挡；CDP 已验证自治轮次后再自测会显示 `AI自主测试` |
| `runAutonomousRound()` 不可达旧代码 | 已清理 | 删除 `return` 后旧实现和不再使用的类型/选择器；`src/v2/main.ts` 已继续降到约 898 行 |
| v2 持久化服务形状统一 | 已完成第一轮 | Node server 与 Vite dev 都支持 `{ project }` 和裸 project；响应返回 `savedAt`，文件保持纯 v2 project 形状 |
| v2 持久化控制器拆分 | 已完成第一刀 | 新增 `src/v2/persistenceController.ts`，收口保存/加载 notice、保存前 project 快照组装和 runtime persistent entity 合并 |
| persistence controller 自动化验证 | 已完成第一轮 | 新增 `src/testing/persistenceControllerSmoke.ts` 和 `npm run smoke:persistence`，覆盖 persistent runtime 合并、transient 不覆盖、folders/layers 复制和 folderId 一致性 |
| v2 文件夹移动事务化 | 已完成最小切片 | 新增 `src/v2/folderMoveTransaction.ts`，persistent entity 拖入文件夹会提交 `actor: user` transaction；非持久运行时对象不进入层级/文件夹管理 |
| folder move transaction 自动化验证 | 已完成第一轮 | 新增 `src/testing/folderMoveTransactionSmoke.ts` 和 `npm run smoke:folder-move`，覆盖 folder patch、entity folderId patch、inverse、rollback |
| 运行时模板可见性 | 已完成第一轮 | 非 persistent 模板实体不再随场景初始化进入 `RuntimeWorld.entities`；例如“普通攻击判定”只作为模板存在，实际攻击时通过 transient 生成；AI 目标过滤也只允许 persistent 实体 |
| runtime visibility 自动化验证 | 已完成第一轮 | 新增 `src/testing/runtimeVisibilitySmoke.ts` 和 `npm run smoke:runtime-visibility`，覆盖模板隐藏、层级 HTML 隐藏、transient spawn 和 AI 不 patch non-persistent 模板 |
| 持久化目标层验证 | 已完成第一轮 | CDP 真实加载 `v2.html`，拖拽树节点后点击保存/加载；确认 UI notice、`data/v2-project.json` 纯 v2 shape、folderId/folders 一致、transaction 已落盘；验证后已恢复原数据文件 |
| v2 任务工作流控制器拆分 | 已完成第一刀 | 新增 `src/v2/taskWorkflowController.ts`，收口任务排队与“执行下一条 AI 任务”；`main.ts` 保留 DOM 接线、自治轮次和测试摘要 |
| task workflow 自动化验证 | 已完成第一轮 | 新增 `src/testing/taskWorkflowControllerSmoke.ts` 和 `npm run smoke:task-workflow`，覆盖空任务聚焦、任务入队、AI 执行、trace 缓存和 world sync 回调 |
| 加载项目会话态清理 | 已修正 | `loadSavedProject()` 现在清空旧项目的 trace、时间轴、脚本测试、自治、自测、维护摘要和自治轮次计数，避免加载后显示旧证据 |
| 前台预览与任务目标层验证 | 已完成 | 已在前台预览标签打开 `http://127.0.0.1:5173/v2.html`；Browser 目标层验证 5 个树节点，任务排队后 previewCount=1，执行下一条后 notice 为 `AI 任务完成。` |
| v2 自治摘要模型拆分 | 已完成第一刀 | `autonomousRoundSummaryFromCycle()`、`latestAutonomyRoundSummaryFromProject()` 和 `buildAutonomousRoundNextSteps()` 已从 `main.ts` 抽到 `src/v2/summaryModels.ts`；`main.ts` 保留自治执行和页面状态接线 |
| autonomy summary 自动化验证 | 已完成第一轮 | 新增 `src/testing/autonomySummaryModelsSmoke.ts` 和 `npm run smoke:autonomy-summary`，覆盖 live cycle 摘要、项目 fallback 摘要和队列为空 self-test next steps |
| 自治摘要目标层验证 | 已完成 | 前台预览刷新后实际点击 `自治一轮`；目标层确认 notice 为 `AI自治第 1 轮完成...`，任务面板渲染 `AI自治工作台` 和 `测试通过` |

## 未完成但必须落实

| 优先级 | 建议 | 目标动作 | 当前状态 |
| --- | --- | --- | --- |
| P0 | v2 UI 整体翻新 | 重新设计编辑器壳层、任务区、检查器、状态栏和画布辅助层 | 已完成第一轮壳层重排、多轮模块抽取、“独立画布 + 浮层 UI”和独立浮动窗口系统，仍需细化交互 |
| P0 | 编辑器操作事务化 | 移动、缩放、旋转、属性修改、创建、删除、资源绑定、任务编辑都走 transaction | 已开始：画布 transform 和 persistent 文件夹移动已接入 transaction |
| P0 | 明确源项目只是参考 | 代码结构不再照搬旧 `app.js` 或继续膨胀 `src/v2/main.ts` | 已写入口径，并持续拆出 v2 模块 |
| P1 | 拆分 `src/v2/main.ts` | 拆出 canvas、keyboard、runtime、persistence、panels、tasks、AI 控制器 | 已开始：壳层、视图工具、摘要模型、面板、任务面板、画布变换、场景树、键盘、持久化控制器、任务工作流控制器、自治摘要模型和文件夹移动事务模块已拆出；`main.ts` 约 819 行 |
| P1 | 清理重构残留 | 核实并清理 `runAutonomousRound()` 不可达旧代码 | 已完成第一轮 |
| P1 | 统一持久化服务 | Vite dev 和 Node server 都支持清晰的 v2 项目 API | 已完成第一轮：保存形状、wrapper/bare payload 和 dataUrl 附件处理已对齐 |
| P1 | 拆分后的页面目标层验证 | 每次拆模块后除构建外还要验证浏览器实际渲染 | 已执行 1365px/390px 截图和任务面板 CDP 交互验证，仍需继续覆盖更多交互 |
| P1 | 文档收敛 | README、架构、运行方式、发布边界统一成重构后的口径 | 进行中 |
| P2 | 物理增强 | swept AABB、trigger/sensor、one-way platform、layer/mask、hitbox 生命周期 | 未开始 |
| P2 | 测试补强 | transaction、undo/redo、snapshot restore、planner、player movement 等测试 | 未开始 |
| P2 | 跨平台脚本 | 去掉 Windows-only 环境变量和自动打开浏览器依赖 | 未开始 |

## 当前剩余队列

| 顺序 | 事项 | 说明 |
| --- | --- | --- |
| 1 | 任务 / AI 控制器继续拆分 | 下一刀抽 `recordAutonomousSuite()` 或维护/清理动作，但要先对照 `AutonomyLoop` 内部失败任务生成语义 |
| 2 | 事务化扩面 | 属性修改、创建/删除、资源绑定和任务编辑逐步改为 transaction；数组类 patch 暂用完整 `set` 保证 inverse 可逆 |
| 3 | 目标层回归脚本化 | 将当前 Browser/CDP 保存/加载、任务排队、AI 执行、自治摘要、transform、文件夹移动验证沉淀为可重复命令或 Playwright/DevTools 测试 |
| 4 | `syncWorldFromStore()` 删除语义 | 后续做实体删除事务前，先让 runtime world 能移除 store 中已不存在的 persistent entity，避免幽灵实体 |

## 功能承接表

| 源能力 | 源位置 | 重构后目标 | 处理原则 |
| --- | --- | --- | --- |
| Legacy Canvas 编辑器 | `index.html`、`styles.css`、`app.js` | 只作为功能参考 | 不承接大文件结构 |
| v2 编辑器壳层 | `v2.html`、`src/v2/main.ts`、`src/v2/styles.css` | 新编辑器主线 | 保留功能接线，重做 UI 和模块边界 |
| Pixi 渲染 | `src/v2/renderer.ts` | 中央画布渲染层 | 尽量保留，围绕新 UI 重新接线 |
| 项目模型 | `src/project/schema.ts` | 新项目权威数据层 | 保留并强化 |
| 事务系统 | `src/project/transactions.ts` | 所有编辑动作的唯一修改入口 | 必须扩大使用范围 |
| diff 和回滚 | `src/project/diff.ts`、`projectStore.ts` | AI 和用户编辑共同审计层 | 必须接入 UI |
| 运行态冻结 | `src/runtime/world.ts` | 编辑器核心调试体验 | 保留为主功能 |
| 超级画笔 | `src/editor/superBrush.ts` | 空间意图采集工具 | 保留概念，重做任务输入体验 |
| 规则式 AI 执行 | `src/ai/*` | 第一版安全 AI 修改器 | 保留，但 UI 文案避免夸成通用 AI |
| 自主测试 | `src/testing/*` | AI 修改后的验证层 | 保留并做结果可视化 |
| 玩家端 | `player.html`、`src/player/*` | 独立运行入口 | 保持轻量，不依赖编辑器 UI |

## UI 重构目标

### 顶栏

目标是展示项目身份、运行控制、保存加载、构建/存储状态。不要堆太多测试和维护按钮。

### 左侧工具栏

目标是高频工具入口：

- 选择
- 超级画笔
- 形状/区域
- 画布辅助
- 面板开关

### 左侧层级

目标是快速看清场景、文件夹和实体。需要保留选择态、拖拽移动文件夹、空状态。

### 中央画布

目标是最重要区域。画布应尽量大，叠加层只显示帧、工具、坐标、模式、最近动作。

### 右侧检查器

目标是把属性、资源、行为、任务拆成清晰分区。不要把所有内容堆成一个长面板。

### 任务 / AI 区

目标是从“按钮堆”改成工作流：

1. 输入任务。
2. 绑定对象或超级画笔上下文。
3. 排队或执行。
4. 查看 diff / trace / 测试。
5. 通过、失败、回滚或生成后续任务。

## 下一步执行顺序

1. 根据本表先做 v2 UI 壳层重构，不再沿用旧布局。
2. 保留现有功能事件和数据接线，避免一次性重写运行时。
3. 重构 `src/v2/main.ts` 时先拆 UI 结构和渲染函数，再拆业务控制器。
4. 每完成一个功能区，跑 `typecheck` 和 `build`。
5. UI 可以渲染后再启动浏览器验证，不从构建成功推断 UI 成功。
