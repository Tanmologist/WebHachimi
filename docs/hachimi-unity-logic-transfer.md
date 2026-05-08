# Hachimi Unity 逻辑盘点与 Web 迁移表

本文档用于持续整理 `E:\WebForAll\.references\hachimi-unity` 中的 Unity 参考逻辑，并判断哪些应该迁移到 `E:\WebForAll\WebForAll` 的网页端方案。

当前结论：Unity 参考项目里有两类资产，迁移方式不同。

- 协议级骨架值得优先迁移：时间分层、阶段图、窗口、裁决器、Outcome 多通道、状态拆分、未定义交互返回 Unresolved。
- 可玩原型要拆开迁移：`PlayerAttack.cs`、`EnemyAI.cs` 等脚本已经做了很多手感逻辑，但耦合 Unity 输入、物理、MonoBehaviour、Transform、Audio、VFX，不能整类照搬。
- Web 端应采用 TypeScript 数据驱动运行时：把玩法规则变成项目 schema、纯函数 resolver、runtime state 和可测试输入脚本，而不是复刻 Unity 组件结构。

## 证据边界

- 已读取 Unity 参考项目的 `Combat` C# 文件和中文架构设计稿。
- 已对照当前 Web 项目的 `src/runtime`、`src/project/schema.ts`、`src/player`、`src/testing`。
- 本文档是静态代码分析和迁移判断，尚未运行 Unity 项目，也尚未对 Web 端新增战斗系统做目标态验证。

## 总体评价

| 维度 | 判断 | 说明 |
| --- | --- | --- |
| 架构设计 | 好 | 文档明确要求输入、动作、裁决、状态、时间、数据、表现分层，这和 Web 端长期维护方向一致。 |
| 协议骨架 | 好但未完全接入 | `CombatLoop`、`CombatResolver`、`OutcomeBuffer` 是正确方向，但 Unity 可玩脚本中仍有大量直接结算逻辑。 |
| 可玩手感 | 有价值 | 普攻、蓄力、振刀、闪避、点刺、飞杀、处决、hitstop、霸体、残影等已经有明确玩法意图。 |
| 工程实现 | 原型味较重 | `PlayerAttack.cs` 过大，承担输入、动作、hitbox、伤害、音效、特效、处决等职责；迁移时必须拆分。 |
| Web 迁移难度 | 中高 | 当前 Web 运行时已有固定步进、碰撞、快照和测试，但战斗状态模型仍很薄，需要先扩 schema 和 runtime。 |

## 逻辑迁移表

| 编号 | Unity 逻辑/来源 | 里面写了什么 | 质量判断 | Web 端迁移建议 | 优先级 | 待你确认/可修改 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 六项博弈 ID：`Combat\Core\CombatIds.cs`、`06_六项博弈接入方式详解.md` | 定义普攻、蓄力、振刀、闪避、点刺、飞杀、处决，以及 Resolution/Phase/Window/Tag 枚举。 | 概念清晰，适合做 Web 战斗协议的词表。 | 在 `src/project/schema.ts` 或新增 `src/combat/types.ts` 建立 TS 字面量/枚举；不要用自由字符串驱动核心裁决。 | P0 | 六项动作名称和输入是否最终确定？点刺/飞杀是否保留为首版核心？ |
| 2 | 时间分层：`Combat\Time\TimeDomainManager.cs`、`02_时域系统设计.md` | RealTime / WorldTime / LocalTime，支持慢放、加速、堆叠规则和倍率 clamp。 | 方向非常好；比当前 Web `FixedStepClock` 更完整。 | 保留现有 fixed-step，但新增 `TimeDomain`：输入和 UI 走真实时间，动作/冷却分别读合成 dt。 | P0 | 首版是否需要完美闪避慢放和回弹快放？还是先只做局部加减速？ |
| 3 | 动作阶段图：`Combat\Actions\ActionDef.cs`、`PhaseNode.cs`、`WindowDef.cs` | 动作由多个 PhaseNode 构成，每阶段可打开 Hitbox/Parrybox/Cancel/Branch 等窗口。 | 这是最值得迁移的核心。 | 做成 Web 项目数据：`ActionDef -> PhaseNode -> WindowDef`，让编辑器以后能调阶段、窗口、伤害和位移。 | P0 | 动作数据先写死在 TS，还是直接作为项目 JSON 可编辑资源？ |
| 4 | 动作运行态：`ActionRuntimeContext.cs`、`ActionState.cs` | 保存动作实例 ID、当前阶段、阶段耗时、打开窗口、派生历史、蓄力等级等。 | 结构合理，适合快照和测试。 | 扩展 Web `RuntimeComponent`：从 `attackStartFrame` 这种薄字段升级为 `combat.action.context`。 | P0 | 运行态是否需要显示在编辑器右侧检查器里？ |
| 5 | 战斗主循环：`Combat\Core\CombatLoop.cs` | 明确 8 步：采时间、读输入、推动作、采碰撞、裁决、写状态、表现、清理。 | 很适合 Web 重构当前 `RuntimeWorld.stepFixed()`。 | 把当前 `applyCombatInput()` 和 `resolveCombatEvents()` 拆成同样管线，减少互相穿插的直接写状态。 | P0 | Web 端战斗循环是否先只服务玩家和敌人，还是要泛化到所有 entity？ |
| 6 | 裁决器：`Combat\Resolver\CombatResolver.cs`、`05_交互裁决引擎与结果结构.md` | 只读 `CollisionQuery`，查 `InteractionTable`，输出 `CombatOutcome`；未定义返回 Unresolved。 | 原则很好；可玩脚本中还没有完全用它。 | Web 端实现纯函数 `resolveCombat(query, rules)`，并把 Unresolved 进入测试日志和编辑器输出面板。 | P0 | 你是否希望未配置的交互在编辑器里弹出明显警告？ |
| 7 | Outcome 多通道：`Combat\Resolver\CombatOutcome.cs`、`OutcomeBuffer.cs` | 结果拆成 Damage/Stun/State/Weapon/Time/Cooldown/Motion/Action/Branch/Diagnostics。 | 比当前 Web `CombatEvent` 更适合复杂战斗。 | Web 端保留 `CombatEvent` 作为表现/日志投影，但核心结算改为 `CombatOutcome`。 | P0 | Web 日志里需要显示每个 Op 的明细，还是只显示最终摘要？ |
| 8 | 状态拆分：`Combat\State\*.cs`、`04_状态系统与标签体系.md` | 拆分 Action、Stun、Dodge、Weapon、Mobility、Buff、Time 状态。 | 正确，能防止一个大状态对象变脏。 | 在 Web runtime 中建立 `combatState` 子对象；持久事实用状态，一次性结果用 Outcome。 | P0 | 武器状态如掉刀/碎刀/召回是否进入首版？ |
| 9 | 玩家攻击：`Combat\Player\PlayerAttack.cs` | 左键短按普攻，长按蓄力；右键点刺/飞杀；连段、预输入、蓄力霸体、hitbox、扫击、处决、音效。 | 玩法信息丰富，但类过大、职责混杂。 | 不照搬类；拆成 `inputBuffer`、`actionRunner`、`hitboxSpawner`、`combatPresentation`、`executionSystem`。 | P1 | 首版玩家攻击要做到哪一级：普通攻击+振刀，还是六项全上？ |
| 10 | 闪避/完美闪避：`Combat\Player\PlayerDodge.cs` | Shift 闪避，一段/二段，短无敌帧，残影，残影被命中触发完美闪避，慢放后个体加速。 | 机制闭环很好，适合做产品特色。 | Web 中残影应作为 transient entity；命中事实带 `HitShadow/HitBody` flag，由 resolver 判断 PerfectDodge。 | P1 | 完美闪避判定要严格“只打中残影没打中本体”吗？ |
| 11 | 振刀/超级化劲：`Combat\Player\ParryGuard.cs` | 左右键和弦触发 0.2 秒振刀；成功进入超级化劲窗口；窗口内左键触发处决。 | 玩法清楚，但现在直接改无敌和颜色。 | 改为 Parry action 的 Parrybox window；成功由 Outcome 写 SuperParry buff 和 Execution branch。 | P1 | Web 端输入是否也用鼠标左右键和弦？移动端玩家端怎么替代？ |
| 12 | 僵直/霸体/递减：`Combat\Player\HitstunReceiver.cs` | Hitstop -> Hitstun，霸体控制等级，伤害转化，连续受击递减和免疫。 | 有价值，但应回到 Outcome/State 管线。 | 将 hitstop、stun、armor、decay 放到 `StunState/BuffState`；伤害转化由 resolver 或 outcome apply 层统一算。 | P1 | 霸体是否只服务蓄力/振刀，还是敌人和 Boss 也要完整使用？ |
| 13 | 机动/移动：`PlayerMovement.cs`、`MobilityState.cs`、`07_机动系统与跳跃空中规则.md` | 基础横移、跳跃、地面检测，攻击/闪避/振刀时锁水平输入；Mobility 区分地面/空中/受控腾空。 | 当前 Unity 移动是简单可玩实现，文档里的 Mobility 更值得迁移。 | 当前 Web 已有平台移动；下一步补 `MobilityState`，避免动作位移和物理速度打架。 | P1 | Web 版主要是横版平台战斗，还是俯视/房间竞技？ |
| 14 | 敌人 AI：`Combat\Enemy\EnemyAI.cs` | 追踪、准备攻击、重定位、撤退、冷却；按距离/血量/性格选择普攻、重击、突刺、冲刺斩。 | 可用作行为参考，但不宜首批复杂迁移。 | 先保留当前 Web `enemyPatrol`，后续新增 `enemyCombatAI`，用权重选择 action，而不是直接写 MonoBehaviour 状态机。 | P2 | 首版是否需要敌人会主动振刀/闪避，还是只攻击玩家？ |
| 15 | Hitbox 可调数据：`Combat\Debug\HitboxShape.cs`、`CombatTuningPanel.cs` | 矩形/圆形/三角形/自定义多边形 hitbox，攻击段伤害、击退、时长和位移可编辑。 | 很适合 Web 编辑器产品方向。 | 将 hitbox shape 接入现有 collider/polygon 支持；编辑器面板可改每段 hitbox 和窗口。 | P1 | 你希望先做“战斗调参面板”，还是先做运行时能打？ |
| 16 | Debug/OP 面板：`Combat\Debug\OPPanel.cs`、`CombatTuningPanel.cs` | 自动振刀、调参 UI、arena 渲染、hitbox 可视化。 | 适合作为 Web 编辑器面板灵感。 | Web 端用现有右侧面板/输出日志/测试面板承载，不迁移 Unity IMGUI。 | P2 | 自动振刀这种 OP 工具要作为调试开关保留吗？ |
| 17 | 表现层：`HealthBar.cs`、`DamagePopup.cs`、`WeaponHolder.cs`、`CameraFollow.cs`、`CharacterVisual.cs` | 血条、伤害数字、武器动画、镜头震动、角色可视化。 | 是表现，不应参与核心裁决。 | 等核心 Outcome 稳定后，把 DamageOp/StunOp/TimeOp 投影成 Pixi 渲染和 UI 动画。 | P2 | 你更想先要清晰调试可视化，还是先要漂亮表现？ |
| 18 | 测试建议：`10_毛刺优化与测试建议.md` | 要测时间叠加、窗口重复、缺项 Unresolved、状态残留、GC/性能等。 | 很适合转成 Web smoke/autonomy 测试标准。 | 在 `src/testing` 增加 action phase、resolver、perfect dodge、parry unresolved 的测试脚本。 | P0 | 测试失败是否自动生成任务，沿用现有 AI 自主测试闭环？ |

## 建议迁移顺序

| 阶段 | 目标 | 交付物 |
| --- | --- | --- |
| 0 | 先定协议，不急着做完整玩法 | TS 类型：ActionId、Phase、Window、Query、Outcome、CombatState。 |
| 1 | 改造 Web runtime 管线 | `RuntimeWorld.stepFixed()` 拆出 time/input/action/contact/resolver/apply/presentation。 |
| 2 | 做最小可玩闭环 | 普攻 + 振刀 + hit + parrySuccess + Unresolved diagnostics。 |
| 3 | 接入动作数据和编辑器 | 每个动作的阶段、窗口、hitbox 可在项目数据里表达并可视化。 |
| 4 | 做特色机制 | 蓄力、闪避、完美闪避、点刺、飞杀、处决、hitstop、慢放。 |
| 5 | 扩敌人与测试 | enemyCombatAI、交互表测试、时间毛刺测试、回放和失败任务生成。 |

## 当前 Web 项目已有对应能力

| Web 现状 | 能承接什么 | 缺口 |
| --- | --- | --- |
| `src/runtime/time.ts` 固定步进 | 稳定 tick、快照、模拟测试 | 缺 World/Local 时间倍率、时间事件曲线。 |
| `src/runtime/collision.ts` | AABB、旋转 box、circle/polygon overlap | 缺 combat contact facts、window id、attack instance 去重。 |
| `src/runtime/world.ts` | 平台移动、敌人巡逻、薄攻击/格挡事件、冻结快照 | 战斗逻辑仍是直接写 runtime 字段，未分 Action/Resolver/Outcome。 |
| `src/project/schema.ts` | 项目数据、实体、资源、任务、事务、测试记录、快照 | 需要新增战斗协议数据和更完整 runtime combat state。 |
| `src/testing` | 输入脚本、freezeAndInspect、combat trace、AI 自主测试 | 需要针对阶段图、resolver、Unresolved 和完美闪避的专门测试。 |
| `src/v2` 编辑器 | 面板、任务、超级画笔、资源、输出日志 | 需要战斗调参面板和 hitbox/window 可视化。 |

## 聚焦后的首版目标

用户当前确认的首版核心不是六项全搬，而是先把四个基础动作和编辑器调参结合起来：

- 普通攻击
- 蓄力攻击
- 振刀
- 闪避
- 每次攻击判定方块的大小、位置、持续时间、阶段窗口可编辑

这里的关键判断：WebHachimi 已经有“对象本体/可视体分离”“碰撞体大小位置编辑”“触发器”“运行时临时对象”“冻结检查”“自动测试”等能力，所以不应该再做一个孤立的 Unity 式 hitbox 编辑器。更好的方案是把战斗动作本身纳入 WebHachimi 的项目数据和编辑器工作流，让 hitbox 既是战斗数据，也是画布上可视、可拖、可测、可回滚的对象。

## 四个动作如何落到 Web 端

| 动作 | Unity 参考要点 | WebHachimi 结合方式 | 首版验收 |
| --- | --- | --- | --- |
| 普通攻击 | 左键短按；Startup/Active/Recovery；Active 开 Hitbox；命中后伤害和硬直。 | 新增 `normalAttack` ActionDef；每一段攻击有一个或多个 hitbox window；画布里用半透明触发方块预览当前段的判定区。 | 按攻击键后生成有效攻击窗口，敌人进入判定区会扣血并产生日志。 |
| 蓄力攻击 | 左键长按进入蓄力，松开释放；蓄力期间可有霸体/减速；蓄力等级影响伤害和范围。 | 输入层记录 hold 时长；ActionContext 保存 `chargeLevel`；编辑器允许为不同蓄力等级设置 hitbox 大小、偏移、伤害倍率。 | 短按走普攻，长按后松开走蓄力；蓄力 hitbox 和伤害明显不同。 |
| 振刀 | 双键或独立键触发 Parrybox；成功反制攻击并进入奖励窗口。 | 先支持独立 `parry` 输入，后续再加左右键和弦；Parry 是 ActionDef，不是直接给角色无敌；成功由 resolver 输出 `parrySuccess` 和 stun/action ops。 | 敌人攻击窗口内按振刀，玩家不掉血，敌人进入硬直，输出 parrySuccess。 |
| 闪避 | Shift 触发；短无敌帧；可带残影；完美闪避后慢放/刷新冷却。 | 首版先做 dodge action + invulnerable/shadow window；残影作为 transient entity；完美闪避放到第二步，但数据结构先留 `shadowWindow`。 | 闪避期间可以避开攻击；冻结时能看见闪避状态和残影/窗口信息。 |

## 判定方块编辑器怎么做

| 编辑对象 | 不是这样做 | 推荐这样做 | 复用现有能力 |
| --- | --- | --- | --- |
| 攻击判定方块 | 不把 hitbox 做成只能运行时生成的隐藏逻辑。 | 把 hitbox 定义成 ActionDef 的 `WindowDef.shape`，并在编辑器中显示为“动作判定预览对象”。 | `Entity.collider.size/offset/rotation`、`CanvasTransform` 拖拽缩放旋转、触发器可视化。 |
| 每一段攻击 | 不只给角色一个 `attackRange/attackHeight` 参数。 | 每段拥有独立 `startup/active/recovery`、hitbox 列表、伤害、击退、位移。 | 现有 `behavior.params` 可作为旧兼容，新系统应迁到结构化 action 数据。 |
| 蓄力等级 | 不把等级差异写死在代码分支里。 | `chargeLevel 0/1/2/3` 可覆盖 hitbox、伤害、hitstop、霸体等级。 | 右侧 inspector + 项目 JSON + 事务系统。 |
| 可视调试 | 不只在命中时闪一下。 | 时间轴上选择阶段时，画布显示该阶段 hitbox/parrybox/hurtbox；运行时冻结也能看到当前打开窗口。 | 当前 renderer overlay、superBrush 高亮、runtime snapshot。 |
| 保存回滚 | 不让调参只存在内存。 | 调整 hitbox 产生 ProjectTransaction，可 undo/redo，可被 AI 和测试引用。 | `ProjectStore.applyTransaction()`、diff、任务记录。 |

## 建议的数据结构方向

首版可以先新增一个轻量 `combat` 模块，避免把所有字段继续塞进 `behavior.params`。

```ts
type CombatActionId = "normalAttack" | "chargeAttack" | "parry" | "dodge";

type CombatActionDef = {
  id: CombatActionId;
  displayName: string;
  input: CombatInputDef;
  phases: CombatPhaseDef[];
};

type CombatPhaseDef = {
  id: string;
  type: "startup" | "hold" | "active" | "recovery" | "reward";
  durationFrames: number;
  windows: CombatWindowDef[];
  movement?: CombatMovementDef;
};

type CombatWindowDef = {
  id: string;
  type: "hitbox" | "parrybox" | "hurtbox" | "shadow" | "cancel";
  startFrame: number;
  endFrame: number;
  shape: {
    kind: "box" | "circle" | "polygon";
    offset: { x: number; y: number };
    size: { x: number; y: number };
    rotation: number;
  };
  damage?: number;
  knockback?: { x: number; y: number };
};
```

这套结构和 Unity 的 `ActionDef -> PhaseNode -> WindowDef` 对齐，但字段用 Web 运行时和编辑器更容易处理的 frame/shape 数据。后续再加 `InteractionTable`、`Outcome`、慢放、完美闪避，不会推翻这个基础。

## 实现顺序建议

| 阶段 | 要做什么 | 为什么这样排 |
| --- | --- | --- |
| A | 新增 `src/combat/types.ts` 和默认四动作数据 | 先把普攻、蓄力、振刀、闪避从散乱 params 变成稳定协议。 |
| B | 在 runtime 中跑 ActionRunner | 让按键驱动阶段推进和窗口开关，而不是只靠 `attackStartFrame` 几个字段。 |
| C | 用现有 collision 生成 combat contact facts | 把当前“矩形攻击区域”升级为具体窗口命中事实。 |
| D | 实现最小 resolver/outcome | 普攻命中、振刀成功、闪避无敌都走统一裁决。 |
| E | 编辑器显示并编辑 action hitbox | 选中角色后打开“动作”面板，选择动作/阶段/窗口，画布上拖动判定方块。 |
| F | 测试覆盖四个动作 | 用现有 `InteractiveTestRunner` 验证短按、长按、振刀窗口、闪避窗口。 |

## 特色结合点

| 特色 | 做法 | 价值 |
| --- | --- | --- |
| 冻结编辑战斗帧 | 玩家运行时按 `Z` 冻结后，编辑器显示当前动作阶段、打开窗口和临时 hitbox。 | 这是 WebHachimi 区别于 Unity 调参面板的核心体验。 |
| 超级画笔改判定 | 用户圈出攻击范围并写“蓄力范围再大一点”，AI 改对应 action window 的 shape。 | 把现有 AI/任务系统和战斗调参连起来。 |
| 自动测试调参 | 每次改 hitbox 后自动跑命中/振刀/闪避 smoke，失败生成任务。 | 避免手感调参把规则打坏。 |
| 可视体/本体分离 | 角色 sprite 可以独立于碰撞体和攻击判定调整。 | 保持当前 Web 编辑器优势，不被 Unity 组件式写法拖回去。 |

## 我的疑问

1. Web 版首要目标是“先做出 Unity 玩法手感”，还是“先把可编辑的战斗协议系统搭起来”？我建议先协议，再最小玩法。
2. 六项博弈是否就是首版核心：普攻、蓄力、振刀、闪避、点刺、飞杀？处决算奖励动作，不算第七项？
3. 输入方案是否沿用 Unity：左键普攻/蓄力、右键点刺/飞杀、左右键和弦振刀、Shift 闪避？
4. Web 版单位要用像素制，还是抽象战斗单位？这会影响 hitbox、移动速度、击退、跳跃参数。
5. 交互表是否要在编辑器里可视化编辑？如果要，schema 要从一开始为表格编辑留结构。
6. 首版敌人需要完整 AI，还是先做静态靶子/简单巡逻敌人来验证玩家六项动作？
7. 未定义交互是否必须阻止伤害并提示？我建议必须这样做，否则以后很难查规则缺口。

## 可编辑决策区

你可以直接在这里改状态或写决定。

| 决策项 | 当前建议 | 你的决定 | 备注 |
| --- | --- | --- | --- |
| 首版迁移范围 | 普攻、蓄力攻击、振刀、闪避 + 判定方块编辑器 | 已确认为当前聚焦范围 | 点刺、飞杀、处决后移。 |
| 动作数据位置 | 先 TS 默认数据，随后进入项目 JSON | 待定 | 建议不要继续扩 `behavior.params`。 |
| 输入映射 | 桌面先支持键盘/鼠标，移动端后补虚拟按钮 | 待定 | 振刀先独立键，左右键和弦可作为增强。 |
| 首个敌人 | 简单巡逻/靶子，不先做复杂 AI | 待定 | 先验证玩家四动作。 |
| 编辑器调参 | 先可视化 hitbox/window，再做完整调参面板 | 已确认需要编辑每次判定方块大小位置 | 需要动作/阶段/窗口三层选择。 |
| 慢放机制 | 完美闪避阶段再接，不放在首个最小闭环 | 待定 | 闪避先可用，完美闪避后续增强。 |
