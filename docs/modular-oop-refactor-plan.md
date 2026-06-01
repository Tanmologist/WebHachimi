# WebHachimi 模块化与面向对象改造计划

本文记录 WebHachimi 后续重构的共同边界。目标不是把所有代码都改成 class，也不是一次性重写，而是让每个目录成为可组合、可测试、可单独复用的模块。

## 目标

- 大多数文件夹只暴露一个稳定入口，外部通过 `index.ts` 使用模块能力。
- 项目数据仍保持 JSON 友好，方便保存、diff、AI 修改和回滚。
- 行为封装进对象：controller、service、system、store、command、pipeline。
- UI、运行时、渲染、资源、AI 和测试通过窄接口协作，避免跨目录直接访问内部细节。
- 每次拆分都保持行为不变，并配套最窄验证。

## 目录边界

推荐长期结构：

```text
src/
  core/
  project/
  resources/
  rendering/
  runtime/
  editor/
  player/
  ai/
  testing/
```

### core

职责：
- 通用类型、Result、Id、Vec2、Rect。
- 纯几何、数学、事件工具。
- 不依赖任何业务模块。

候选对象：
- `GeometryMath`
- `IdFactory`
- `EventEmitter`

### project

职责：
- Project schema、迁移、事务、diff、持久化模型。
- 不依赖 editor、runtime、rendering。

候选对象：
- `ProjectStore`
- `TransactionManager`
- `ProjectMigrator`
- `ProjectValidator`

### resources

职责：
- 文件导入、MIME sniff、配额、资源元数据、asset 引用。
- 避免 base64 在 project JSON 中扩散。

候选对象：
- `ResourcePipeline`
- `AssetStore`
- `ResourceManifest`
- `ResourceImportPolicy`

### rendering

职责：
- Pixi 渲染基础设施、纹理缓存、文本/图形对象池、截图服务。
- 不拥有 editor 状态，也不修改 runtime 模拟状态。

候选对象：
- `TextureManager`
- `TextPool`
- `GraphicsPool`
- `CaptureService`
- `SceneRenderer`

### runtime

职责：
- 游戏模拟、系统调度、实体生命周期、碰撞、战斗、快照。
- 可以消费 project 数据，但不要依赖 editor。

候选对象：
- `RuntimeEngine`
- `RuntimeEntityStore`
- `InputSystem`
- `MovementSystem`
- `CollisionWorld`
- `CombatSystem`
- `PresentationStateSystem`
- `SnapshotService`

### editor

职责：
- 编辑器应用装配、UI 控制器、命令系统、交互状态。
- 组合 project、resources、rendering、runtime、ai。

候选对象：
- `EditorApp`
- `CommandBus`
- `SelectionController`
- `CanvasInteractionController`
- `RenderCoordinator`
- `PersistenceSyncController`

### player

职责：
- 独立玩家端入口。
- 组合 runtime 和 rendering，不依赖 editor UI。

候选对象：
- `PlayerApp`
- `PlayerInputController`
- `PlayerViewportController`

### ai

职责：
- 任务规划、任务执行、验证计划、自治循环。
- 应通过 project transaction 或 editor command 修改项目，不直接改 UI 状态。

候选对象：
- `AiTaskExecutor`
- `IntentPlanner`
- `AutonomyLoop`
- `VerificationPlanner`

### testing

职责：
- 测试 runner、smoke、benchmark、浏览器级验证脚本。
- 可以依赖其他模块，但不能成为业务模块的运行时依赖。

候选对象：
- `SimulationTestRunner`
- `InteractiveTestRunner`
- `PerformanceBenchmark`

## 导入规则

长期规则：

```ts
import { ResourcePipeline } from "../resources";
```

避免：

```ts
import { mimeFromDataUrlSignature } from "../resources/internal/sniff";
```

每个模块通过 `index.ts` 暴露稳定 API，内部实现放在 `internal/` 或不导出的文件中。测试可以访问更细粒度文件，但生产代码默认走模块入口。

## 依赖方向

```text
core
  ↓
project
  ↓
resources / runtime / rendering
  ↓
editor / player / ai
  ↓
testing
```

约束：
- `core` 不依赖任何业务。
- `project` 不依赖 editor/runtime/rendering。
- `runtime` 不依赖 editor。
- `rendering` 不依赖 editor。
- `editor` 可以组合所有模块。
- `player` 不依赖 editor。
- `ai` 通过 command/transaction 入口修改项目。

## 数据与对象

保留 plain object：
- `Project`
- `Scene`
- `Entity`
- `Resource`
- `Task`
- `RuntimeSnapshot`

封装行为：
- `ProjectStore`
- `CommandBus`
- `RuntimeEntityStore`
- `CollisionWorld`
- `ResourcePipeline`
- `CaptureService`
- `TextureManager`

原因：项目文件需要可序列化、可 diff、可迁移；行为对象负责复杂流程和生命周期。

## Command 模式

编辑器操作应从：

```text
UI handler -> 直接改 project/world/render
```

改为：

```text
UI handler -> EditorCommand -> CommandBus -> Transaction -> ProjectStore -> RenderCoordinator
```

接口草案：

```ts
export interface EditorCommand {
  readonly id: string;
  readonly label: string;
  plan(input: EditorCommandContext): Result<EditorCommandPlan>;
}

export type EditorCommandPlan = {
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  diffSummary: string;
  notice?: string;
  selectionHint?: SelectionHint;
};
```

优先 command：
- `MoveEntityCommand`
- `MovePresentationCommand`
- `BatchTransformCommand`
- `AddResourceCommand`
- `BindResourceCommand`
- `UpdateResourceAnimationCommand`
- `CreateEntityCommand`
- `DeleteEntityCommand`

## 第一批改造状态

### 已落地：抽纯几何

目标文件：
- `src/editor/geometryMath.ts`
- `src/editor/renderer.ts`
- `src/editor/canvasTransform.ts`

验收：
- `npm run typecheck`
- `npm run smoke:canvas-transform`
- `npm run smoke:transform`

### 已落地：抽 RuntimeEntityStore

目标文件：
- `src/runtime/entityStore.ts`
- `src/runtime/world.ts`
- `src/testing/runtimeVisibilitySmoke.ts`

验收：
- `RuntimeWorld.allEntities()` 和 `entityById()` 对外行为不变。
- transient spawn、cleanup、snapshot restore 行为不变。
- `npm run smoke:runtime-visibility`
- `npm run smoke:performance`

残余风险：
- `RuntimeWorld.entities` 和 `RuntimeWorld.transientEntities` 当前仍是公开可变 `Map`，用于兼容现有调用方。
- 后续应收窄为 `ReadonlyMap` 或统一 mutator，避免外部直接 `.set()` / `.delete()` 绕过 `RuntimeEntityStore` 的缓存失效。

### 待执行：抽 transform transaction planner

目标文件：
- `src/editor/transformTransactions.ts`
- `src/editor/main.ts`
- `src/testing/transformTransactionSmoke.ts`

验收：
- 同一 drag 输入生成同等 patches/inversePatches。
- undo/redo/rollback 行为不变。

### 待执行：抽 SelectionController

目标文件：
- `src/editor/selectionController.ts`
- `src/editor/main.ts`

验收：
- 单选、多选、presentation 选择、框选、删除/复制后选择态一致。
- 加载项目和 runtime sync 后选区可恢复或安全清空。

### 待执行：抽 resourcePipeline 与 captureService

目标文件：
- `src/resources/ResourcePipeline.ts`
- `src/resources/AssetStore.ts`
- `src/rendering/CaptureService.ts`
- `src/editor/main.ts`

验收：
- 导入资源不把大型 data URL 写入 project。
- SuperBrush evidence 使用 asset 引用。
- 截图失败有 warning，不静默丢图。

## 第二批改造顺序

### Runtime systems

拆分顺序：
1. `EntityStore`
2. `InputSystem`
3. `MovementSystem`
4. `TransformHierarchySystem`
5. `CollisionWorld`
6. `CombatSystem`
7. `PresentationStateSystem`
8. `SnapshotService`

原则：
- 每拆一个 system，先保持算法不变。
- 算法优化晚于边界抽取。
- 快照和 combat event frame 必须稳定。

### Renderer infrastructure

拆分顺序：
1. `TextureManager`
2. `TextPool`
3. `GraphicsPool`
4. `ResourceFrameRenderer`
5. `CaptureService`

原则：
- editor/player 共用基础设施。
- Pixi 对象生命周期集中释放。
- 首帧资源可预加载，不在 render 热路径发现才加载。

## 性能路线

先做：
- component views
- bounds cache
- dirty flags
- static spatial hash
- combat query 复用 `CollisionWorld.queryRect`
- renderer culling
- texture preload / atlas

后做：
- dynamic grid
- typed-array data layout
- Worker/OffscreenCanvas 截图
- WASM/Rust 或 Rapier 评估

Rust/WASM 触发条件：
- 空间索引、缓存、对象池、裁剪都完成后，simulation p95 仍超过预算。
- 目标规模明确提高到几千动态体或上万静态体。
- Runtime 数据已经能用 numeric arrays 表达，避免 JS object 与 WASM 来回序列化。

## 不做清单

当前不做：
- 不一次性重写 `src/editor/main.ts`。
- 不先改 `editorShell.ts` 的 DOM 契约。
- 不重写 patch engine。
- 不先引入新前端框架。
- 不急着换语言。
- 不把 project 数据 class 化。

## 提交流程

每个工作单元：
1. 改一个清晰边界。
2. 跑最窄验证。
3. 必要时浏览器检查。
4. 提交中文 commit。
5. 记录剩余风险。
