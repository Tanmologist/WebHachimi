(function () {
  'use strict';

  const STORAGE_KEY = 'webhachimi-engine-project-v2';
  const PATCH_LOG_KEY = 'webhachimi-engine-patch-log-v2';
  const PROJECT_VERSION = 3;
  const SAVE_DEBOUNCE_MS = 450;
  const WORLD = { width: 1600, height: 900 };

  const TYPE_LABELS = {
    box: '方块',
    player: '玩家',
    platform: '平台',
    coin: '金币',
    enemy: '敌人',
    text: '文字',
    zone: '区域',
  };
  const BODY_LABELS = { static: '静态', dynamic: '动态', kinematic: '脚本运动', none: '无' };
  const OP_LABELS = {
    createEntity: '创建对象',
    updateEntity: '修改对象',
    deleteEntity: '删除对象',
    createEntityFolder: '创建文件夹',
    setScene: '修改场景',
    selectEntity: '选择对象',
    selectEntities: '框选对象',
    createResource: '创建资源',
    updateResource: '修改资源',
    deleteResource: '删除资源',
    attachResource: '挂载资源',
    detachResource: '卸载资源',
    scheduleResourceUse: '安排资源使用',
    createAnnotation: '创建批注',
    updateAnnotation: '修改批注',
    deleteAnnotation: '删除批注',
    setWindow: '调整窗口',
  };
  const RESOURCE_TYPE_LABELS = {
    image: '图片',
    sprite: '精灵',
    animation: '动图',
    audio: '音频',
    script: '脚本',
    note: '设定',
    material: '材质',
  };
  const RESOURCE_SLOT_LABELS = {
    appearance: '外观',
    movementAnimation: '移动动画',
    idleAnimation: '待机动画',
    attackAnimation: '攻击动画',
    material: '材质',
    behavior: '行为',
    audio: '音频',
    script: '脚本',
    lore: '设定',
  };
  const RESOURCE_ROLE_LABELS = {
    appearance: '外观素材',
    movementAnimation: '移动动画素材',
    idleAnimation: '待机动画素材',
    attackAnimation: '攻击动画素材',
    material: '材质素材',
    behavior: '行为素材',
    audio: '音频素材',
    script: '脚本素材',
    lore: '设定素材',
  };
  const RESOURCE_USAGE_LABELS = {
    attach: '挂载到对象',
    place: '放入场景',
    spawn: '生成对象',
    trigger: '触发使用',
    reference: '仅供参考',
  };
  const RESOURCE_TIMING_LABELS = {
    immediate: '立即',
    onStart: '开场',
    onApproach: '靠近时',
    onContact: '接触时',
    onCollect: '收集时',
    onTrigger: '触发时',
    manual: '手动',
  };
  const WINDOW_DEFAULTS = {
    objects: { open: true, x: 20, y: 18, w: 286, h: 620, z: 2, snap: '', collapsed: false },
    properties: { open: true, x: 914, y: 18, w: 372, h: 650, z: 3, snap: '', collapsed: false },
    resources: { open: true, x: 334, y: 104, w: 370, h: 436, z: 4, snap: '', collapsed: false },
    annotations: { open: true, x: 444, y: 168, w: 392, h: 430, z: 5, snap: '', collapsed: false },
  };
  const WINDOW_LABELS = { objects: '对象', properties: '属性', resources: '资源库', annotations: '批注' };
  const ENTITY_FOLDER_DEFS = [
    { key: 'characters', label: '角色' },
    { key: 'terrain', label: '地形' },
    { key: 'collectibles', label: '可收集物' },
    { key: 'hazards', label: '敌人与危险' },
    { key: 'triggers', label: '触发区' },
    { key: 'text', label: '文字与 UI' },
    { key: 'misc', label: '未归类' },
  ];
  const TRANSFORM_HANDLE_SIZE = 10;
  const MOVE_HANDLE_SIZE = 14;
  const ROTATE_HANDLE_OFFSET = 44;
  const MARQUEE_THRESHOLD = 4;
  const SNAP_GAP = 0;
  const EDGE_DOCK_RANGE = 46;
  const DOCK_SPLIT_GAP = 0;
  const RESIZE_EDGE_SIZE = 8;
  const MIN_WINDOW_W = 260;
  const MIN_WINDOW_H = 180;

  const refs = {};
  const input = { left: false, right: false, up: false, down: false, jump: false };
  const imageCache = new Map();
  const entityTreeOpen = {};
  const resourceTreeOpen = {};
  let messageTimer = null;
  let saveTimer = null;
  let currentPlan = null;
  let activeWindowDrag = null;
  let activeWindowResize = null;
  let activeCanvasDrag = null;
  let contextMenuState = null;
  let reloadInFlight = false;

  function $(id) { return document.getElementById(id); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function nowIso() { return new Date().toISOString(); }
  function validColor(value, fallback) { return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : fallback; }
  function typeLabel(value) { return TYPE_LABELS[value] || value || '对象'; }
  function bodyLabel(value) { return BODY_LABELS[value] || value || '静态'; }
  function opLabel(value) { return OP_LABELS[value] || value || '操作'; }
  function resourceTypeLabel(value) { return RESOURCE_TYPE_LABELS[value] || value || '资源'; }
  function resourceSlotLabel(value) { return RESOURCE_SLOT_LABELS[value] || value || '外观'; }
  function resourceRoleLabel(value) { return RESOURCE_ROLE_LABELS[value] || value || '外观素材'; }
  function resourceUsageLabel(value) { return RESOURCE_USAGE_LABELS[value] || value || '挂载到对象'; }
  function resourceTimingLabel(value) { return RESOURCE_TIMING_LABELS[value] || value || '立即'; }

  function setMessage(text, tone) {
    const value = String(text || '');
    if (refs.messageLine) {
      refs.messageLine.textContent = value;
      refs.messageLine.dataset.tone = tone || 'info';
    }
    showToast(value, tone);
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(function () {
      if (refs.messageLine) refs.messageLine.textContent = '';
      if (refs.toast) refs.toast.classList.add('is-hidden');
    }, 3200);
  }

  function showToast(text, tone) {
    if (!text || !document.body) return;
    if (!refs.toast) {
      refs.toast = document.createElement('div');
      refs.toast.className = 'app-toast is-hidden';
      document.body.appendChild(refs.toast);
    }
    refs.toast.textContent = text;
    refs.toast.dataset.tone = tone || 'info';
    refs.toast.classList.remove('is-hidden');
  }

  function defaultTraits(type) {
    if (type === 'player') return ['键盘控制', '受重力影响', '可以跳跃'];
    if (type === 'platform') return ['静态碰撞体', '可以作为落脚点'];
    if (type === 'coin') return ['可收集', '用于奖励路线'];
    if (type === 'enemy') return ['会巡逻', '接触玩家会造成伤害'];
    if (type === 'zone') return ['触发区域', '可承载剧情或机关'];
    if (type === 'text') return ['标题或提示文字'];
    return ['场景对象'];
  }

  function defaultDescription(type) {
    if (type === 'player') return '玩家角色，负责移动、跳跃和关卡交互。';
    if (type === 'platform') return '平台对象，通常作为地面、墙体或跳台使用。';
    if (type === 'coin') return '奖励对象，玩家触碰后会被收集。';
    if (type === 'enemy') return '敌对单位，可用于巡逻、追击或伤害玩家。';
    if (type === 'zone') return '触发区域，可用于剧情、胜利点或机关检测。';
    if (type === 'text') return '文字对象，用于关卡标题、提示或 UI 标记。';
    return '场景中的基础对象。';
  }

  function normalizeTraits(value, fallbackType) {
    const source = Array.isArray(value) ? value : defaultTraits(fallbackType);
    return source.map(function (item) { return String(item || '').trim(); }).filter(Boolean).slice(0, 12);
  }

  function defaultEntitySkeleton() {
    return {
      id: '',
      name: '对象',
      type: 'box',
      x: 0,
      y: 0,
      w: 80,
      h: 80,
      rotation: 0,
      color: '#68a7ff',
      text: '',
      description: defaultDescription('box'),
      traits: defaultTraits('box'),
      resourceRefs: [],
      layer: 0,
      visible: true,
      locked: false,
      components: {
        body: 'static',
        collider: true,
        controller: false,
        gravity: false,
        collectible: false,
        hazard: false,
      },
      tuning: { speed: 360, jump: 680, gravity: 1600, bounce: 0 },
    };
  }

  function defaultEntity(template, x, y) {
    const base = Object.assign(defaultEntitySkeleton(), {
      id: uid('ent'),
      x: Math.round(x || 0),
      y: Math.round(y || 0),
    });
    if (template === 'player') {
      Object.assign(base, {
        name: '玩家',
        type: 'player',
        w: 58,
        h: 72,
        color: '#42c89f',
        description: defaultDescription('player'),
        traits: defaultTraits('player'),
        components: Object.assign(base.components, { body: 'dynamic', controller: true, gravity: true }),
      });
    } else if (template === 'platform') {
      Object.assign(base, {
        name: '平台',
        type: 'platform',
        w: 260,
        h: 34,
        color: '#8d8d83',
        description: defaultDescription('platform'),
        traits: defaultTraits('platform'),
      });
    } else if (template === 'coin') {
      Object.assign(base, {
        name: '金币',
        type: 'coin',
        w: 34,
        h: 34,
        color: '#e6b84a',
        description: defaultDescription('coin'),
        traits: defaultTraits('coin'),
        components: Object.assign(base.components, { collider: true, collectible: true }),
      });
    } else if (template === 'enemy') {
      Object.assign(base, {
        name: '敌人',
        type: 'enemy',
        w: 56,
        h: 56,
        color: '#ef6666',
        description: defaultDescription('enemy'),
        traits: defaultTraits('enemy'),
        components: Object.assign(base.components, { body: 'kinematic', collider: true, hazard: true }),
        tuning: Object.assign(base.tuning, { speed: 130 }),
      });
    } else if (template === 'text') {
      Object.assign(base, {
        name: '文字',
        type: 'text',
        w: 250,
        h: 50,
        color: '#f3f1ea',
        text: '标题',
        description: defaultDescription('text'),
        traits: defaultTraits('text'),
        components: Object.assign(base.components, { collider: false }),
      });
    } else if (template === 'zone') {
      Object.assign(base, {
        name: '触发区域',
        type: 'zone',
        w: 170,
        h: 110,
        color: '#b07cff',
        description: defaultDescription('zone'),
        traits: defaultTraits('zone'),
        components: Object.assign(base.components, { collider: true }),
      });
    }
    return normalizeEntity(base);
  }

  function defaultResources() {
    return [
      {
        id: 'res-hachimi-spider',
        name: '哈基米蜘蛛设定',
        type: 'sprite',
        color: '#ef6666',
        tags: ['怪物', '机动'],
        notes: '墙面移动和飞扑攻击的怪物资源。',
        linkedEntityId: null,
        intent: {
          role: 'behavior',
          usage: 'spawn',
          timing: 'onApproach',
          placement: '靠近玩家路线的墙面或天花板',
          instruction: '当需要野怪压力时，可把这个素材生成成敌人，并继承爬墙和飞扑批注。',
        },
        uses: [],
        attachments: [],
      },
      {
        id: 'res-platform-metal',
        name: '金属平台材质',
        type: 'material',
        color: '#8d8d83',
        tags: ['平台', '材质'],
        notes: '用于静态平台和地面。',
        linkedEntityId: 'ent-ground',
        intent: {
          role: 'material',
          usage: 'attach',
          timing: 'immediate',
          placement: '静态平台或地面对象',
          instruction: '给平台对象套用金属材质外观。',
        },
        uses: [],
        attachments: [],
      },
    ];
  }

  function defaultAnnotations() {
    return [{
      id: 'ann-hachimi-spider',
      title: '野怪能力草案',
      text: '哈基米蜘蛛可以爬墙，可以飞扑，也可以在玩家靠近时切换追击路线。',
      targetId: null,
      resourceId: 'res-hachimi-spider',
      x: 80,
      y: -90,
      createdAt: nowIso(),
    }];
  }

  function defaultProject() {
    const player = defaultEntity('player', -330, 160);
    player.id = 'ent-player';
    const ground = defaultEntity('platform', -360, 260);
    ground.id = 'ent-ground';
    ground.name = '地面';
    ground.w = 720;
    const coin = defaultEntity('coin', 120, 104);
    coin.name = '金币 1';
    const ledge = defaultEntity('platform', 90, 170);
    ledge.name = '平台 1';
    return normalizeProject({
      kind: 'webhachimi-engine-project',
      version: PROJECT_VERSION,
      savedAt: null,
      meta: { name: '未命名游戏' },
      scene: { id: 'scene-main', name: '主场景', width: WORLD.width, height: WORLD.height, background: '#151515', gravity: 1600 },
      editor: { selectedId: player.id, selectedIds: [player.id], camera: { x: -40, y: 90, zoom: 1 } },
      entities: [player, ground, ledge, coin],
      entityFolders: [],
      resources: defaultResources(),
      annotations: defaultAnnotations(),
      windows: defaultWindows(),
      patches: [],
    });
  }

  function defaultWindows() { return clone(WINDOW_DEFAULTS); }

  function normalizeEntity(raw) {
    const entity = Object.assign(defaultEntitySkeleton(), raw || {});
    entity.id = typeof entity.id === 'string' && entity.id ? entity.id : uid('ent');
    entity.name = String(entity.name || '对象').slice(0, 60);
    entity.type = TYPE_LABELS[entity.type] ? entity.type : 'box';
    entity.x = finite(entity.x, 0);
    entity.y = finite(entity.y, 0);
    entity.w = clamp(finite(entity.w, 80), 8, 3000);
    entity.h = clamp(finite(entity.h, 80), 8, 3000);
    entity.rotation = finite(entity.rotation, 0);
    entity.color = validColor(entity.color, '#68a7ff');
    entity.text = String(entity.text || '');
    entity.description = String(entity.description || defaultDescription(entity.type)).slice(0, 500);
    entity.folderId = entity.folderId ? String(entity.folderId) : null;
    entity.traits = normalizeTraits(Array.isArray(raw && raw.traits) ? raw.traits : null, entity.type);
    entity.resourceRefs = Array.isArray(entity.resourceRefs) ? entity.resourceRefs.map(normalizeResourceRef).filter(Boolean) : [];
    entity.layer = Math.round(finite(entity.layer, 0));
    entity.visible = entity.visible !== false;
    entity.locked = entity.locked === true;
    entity.components = Object.assign(defaultEntitySkeleton().components, entity.components || {});
    entity.components.body = BODY_LABELS[entity.components.body] ? entity.components.body : 'static';
    entity.components.collider = entity.components.collider !== false;
    entity.components.controller = entity.components.controller === true;
    entity.components.gravity = entity.components.gravity === true;
    entity.components.collectible = entity.components.collectible === true;
    entity.components.hazard = entity.components.hazard === true;
    entity.tuning = Object.assign(defaultEntitySkeleton().tuning, entity.tuning || {});
    entity.tuning.speed = clamp(finite(entity.tuning.speed, 360), 0, 2400);
    entity.tuning.jump = clamp(finite(entity.tuning.jump, 680), 0, 2400);
    entity.tuning.gravity = clamp(finite(entity.tuning.gravity, 1600), -3000, 4000);
    entity.tuning.bounce = clamp(finite(entity.tuning.bounce, 0), 0, 1);
    return entity;
  }

  function normalizeProject(raw) {
    const source = raw && raw.project && typeof raw.project === 'object' ? raw.project : raw;
    const project = source && typeof source === 'object' ? clone(source) : {};
    project.kind = 'webhachimi-engine-project';
    project.version = PROJECT_VERSION;
    project.meta = Object.assign({ name: '未命名游戏' }, project.meta || {});
    project.meta.name = String(project.meta.name || '未命名游戏').slice(0, 80);
    project.scene = Object.assign({
      id: 'scene-main',
      name: '主场景',
      width: WORLD.width,
      height: WORLD.height,
      background: '#151515',
      gravity: 1600,
    }, project.scene || {});
    project.scene.name = String(project.scene.name || '主场景').slice(0, 80);
    project.scene.width = clamp(finite(project.scene.width, WORLD.width), 320, 10000);
    project.scene.height = clamp(finite(project.scene.height, WORLD.height), 240, 10000);
    project.scene.gravity = clamp(finite(project.scene.gravity, 1600), -3000, 4000);
    project.scene.background = validColor(project.scene.background, '#151515');
    project.editor = Object.assign({ selectedId: null, selectedIds: [], camera: { x: 0, y: 0, zoom: 1 } }, project.editor || {});
    project.editor.camera = Object.assign({ x: 0, y: 0, zoom: 1 }, project.editor.camera || {});
    project.editor.camera.x = finite(project.editor.camera.x, 0);
    project.editor.camera.y = finite(project.editor.camera.y, 0);
    project.editor.camera.zoom = clamp(finite(project.editor.camera.zoom, 1), 0.2, 4);
    project.entities = Array.isArray(project.entities) ? project.entities.map(normalizeEntity) : [];
    project.entityFolders = Array.isArray(project.entityFolders) ? project.entityFolders.map(normalizeEntityFolder).filter(Boolean) : [];
    project.resources = Array.isArray(project.resources) ? project.resources.map(normalizeResource) : defaultResources();
    project.annotations = Array.isArray(project.annotations) ? project.annotations.map(normalizeAnnotation) : defaultAnnotations();
    project.windows = normalizeWindows(project.windows);
    project.patches = Array.isArray(project.patches) ? project.patches : [];
    const ids = new Set();
    project.entities.forEach(function (entity) {
      if (ids.has(entity.id)) entity.id = uid('ent');
      ids.add(entity.id);
    });
    const folderIds = new Set(project.entityFolders.map(function (folder) { return folder.id; }));
    project.entities.forEach(function (entity) { if (entity.folderId && !folderIds.has(entity.folderId)) entity.folderId = null; });
    project.editor.selectedIds = Array.isArray(project.editor.selectedIds) ? project.editor.selectedIds.map(String).filter(function (id, index, list) {
      return ids.has(id) && list.indexOf(id) === index;
    }) : [];
    if (!project.entities.some(function (entity) { return entity.id === project.editor.selectedId; })) {
      project.editor.selectedId = project.editor.selectedIds[0] || null;
    }
    if (project.editor.selectedId && !project.editor.selectedIds.includes(project.editor.selectedId)) project.editor.selectedIds = [project.editor.selectedId];
    if (!project.editor.selectedId && project.editor.selectedIds[0]) project.editor.selectedId = project.editor.selectedIds[0];
    syncResourceBindings(project);
    return project;
  }

  function normalizeEntityFolder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : uid('folder');
    return {
      id: id,
      name: String(raw.name || '文件夹').slice(0, 60),
      createdAt: String(raw.createdAt || nowIso()),
    };
  }

  function normalizeResourceRef(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const resourceId = String(raw.resourceId || raw.id || '').trim();
    if (!resourceId) return null;
    return {
      resourceId: resourceId,
      slot: RESOURCE_SLOT_LABELS[raw.slot] ? raw.slot : 'appearance',
      note: String(raw.note || '').slice(0, 260),
      visualScale: clamp(finite(raw.visualScale, 1), 0.1, 6),
      attachedAt: String(raw.attachedAt || nowIso()),
    };
  }

  function normalizeResource(raw) {
    const resource = Object.assign({
      id: '',
      name: '未命名资源',
      type: 'note',
      color: '#68a7ff',
      tags: [],
      notes: '',
      linkedEntityId: null,
      intent: {},
      uses: [],
      attachments: [],
    }, raw || {});
    resource.id = typeof resource.id === 'string' && resource.id ? resource.id : uid('res');
    resource.name = String(resource.name || '未命名资源').slice(0, 80);
    resource.type = RESOURCE_TYPE_LABELS[resource.type] ? resource.type : 'note';
    resource.color = validColor(resource.color, '#68a7ff');
    resource.tags = Array.isArray(resource.tags) ? resource.tags.map(function (tag) { return String(tag || '').trim(); }).filter(Boolean).slice(0, 8) : [];
    resource.notes = String(resource.notes || '').slice(0, 1000);
    resource.linkedEntityId = resource.linkedEntityId ? String(resource.linkedEntityId) : null;
    resource.intent = normalizeResourceIntent(resource.intent, resource.type, resource.notes);
    resource.uses = Array.isArray(resource.uses) ? resource.uses.map(function (use) {
      return normalizeResourceUse(use, resource.id);
    }).filter(Boolean) : [];
    resource.attachments = Array.isArray(resource.attachments) ? resource.attachments.map(normalizeAttachment).filter(Boolean) : [];
    return resource;
  }

  function normalizeResourceIntent(raw, type, notes) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const role = RESOURCE_ROLE_LABELS[source.role] ? source.role : defaultResourceRole(type);
    return {
      role: role,
      usage: RESOURCE_USAGE_LABELS[source.usage] ? source.usage : defaultResourceUsage(type),
      timing: RESOURCE_TIMING_LABELS[source.timing] ? source.timing : 'immediate',
      placement: String(source.placement || '').slice(0, 180),
      instruction: String(source.instruction || notes || '').slice(0, 480),
    };
  }

  function normalizeResourceUse(raw, resourceId) {
    if (!raw || typeof raw !== 'object') return null;
    const use = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('use'),
      resourceId: String(raw.resourceId || resourceId || ''),
      entityId: raw.entityId ? String(raw.entityId) : null,
      trigger: RESOURCE_TIMING_LABELS[raw.trigger] ? raw.trigger : 'immediate',
      placement: String(raw.placement || '').slice(0, 220),
      note: String(raw.note || '').slice(0, 600),
      x: raw.x == null ? null : finite(raw.x, 0),
      y: raw.y == null ? null : finite(raw.y, 0),
      createdAt: String(raw.createdAt || nowIso()),
    };
    return use.resourceId ? use : null;
  }

  function normalizeAttachment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('att'),
      name: String(raw.name || '附件').slice(0, 120),
      mime: String(raw.mime || 'application/octet-stream'),
      path: raw.path ? String(raw.path) : '',
      dataUrl: raw.dataUrl ? String(raw.dataUrl) : '',
    };
  }

  function normalizeAnnotation(raw) {
    const annotation = Object.assign({
      id: '',
      title: '批注',
      text: '',
      targetId: null,
      resourceId: null,
      x: 0,
      y: 0,
      createdAt: nowIso(),
    }, raw || {});
    annotation.id = typeof annotation.id === 'string' && annotation.id ? annotation.id : uid('ann');
    annotation.title = String(annotation.title || '批注').slice(0, 80);
    annotation.text = String(annotation.text || '').slice(0, 900);
    annotation.targetId = annotation.targetId ? String(annotation.targetId) : null;
    annotation.resourceId = annotation.resourceId ? String(annotation.resourceId) : null;
    annotation.x = finite(annotation.x, 0);
    annotation.y = finite(annotation.y, 0);
    annotation.createdAt = String(annotation.createdAt || nowIso());
    return annotation;
  }

  function normalizeWindows(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = defaultWindows();
    Object.keys(out).forEach(function (key) {
      out[key] = normalizeWindowState(Object.assign(out[key], source[key] || {}));
    });
    return out;
  }

  function normalizeWindowState(raw) {
    return {
      open: raw.open !== false,
      x: clamp(finite(raw.x, 60), 0, 5000),
      y: clamp(finite(raw.y, 60), 0, 5000),
      w: clamp(finite(raw.w, 360), 240, 760),
      h: clamp(finite(raw.h, 420), 42, 760),
      z: Math.round(clamp(finite(raw.z, 1), 1, 999)),
      snap: isDockEdge(raw.snap) ? String(raw.snap) : '',
      collapsed: raw.collapsed === true,
    };
  }

  function defaultResourceRole(type) {
    if (type === 'animation') return 'movementAnimation';
    if (type === 'material') return 'material';
    if (type === 'audio') return 'audio';
    if (type === 'script') return 'script';
    if (type === 'note') return 'lore';
    return 'appearance';
  }

  function defaultResourceUsage(type) {
    if (type === 'animation') return 'attach';
    if (type === 'material' || type === 'image' || type === 'sprite') return 'attach';
    if (type === 'audio' || type === 'script') return 'trigger';
    return 'reference';
  }

  function isDockEdge(value) {
    return ['left', 'right', 'top', 'bottom'].includes(String(value || ''));
  }

  function syncResourceBindings(project) {
    const entityIds = new Set(project.entities.map(function (entity) { return entity.id; }));
    const resourceIds = new Set(project.resources.map(function (resource) { return resource.id; }));
    project.entities.forEach(function (entity) {
      entity.resourceRefs = entity.resourceRefs.filter(function (ref, index, list) {
        return resourceIds.has(ref.resourceId) && list.findIndex(function (item) { return item.resourceId === ref.resourceId; }) === index;
      });
    });
    project.resources.forEach(function (resource) {
      if (resource.linkedEntityId && !entityIds.has(resource.linkedEntityId)) resource.linkedEntityId = null;
      if (resource.linkedEntityId) ensureEntityResourceRef(project, resource.linkedEntityId, resource.id, resource.intent.role, resource.intent.instruction || resource.notes);
      resource.uses = resource.uses.filter(function (use) { return !use.entityId || entityIds.has(use.entityId); });
    });
    project.annotations.forEach(function (annotation) {
      if (annotation.targetId && !entityIds.has(annotation.targetId)) annotation.targetId = null;
      if (annotation.resourceId && !resourceIds.has(annotation.resourceId)) annotation.resourceId = null;
    });
  }

  function ensureEntityResourceRef(project, entityId, resourceId, slot, note, visualScale) {
    const entity = project.entities.find(function (item) { return item.id === entityId; });
    if (!entity) return null;
    entity.resourceRefs = Array.isArray(entity.resourceRefs) ? entity.resourceRefs : [];
    const existing = entity.resourceRefs.find(function (ref) { return ref.resourceId === resourceId; });
    const hasScale = visualScale !== undefined && visualScale !== null && visualScale !== '';
    if (existing) {
      existing.slot = RESOURCE_SLOT_LABELS[slot] ? slot : existing.slot;
      if (note !== undefined) existing.note = String(note || '').slice(0, 260);
      if (hasScale) existing.visualScale = clamp(finite(visualScale, existing.visualScale || 1), 0.1, 6);
      return existing;
    }
    const ref = normalizeResourceRef({
      resourceId: resourceId,
      slot: slot || 'appearance',
      note: note || '',
      visualScale: hasScale ? visualScale : 1,
    });
    entity.resourceRefs.push(ref);
    return ref;
  }

  const Store = {
    project: defaultProject(),
    history: [],
    future: [],
    listeners: [],
    server: false,
    lastSavedAt: null,

    selected: function () {
      return this.project.entities.find(function (entity) { return entity.id === Store.project.editor.selectedId; }) || null;
    },

    selectedEntities: function () {
      const ids = new Set(this.project.editor.selectedIds || []);
      return this.project.entities.filter(function (entity) { return ids.has(entity.id); });
    },

    subscribe: function (fn) { this.listeners.push(fn); },
    notify: function (reason) { this.listeners.forEach(function (fn) { fn(reason || 'change'); }); },

    replace: function (project, label, options) {
      const opts = options || {};
      const next = normalizeProject(project);
      if (opts.history !== false) {
        this.history.push({ label: label || '变更', project: clone(this.project) });
        this.future.length = 0;
      }
      this.project = next;
      Runtime.syncFromProject(true);
      this.notify(label || 'replace');
      if (opts.persist !== false) scheduleSave();
    },

    transient: function (mutator) {
      mutator(this.project);
      this.project = normalizeProject(this.project);
      Runtime.syncFromProject(true);
      this.notify('transient');
    },

    finalizeTransient: function (label, before) {
      if (!before) return;
      this.history.push({ label: label || '编辑', project: before });
      this.future.length = 0;
      this.project = normalizeProject(this.project);
      Runtime.syncFromProject(true);
      this.notify(label || 'edit');
      scheduleSave();
    },

    undo: function () {
      const frame = this.history.pop();
      if (!frame) return false;
      this.future.push({ label: frame.label, project: clone(this.project) });
      this.project = normalizeProject(frame.project);
      Runtime.syncFromProject(true);
      this.notify('undo');
      scheduleSave();
      return true;
    },

    redo: function () {
      const frame = this.future.pop();
      if (!frame) return false;
      this.history.push({ label: frame.label, project: clone(this.project) });
      this.project = normalizeProject(frame.project);
      Runtime.syncFromProject(true);
      this.notify('redo');
      scheduleSave();
      return true;
    },

    applyPatch: function (patch, options) {
      const opts = options || {};
      const before = clone(this.project);
      const beforeHistory = this.history.length;
      const beforeFuture = this.future.length;
      const ops = Array.isArray(patch && patch.operations) ? patch.operations : [];
      if (!ops.length) return { ok: false, error: '补丁没有可执行操作' };
      try {
        const draft = clone(this.project);
        ops.forEach(function (op, index) { applyOperation(draft, op, index); });
        const normalized = normalizeProject(draft);
        if (opts.dryRun) return { ok: true, project: normalized, operations: ops.length };
        this.history.push({ label: patch.reason || 'AI 补丁', project: before });
        this.future.length = 0;
        this.project = normalized;
        this.project.patches.push({ id: patch.id || uid('patch'), reason: patch.reason || '', createdAt: nowIso(), operations: clone(ops) });
        appendPatchLog(this.project.patches[this.project.patches.length - 1]);
        Runtime.syncFromProject(true);
        this.notify('patch');
        scheduleSave();
        return { ok: true, operations: ops.length };
      } catch (error) {
        this.project = before;
        this.history.length = beforeHistory;
        this.future.length = beforeFuture;
        Runtime.syncFromProject(true);
        this.notify('patch-failed');
        return { ok: false, error: error.message || String(error) };
      }
    },
  };

  function applyOperation(project, op, index) {
    if (!op || typeof op.op !== 'string') throw new Error('第 ' + (index + 1) + ' 个操作缺少类型');
    if (op.op === 'createEntity') {
      const entity = normalizeEntity(Object.assign(defaultEntity(op.template || 'box', 0, 0), op.entity || {}));
      if (project.entities.some(function (item) { return item.id === entity.id; })) entity.id = uid('ent');
      project.entities.push(entity);
      project.editor.selectedId = entity.id;
      project.editor.selectedIds = [entity.id];
      return;
    }
    if (op.op === 'updateEntity') {
      const entity = project.entities.find(function (item) { return item.id === op.id; });
      if (!entity) throw new Error('找不到对象：' + op.id);
      mergeEntity(entity, op.set || {});
      return;
    }
    if (op.op === 'deleteEntity') {
      const count = project.entities.length;
      project.entities = project.entities.filter(function (item) { return item.id !== op.id; });
      if (project.entities.length === count) throw new Error('找不到对象：' + op.id);
      project.resources.forEach(function (resource) {
        if (resource.linkedEntityId === op.id) resource.linkedEntityId = null;
        resource.uses.forEach(function (use) { if (use.entityId === op.id) use.entityId = null; });
      });
      project.annotations.forEach(function (annotation) { if (annotation.targetId === op.id) annotation.targetId = null; });
      project.editor.selectedIds = (project.editor.selectedIds || []).filter(function (id) { return id !== op.id; });
      if (project.editor.selectedId === op.id) project.editor.selectedId = project.editor.selectedIds[0] || null;
      return;
    }
    if (op.op === 'createEntityFolder') {
      const folder = normalizeEntityFolder(op.folder || {});
      if (project.entityFolders.some(function (item) { return item.id === folder.id; })) folder.id = uid('folder');
      project.entityFolders.push(folder);
      const ids = Array.isArray(op.entityIds) ? op.entityIds.map(String) : [];
      project.entities.forEach(function (entity) {
        if (ids.includes(entity.id)) entity.folderId = folder.id;
      });
      return;
    }
    if (op.op === 'setScene') {
      project.scene = Object.assign(project.scene || {}, op.set || {});
      return;
    }
    if (op.op === 'selectEntity') {
      if (op.id && !project.entities.some(function (item) { return item.id === op.id; })) throw new Error('找不到对象：' + op.id);
      project.editor.selectedId = op.id || null;
      project.editor.selectedIds = op.id ? [op.id] : [];
      return;
    }
    if (op.op === 'selectEntities') {
      const ids = Array.isArray(op.ids) ? op.ids.map(String).filter(function (id, index, list) {
        return list.indexOf(id) === index;
      }) : [];
      const valid = new Set(project.entities.map(function (entity) { return entity.id; }));
      const next = ids.filter(function (id) { return valid.has(id); });
      project.editor.selectedIds = next;
      project.editor.selectedId = next[0] || null;
      return;
    }
    if (op.op === 'createResource') {
      const resource = normalizeResource(op.resource || {});
      if (project.resources.some(function (item) { return item.id === resource.id; })) resource.id = uid('res');
      project.resources.push(resource);
      return;
    }
    if (op.op === 'updateResource') {
      const resource = project.resources.find(function (item) { return item.id === op.id; });
      if (!resource) throw new Error('找不到资源：' + op.id);
      Object.assign(resource, normalizeResource(Object.assign({}, resource, op.set || {})));
      return;
    }
    if (op.op === 'deleteResource') {
      const count = project.resources.length;
      project.resources = project.resources.filter(function (item) { return item.id !== op.id; });
      if (project.resources.length === count) throw new Error('找不到资源：' + op.id);
      project.entities.forEach(function (entity) { entity.resourceRefs = entity.resourceRefs.filter(function (ref) { return ref.resourceId !== op.id; }); });
      project.annotations.forEach(function (annotation) { if (annotation.resourceId === op.id) annotation.resourceId = null; });
      return;
    }
    if (op.op === 'attachResource') {
      const entity = project.entities.find(function (item) { return item.id === op.entityId; });
      const resource = project.resources.find(function (item) { return item.id === op.resourceId; });
      if (!entity) throw new Error('找不到对象：' + op.entityId);
      if (!resource) throw new Error('找不到资源：' + op.resourceId);
      ensureEntityResourceRef(project, entity.id, resource.id, op.slot || resource.intent.role, op.note || resource.intent.instruction || resource.notes, op.visualScale);
      resource.linkedEntityId = entity.id;
      if (op.intent) resource.intent = normalizeResourceIntent(Object.assign({}, resource.intent, op.intent), resource.type, resource.notes);
      return;
    }
    if (op.op === 'detachResource') {
      const resource = project.resources.find(function (item) { return item.id === op.resourceId; });
      if (!resource) throw new Error('找不到资源：' + op.resourceId);
      const targetIds = op.entityId ? [op.entityId] : project.entities.map(function (entity) { return entity.id; });
      targetIds.forEach(function (entityId) {
        const entity = project.entities.find(function (item) { return item.id === entityId; });
        if (entity) entity.resourceRefs = entity.resourceRefs.filter(function (ref) { return ref.resourceId !== op.resourceId; });
      });
      if (!op.entityId || resource.linkedEntityId === op.entityId) resource.linkedEntityId = null;
      return;
    }
    if (op.op === 'scheduleResourceUse') {
      const resource = project.resources.find(function (item) { return item.id === op.resourceId; });
      if (!resource) throw new Error('找不到资源：' + op.resourceId);
      const use = normalizeResourceUse(Object.assign({}, op.use || {}, { resourceId: resource.id }), resource.id);
      if (!use) throw new Error('资源使用计划无效');
      resource.uses.push(use);
      if (op.intent) resource.intent = normalizeResourceIntent(Object.assign({}, resource.intent, op.intent), resource.type, resource.notes);
      return;
    }
    if (op.op === 'createAnnotation') {
      const annotation = normalizeAnnotation(op.annotation || {});
      if (project.annotations.some(function (item) { return item.id === annotation.id; })) annotation.id = uid('ann');
      project.annotations.push(annotation);
      return;
    }
    if (op.op === 'updateAnnotation') {
      const annotation = project.annotations.find(function (item) { return item.id === op.id; });
      if (!annotation) throw new Error('找不到批注：' + op.id);
      Object.assign(annotation, normalizeAnnotation(Object.assign({}, annotation, op.set || {})));
      return;
    }
    if (op.op === 'deleteAnnotation') {
      const count = project.annotations.length;
      project.annotations = project.annotations.filter(function (item) { return item.id !== op.id; });
      if (project.annotations.length === count) throw new Error('找不到批注：' + op.id);
      return;
    }
    if (op.op === 'setWindow') {
      const key = String(op.key || '');
      if (!project.windows[key]) throw new Error('找不到窗口：' + key);
      project.windows[key] = normalizeWindowState(Object.assign(project.windows[key], op.set || {}));
      return;
    }
    throw new Error('未知操作：' + op.op);
  }

  function mergeEntity(entity, set) {
    Object.keys(set).forEach(function (key) {
      if (key === 'components' || key === 'tuning') entity[key] = Object.assign(entity[key] || {}, set[key] || {});
      else entity[key] = set[key];
    });
  }

  function appendPatchLog(entry) {
    try {
      const log = JSON.parse(localStorage.getItem(PATCH_LOG_KEY) || '[]');
      log.push(entry);
      localStorage.setItem(PATCH_LOG_KEY, JSON.stringify(log.slice(-80)));
    } catch (error) {
      console.warn(error);
    }
  }

  const Runtime = {
    playing: false,
    time: 0,
    frame: 0,
    fps: 0,
    sim: new Map(),

    play: function () {
      this.playing = true;
      this.syncFromProject();
      Store.notify('runtime');
      setMessage('运行中');
    },

    pause: function () {
      this.playing = false;
      Store.notify('runtime');
    },

    step: function () {
      const wasPlaying = this.playing;
      this.playing = true;
      this.update(1 / 60);
      this.playing = wasPlaying;
      Store.notify('runtime-step');
    },

    reset: function () {
      this.time = 0;
      this.frame = 0;
      this.sim.clear();
      this.syncFromProject(true);
      Store.notify('runtime-reset');
    },

    syncFromProject: function (hard) {
      const ids = new Set(Store.project.entities.map(function (entity) { return entity.id; }));
      Array.from(this.sim.keys()).forEach(function (id) { if (!ids.has(id)) Runtime.sim.delete(id); });
      Store.project.entities.forEach(function (entity) {
        const existing = Runtime.sim.get(entity.id);
        if (!existing || hard || !Runtime.playing || entity.components.body !== 'dynamic') {
          Runtime.sim.set(entity.id, { x: entity.x, y: entity.y, vx: 0, vy: 0, grounded: false, collected: false });
        } else {
          existing.w = entity.w;
          existing.h = entity.h;
        }
      });
    },

    update: function (dt) {
      if (!this.playing) return;
      this.time += dt;
      this.frame += 1;
      const entities = Store.project.entities;
      const solids = entities.filter(function (entity) {
        return entity.visible && entity.components.collider && entity.components.body === 'static';
      });
      entities.forEach(function (entity) {
        const sim = Runtime.sim.get(entity.id);
        if (!sim || sim.collected || !entity.visible) return;
        if (entity.components.controller) updateController(entity, sim, dt);
        if (entity.components.body === 'dynamic') updateDynamic(entity, sim, solids, dt);
        if (entity.components.body === 'kinematic') updateKinematic(entity, sim, dt);
      });
      collectAndHazard(entities);
    },
  };

  function updateController(entity, sim, dt) {
    let move = 0;
    if (input.left) move -= 1;
    if (input.right) move += 1;
    sim.vx = move * entity.tuning.speed;
    if ((input.up || input.jump) && sim.grounded) {
      sim.vy = -entity.tuning.jump;
      sim.grounded = false;
    }
    if (input.down) sim.vy += Math.abs(entity.tuning.gravity) * 0.25 * dt;
  }

  function updateDynamic(entity, sim, solids, dt) {
    const gravity = entity.components.gravity ? entity.tuning.gravity : Store.project.scene.gravity;
    sim.vy += gravity * dt;
    sim.x += sim.vx * dt;
    resolveAxis(entity, sim, solids, 'x');
    sim.y += sim.vy * dt;
    sim.grounded = false;
    resolveAxis(entity, sim, solids, 'y');
    if (sim.y > Store.project.scene.height + 600) {
      sim.x = entity.x;
      sim.y = entity.y;
      sim.vx = 0;
      sim.vy = 0;
    }
  }

  function updateKinematic(entity, sim, dt) {
    const range = Math.max(30, entity.tuning.speed);
    sim.x = entity.x + Math.sin(Runtime.time * 1.5 + entity.x * 0.01) * range;
    sim.y = entity.y + Math.cos(Runtime.time * 0.8 + entity.y * 0.01) * Math.min(18, range * 0.18);
    sim.vx = (sim.x - entity.x) / Math.max(dt, 0.001);
  }

  function resolveAxis(entity, sim, solids, axis) {
    solids.forEach(function (solid) {
      if (solid.id === entity.id) return;
      const box = { x: sim.x, y: sim.y, w: entity.w, h: entity.h };
      if (!aabb(box, solid)) return;
      if (axis === 'x') {
        if (sim.vx > 0) sim.x = solid.x - entity.w;
        else if (sim.vx < 0) sim.x = solid.x + solid.w;
        sim.vx = 0;
      } else {
        if (sim.vy > 0) {
          sim.y = solid.y - entity.h;
          sim.grounded = true;
        } else if (sim.vy < 0) {
          sim.y = solid.y + solid.h;
        }
        sim.vy *= -entity.tuning.bounce;
      }
    });
  }

  function collectAndHazard(entities) {
    const players = entities.filter(function (entity) { return entity.components.controller; });
    players.forEach(function (player) {
      const ps = Runtime.sim.get(player.id);
      if (!ps) return;
      entities.forEach(function (entity) {
        if (entity.id === player.id || !entity.visible) return;
        const sim = Runtime.sim.get(entity.id);
        if (!sim || sim.collected) return;
        if (!aabb({ x: ps.x, y: ps.y, w: player.w, h: player.h }, { x: sim.x, y: sim.y, w: entity.w, h: entity.h })) return;
        if (entity.components.collectible) sim.collected = true;
        if (entity.components.hazard) {
          ps.x = player.x;
          ps.y = player.y;
          ps.vx = 0;
          ps.vy = 0;
        }
      });
    });
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  const Renderer = {
    ctx: null,
    dpr: 1,
    fpsFrames: 0,
    lastFpsTime: 0,

    init: function () {
      this.ctx = refs.canvas.getContext('2d');
      refs.canvas.tabIndex = 0;
      this.resize();
      window.addEventListener('resize', this.resize.bind(this));
    },

    resize: function () {
      const rect = refs.canvas.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      refs.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
      refs.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
      this.draw();
    },

    toScreen: function (x, y) {
      const cam = Store.project.editor.camera;
      return {
        x: refs.canvas.width / (2 * this.dpr) + (x - cam.x) * cam.zoom,
        y: refs.canvas.height / (2 * this.dpr) + (y - cam.y) * cam.zoom,
      };
    },

    toWorld: function (clientX, clientY) {
      const rect = refs.canvas.getBoundingClientRect();
      const cam = Store.project.editor.camera;
      return {
        x: ((clientX - rect.left) - rect.width / 2) / cam.zoom + cam.x,
        y: ((clientY - rect.top) - rect.height / 2) / cam.zoom + cam.y,
      };
    },

    draw: function () {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const w = refs.canvas.width / this.dpr;
      const h = refs.canvas.height / this.dpr;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = Store.project.scene.background;
      ctx.fillRect(0, 0, w, h);
      drawGrid(ctx, w, h);
      Store.project.entities
        .filter(function (entity) { return entity.visible; })
        .sort(function (a, b) { return a.layer - b.layer; })
        .forEach(function (entity) { drawEntity(ctx, entity); });
      drawAnnotationPins(ctx);
      drawSelection(ctx);
      ctx.restore();
    },
  };

  function drawGrid(ctx, width, height) {
    const cam = Store.project.editor.camera;
    const step = 64 * cam.zoom;
    if (step < 12) return;
    const origin = Renderer.toScreen(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = origin.x % step; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = origin.y % step; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,184,74,0.18)';
    ctx.beginPath();
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, height);
    ctx.moveTo(0, origin.y);
    ctx.lineTo(width, origin.y);
    ctx.stroke();
  }

  function drawEntity(ctx, entity) {
    const sim = Runtime.sim.get(entity.id);
    if (sim && sim.collected) return;
    const pos = sim || entity;
    const p = Renderer.toScreen(pos.x, pos.y);
    const zoom = Store.project.editor.camera.zoom;
    const w = entity.w * zoom;
    const h = entity.h * zoom;
    ctx.save();
    ctx.translate(p.x + w / 2, p.y + h / 2);
    ctx.rotate((entity.rotation || 0) * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);
    const visual = primaryEntityVisual(entity);
    const visualResource = visual ? visual.resource : null;
    const visualScale = clamp(finite(visual && visual.ref ? visual.ref.visualScale : 1, 1), 0.1, 6);
    const visualImage = visualResource ? getResourceImage(visualResource) : null;
    if (visualImage) {
      const drawW = w * visualScale;
      const drawH = h * visualScale;
      const drawX = (w - drawW) / 2;
      const drawY = (h - drawH) / 2;
      ctx.drawImage(visualImage, drawX, drawY, drawW, drawH);
      ctx.strokeStyle = 'rgba(255,255,255,0.38)';
      ctx.strokeRect(0, 0, w, h);
      if (Math.abs(visualScale - 1) > 0.01) {
        ctx.strokeStyle = 'rgba(230,184,74,0.5)';
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(drawX, drawY, drawW, drawH);
        ctx.setLineDash([]);
      }
    } else if (entity.type === 'coin') {
      ctx.fillStyle = entity.color;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.52)';
      ctx.stroke();
    } else if (entity.type === 'text') {
      ctx.fillStyle = entity.color;
      ctx.font = Math.max(13, h * 0.48) + 'px system-ui, sans-serif';
      ctx.fillText(entity.text || entity.name, 0, h * 0.68);
    } else if (entity.type === 'zone') {
      ctx.fillStyle = hexToRgba(entity.color, 0.22);
      ctx.strokeStyle = entity.color;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(0, 0, w, h);
      ctx.strokeRect(0, 0, w, h);
    } else {
      ctx.fillStyle = visualResource && visualResource.type === 'material' ? visualResource.color : entity.color;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.strokeRect(0, 0, w, h);
      if (entity.type === 'player') {
        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.fillRect(w * 0.18, h * 0.22, w * 0.18, h * 0.15);
        ctx.fillRect(w * 0.64, h * 0.22, w * 0.18, h * 0.15);
      }
      if (entity.type === 'enemy') {
        ctx.strokeStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath();
        ctx.moveTo(w * 0.2, h * 0.55);
        ctx.lineTo(w * 0.8, h * 0.55);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawSelection(ctx) {
    const selected = Store.selectedEntities();
    if (!selected.length) {
      drawMarquee(ctx);
      return;
    }
    const bounds = selectionBounds(selected);
    const p = Renderer.toScreen(bounds.x, bounds.y);
    const zoom = Store.project.editor.camera.zoom;
    ctx.save();
    ctx.strokeStyle = '#42c89f';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(p.x - 4, p.y - 4, bounds.w * zoom + 8, bounds.h * zoom + 8);
    ctx.setLineDash([]);
    if (selected.length === 1) drawTransformHandles(ctx, bounds);
    else drawSelectionCount(ctx, bounds, selected.length);
    drawMarquee(ctx);
    ctx.restore();
  }

  function drawSelectionCount(ctx, bounds, count) {
    const p = Renderer.toScreen(bounds.x, bounds.y);
    ctx.fillStyle = '#42c89f';
    ctx.fillRect(p.x - 4, p.y - 24, 64, 18);
    ctx.fillStyle = '#10100f';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText(count + ' 个对象', p.x + 4, p.y - 11);
  }

  function drawTransformHandles(ctx, bounds) {
    transformHandlePoints(bounds).forEach(function (item) {
      ctx.fillStyle = item.name === 'rotate' ? '#e6b84a' : (item.name === 'move' ? '#f3f1ea' : '#42c89f');
      ctx.strokeStyle = '#10100f';
      ctx.lineWidth = 1;
      if (item.name === 'move') {
        ctx.beginPath();
        ctx.arc(item.x, item.y, MOVE_HANDLE_SIZE * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#42c89f';
        ctx.beginPath();
        ctx.moveTo(item.x - MOVE_HANDLE_SIZE * 0.32, item.y);
        ctx.lineTo(item.x + MOVE_HANDLE_SIZE * 0.32, item.y);
        ctx.moveTo(item.x, item.y - MOVE_HANDLE_SIZE * 0.32);
        ctx.lineTo(item.x, item.y + MOVE_HANDLE_SIZE * 0.32);
        ctx.stroke();
      } else if (item.name === 'rotate') {
        ctx.beginPath();
        ctx.arc(item.x, item.y, TRANSFORM_HANDLE_SIZE * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        const s = TRANSFORM_HANDLE_SIZE;
        ctx.fillRect(item.x - s / 2, item.y - s / 2, s, s);
        ctx.strokeRect(item.x - s / 2, item.y - s / 2, s, s);
      }
    });
  }

  function drawMarquee(ctx) {
    if (!activeCanvasDrag || activeCanvasDrag.type !== 'marquee' || !activeCanvasDrag.moved) return;
    const rect = canvasMarqueeRect(activeCanvasDrag);
    ctx.save();
    ctx.fillStyle = 'rgba(66, 200, 159, 0.11)';
    ctx.strokeStyle = '#42c89f';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  function drawAnnotationPins(ctx) {
    Store.project.annotations.forEach(function (annotation, index) {
      const point = annotationPoint(annotation);
      const p = Renderer.toScreen(point.x, point.y);
      ctx.save();
      ctx.fillStyle = '#e6b84a';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#151515';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), p.x, p.y + 0.5);
      ctx.restore();
    });
  }

  function annotationPoint(annotation) {
    const entity = annotation.targetId && Store.project.entities.find(function (item) { return item.id === annotation.targetId; });
    if (entity) return { x: entity.x + entity.w + 18, y: entity.y - 12 };
    return { x: annotation.x, y: annotation.y };
  }

  function hexToRgba(hex, alpha) {
    const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 'rgba(255,255,255,' + alpha + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }

  const Editor = {
    init: function () {
      bindTopbar();
      bindPalette();
      bindCanvas();
      bindCommands();
      Store.subscribe(function () { Editor.render(); Renderer.draw(); });
      this.render();
    },

    render: function () {
      refs.sceneName.textContent = Store.project.scene.name;
      refs.runtimeBadge.textContent = Runtime.playing ? '运行中' : '已暂停';
      refs.saveState.textContent = Store.server ? '磁盘同步' : '本地';
      renderEntityList();
      renderInspector();
      renderResources();
      renderAnnotations();
      renderWindows();
    },
  };

  function bindTopbar() {
    refs.playBtn.addEventListener('click', function () { Runtime.play(); });
    refs.pauseBtn.addEventListener('click', function () { Runtime.pause(); });
    refs.stepBtn.addEventListener('click', function () { Runtime.step(); });
    refs.resetRuntimeBtn.addEventListener('click', function () { Runtime.reset(); });
    refs.undoBtn.addEventListener('click', function () { if (!Store.undo()) setMessage('没有可撤销的内容'); });
    refs.redoBtn.addEventListener('click', function () { if (!Store.redo()) setMessage('没有可重做的内容'); });
    refs.forceReloadBtn.addEventListener('click', forceReloadFromDisk);
    refs.exportBtn.addEventListener('click', exportProject);
    refs.importBtn.addEventListener('click', function () { refs.importInput.click(); });
    refs.importInput.addEventListener('change', importProject);
    refs.resetWindowsBtn.addEventListener('click', resetWindows);
    refs.windowManagerBtn.addEventListener('click', toggleWindowManager);
    document.querySelectorAll('[data-window-toggle]').forEach(function (button) {
      button.addEventListener('click', function () { toggleWindow(button.dataset.windowToggle); });
    });
    refs.deleteEntityBtn.addEventListener('click', function () {
      deleteSelectedEntities();
    });
  }

  function bindPalette() {
    document.querySelectorAll('[data-template]').forEach(function (button) {
      button.addEventListener('click', function () { addEntity(button.dataset.template); });
    });
    refs.addEntityBtn.addEventListener('click', function () { addEntity('box'); });
  }

  function bindCanvas() {
    refs.canvas.addEventListener('pointerdown', function (event) {
      refs.canvas.focus();
      hideContextMenu();
      const world = Renderer.toWorld(event.clientX, event.clientY);
      const hit = hitTest(world.x, world.y);
      if (event.button === 0) {
        const handle = transformHandleAt(event.clientX, event.clientY);
        if (handle) {
          event.preventDefault();
          activeCanvasDrag = handle === 'move'
            ? startEntityMoveDrag(Store.selectedEntities()[0], event, world)
            : startTransformDrag(handle, event);
        } else if (hit && !hit.locked) {
          event.preventDefault();
          activeCanvasDrag = startEntityMoveDrag(hit, event, world);
        } else {
          activeCanvasDrag = {
            type: 'marquee',
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            startWorld: world,
            hitId: hit ? hit.id : null,
            moved: false,
          };
        }
        try { refs.canvas.setPointerCapture(event.pointerId); } catch (error) {}
        return;
      }
      if (event.button !== 1) {
        if (event.button === 2) event.preventDefault();
        return;
      }
      event.preventDefault();
      activeCanvasDrag = {
        type: 'camera',
        pointerId: event.pointerId,
        before: clone(Store.project),
        x: event.clientX,
        y: event.clientY,
        camera: clone(Store.project.editor.camera),
        moved: false,
      };
      try { refs.canvas.setPointerCapture(event.pointerId); } catch (error) {}
    });
    refs.canvas.addEventListener('pointermove', function (event) {
      const world = Renderer.toWorld(event.clientX, event.clientY);
      refs.cursorBadge.textContent = Math.round(world.x) + ', ' + Math.round(world.y);
      if (!activeCanvasDrag || event.pointerId !== activeCanvasDrag.pointerId) return;
      if (activeCanvasDrag.type === 'camera') {
        activeCanvasDrag.moved = activeCanvasDrag.moved || Math.abs(event.clientX - activeCanvasDrag.x) > 1 || Math.abs(event.clientY - activeCanvasDrag.y) > 1;
        Store.transient(function (project) {
          const cam = project.editor.camera;
          cam.x = activeCanvasDrag.camera.x - (event.clientX - activeCanvasDrag.x) / cam.zoom;
          cam.y = activeCanvasDrag.camera.y - (event.clientY - activeCanvasDrag.y) / cam.zoom;
        });
      } else if (activeCanvasDrag.type === 'marquee') {
        activeCanvasDrag.x = event.clientX;
        activeCanvasDrag.y = event.clientY;
        activeCanvasDrag.moved = activeCanvasDrag.moved || Math.abs(event.clientX - activeCanvasDrag.startX) > MARQUEE_THRESHOLD || Math.abs(event.clientY - activeCanvasDrag.startY) > MARQUEE_THRESHOLD;
        Renderer.draw();
      } else if (activeCanvasDrag.type === 'entityMove') {
        updateEntityMoveDrag(event);
      } else if (activeCanvasDrag.type === 'transform') {
        updateTransformDrag(event);
      }
    });
    refs.canvas.addEventListener('pointerup', finishCanvasDrag);
    refs.canvas.addEventListener('pointercancel', finishCanvasDrag);
    refs.canvas.addEventListener('auxclick', function (event) { if (event.button === 1) event.preventDefault(); });
    refs.canvas.addEventListener('contextmenu', showCanvasContextMenu);
    refs.canvas.addEventListener('wheel', function (event) {
      event.preventDefault();
      hideContextMenu();
      const before = Renderer.toWorld(event.clientX, event.clientY);
      const cam = Store.project.editor.camera;
      const nextZoom = clamp(cam.zoom * (event.deltaY < 0 ? 1.1 : 0.9), 0.2, 4);
      cam.zoom = nextZoom;
      const after = Renderer.toWorld(event.clientX, event.clientY);
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
      Store.notify('zoom');
      scheduleSave();
    }, { passive: false });
    refs.appShell.addEventListener('contextmenu', function (event) {
      if (event.target === refs.canvas) return;
      if (event.target && event.target.closest('input,textarea,select')) return;
      event.preventDefault();
      hideContextMenu();
    });
    window.addEventListener('pointerdown', function (event) {
      if (event.button === 2) return;
      if (contextMenuState && refs.contextMenu && !refs.contextMenu.contains(event.target)) hideContextMenu();
    });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') hideContextMenu();
    });
    window.addEventListener('keydown', function (event) {
      if (isTyping()) return;
      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (!Store.undo()) setMessage('没有可撤销的内容');
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        if (!Store.redo()) setMessage('没有可重做的内容');
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelectedEntities();
      }
      setKey(event.key, true);
    });
    window.addEventListener('keyup', function (event) { setKey(event.key, false); });
  }

  function finishCanvasDrag(event) {
    if (!activeCanvasDrag || event.pointerId !== activeCanvasDrag.pointerId) return;
    if (activeCanvasDrag.type === 'camera') {
      if (activeCanvasDrag.moved) Store.finalizeTransient('移动镜头', activeCanvasDrag.before);
    } else if (activeCanvasDrag.type === 'marquee') {
      if (activeCanvasDrag.moved) {
        const rect = marqueeWorldRect(activeCanvasDrag);
        selectEntityIds(entitiesInRect(rect).map(function (entity) { return entity.id; }), '框选对象');
      } else {
        selectEntityById(activeCanvasDrag.hitId || null, activeCanvasDrag.hitId ? '选择对象' : '取消选择');
      }
      Renderer.draw();
    } else if (activeCanvasDrag.type === 'entityMove') {
      if (activeCanvasDrag.moved) Store.finalizeTransient('移动对象', activeCanvasDrag.before);
      Renderer.draw();
    } else if (activeCanvasDrag.type === 'transform') {
      Store.finalizeTransient(activeCanvasDrag.mode === 'rotate' ? '旋转对象' : '调整对象大小', activeCanvasDrag.before);
    }
    activeCanvasDrag = null;
  }

  function startEntityMoveDrag(hit, event, world) {
    if (!isEntitySelected(hit.id)) selectEntityById(hit.id, '选择对象');
    const items = Store.selectedEntities()
      .filter(function (entity) { return !entity.locked; })
      .map(function (entity) { return { id: entity.id, x: entity.x, y: entity.y }; });
    return {
      type: 'entityMove',
      pointerId: event.pointerId,
      before: clone(Store.project),
      startX: event.clientX,
      startY: event.clientY,
      startWorld: world,
      moved: false,
      items: items,
    };
  }

  function updateEntityMoveDrag(event) {
    const drag = activeCanvasDrag;
    const world = Renderer.toWorld(event.clientX, event.clientY);
    drag.moved = drag.moved || Math.abs(event.clientX - drag.startX) > MARQUEE_THRESHOLD || Math.abs(event.clientY - drag.startY) > MARQUEE_THRESHOLD;
    if (!drag.moved || !drag.items.length) return;
    const dx = world.x - drag.startWorld.x;
    const dy = world.y - drag.startWorld.y;
    Store.transient(function (project) {
      drag.items.forEach(function (item) {
        const entity = project.entities.find(function (candidate) { return candidate.id === item.id; });
        if (!entity || entity.locked) return;
        entity.x = Math.round(item.x + dx);
        entity.y = Math.round(item.y + dy);
      });
    });
  }

  function selectionBounds(entities) {
    const list = entities && entities.length ? entities : Store.selectedEntities();
    if (!list.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    list.forEach(function (entity) {
      minX = Math.min(minX, entity.x);
      minY = Math.min(minY, entity.y);
      maxX = Math.max(maxX, entity.x + entity.w);
      maxY = Math.max(maxY, entity.y + entity.h);
    });
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function transformHandlePoints(bounds) {
    if (!bounds) return [];
    const zoom = Store.project.editor.camera.zoom;
    const topLeft = Renderer.toScreen(bounds.x, bounds.y);
    const topRight = Renderer.toScreen(bounds.x + bounds.w, bounds.y);
    const bottomLeft = Renderer.toScreen(bounds.x, bounds.y + bounds.h);
    const bottomRight = Renderer.toScreen(bounds.x + bounds.w, bounds.y + bounds.h);
    const midX = (topLeft.x + topRight.x) / 2;
    const midY = (topLeft.y + bottomLeft.y) / 2;
    return [
      { name: 'move', x: midX, y: midY },
      { name: 'nw', x: topLeft.x, y: topLeft.y },
      { name: 'n', x: midX, y: topLeft.y },
      { name: 'ne', x: topRight.x, y: topRight.y },
      { name: 'e', x: topRight.x, y: midY },
      { name: 'se', x: bottomRight.x, y: bottomRight.y },
      { name: 's', x: midX, y: bottomRight.y },
      { name: 'sw', x: bottomLeft.x, y: bottomLeft.y },
      { name: 'w', x: topLeft.x, y: midY },
      { name: 'rotate', x: midX, y: topLeft.y - ROTATE_HANDLE_OFFSET * Math.max(0.7, zoom) },
    ];
  }

  function transformHandleAt(clientX, clientY) {
    const selected = Store.selectedEntities();
    if (selected.length !== 1) return '';
    const bounds = selectionBounds(selected);
    const rect = refs.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const points = transformHandlePoints(bounds);
    const moveHandle = points.find(function (item) { return item.name === 'move'; });
    if (moveHandle && Math.abs(moveHandle.x - x) <= MOVE_HANDLE_SIZE && Math.abs(moveHandle.y - y) <= MOVE_HANDLE_SIZE) return 'move';
    const found = points.find(function (item) {
      if (item.name === 'move') return false;
      const hitSize = item.name === 'rotate' ? TRANSFORM_HANDLE_SIZE + 10 : TRANSFORM_HANDLE_SIZE + 4;
      return Math.abs(item.x - x) <= hitSize && Math.abs(item.y - y) <= hitSize;
    });
    return found ? found.name : '';
  }

  function startTransformDrag(handle, event) {
    const entity = Store.selectedEntities()[0];
    const startWorld = Renderer.toWorld(event.clientX, event.clientY);
    return {
      type: 'transform',
      pointerId: event.pointerId,
      mode: handle === 'rotate' ? 'rotate' : 'resize',
      handle: handle,
      entityId: entity.id,
      before: clone(Store.project),
      startWorld: startWorld,
      entity: clone(entity),
      center: { x: entity.x + entity.w / 2, y: entity.y + entity.h / 2 },
    };
  }

  function updateTransformDrag(event) {
    const drag = activeCanvasDrag;
    const world = Renderer.toWorld(event.clientX, event.clientY);
    Store.transient(function (project) {
      const entity = project.entities.find(function (item) { return item.id === drag.entityId; });
      if (!entity || entity.locked) return;
      if (drag.mode === 'rotate') {
        const angle = Math.atan2(world.y - drag.center.y, world.x - drag.center.x) * 180 / Math.PI + 90;
        entity.rotation = Math.round(angle);
        return;
      }
      resizeEntityFromHandle(entity, drag.entity, drag.handle, world);
    });
  }

  function resizeEntityFromHandle(entity, start, handle, world) {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;
    if (handle.includes('w')) left = world.x;
    if (handle.includes('e')) right = world.x;
    if (handle.includes('n')) top = world.y;
    if (handle.includes('s')) bottom = world.y;
    if (right < left) {
      const swapX = right;
      right = left;
      left = swapX;
    }
    if (bottom < top) {
      const swapY = bottom;
      bottom = top;
      top = swapY;
    }
    entity.x = Math.round(left);
    entity.y = Math.round(top);
    entity.w = Math.round(Math.max(8, right - left));
    entity.h = Math.round(Math.max(8, bottom - top));
  }

  function canvasMarqueeRect(drag) {
    const rect = refs.canvas.getBoundingClientRect();
    const x1 = drag.startX - rect.left;
    const y1 = drag.startY - rect.top;
    const x2 = drag.x - rect.left;
    const y2 = drag.y - rect.top;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  function marqueeWorldRect(drag) {
    const a = drag.startWorld;
    const b = Renderer.toWorld(drag.x, drag.y);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  function entitiesInRect(rect) {
    return Store.project.entities.filter(function (entity) {
      if (!entity.visible) return false;
      return entity.x < rect.x + rect.w && entity.x + entity.w > rect.x && entity.y < rect.y + rect.h && entity.y + entity.h > rect.y;
    });
  }

  function showCanvasContextMenu(event) {
    event.preventDefault();
    const world = Renderer.toWorld(event.clientX, event.clientY);
    const hit = hitTest(world.x, world.y);
    const selected = Store.selectedEntities();
    const groupTarget = selected.length > 1 && (!hit || isEntitySelected(hit.id));
    contextMenuState = { world: world, entityId: hit ? hit.id : null };
    const menu = ensureContextMenu();
    menu.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = groupTarget ? '已选：' + selected.length + ' 个对象' : (hit ? '对象：' + hit.name : '画布');
    menu.appendChild(title);
    if (groupTarget) {
      menu.append(
        contextMenuItem('给选中对象写批注', function () { createAnnotationForSelectedGroup(world); }),
        contextMenuItem('组合为文件夹', groupSelectedAsFolder),
        contextMenuItem('取消选择', function () { selectEntityIds([], '取消选择'); })
      );
    } else if (hit) {
      menu.append(
        contextMenuItem('选中对象', function () { selectEntityById(hit.id, '选择对象'); }),
        contextMenuItem('镜头聚焦到对象', function () { focusEntityInCanvas(hit.id); }),
        contextMenuItem('查看对象资源', function () { openScopedWindow(hit.id, 'resources'); }),
        contextMenuItem('查看对象批注', function () { openScopedWindow(hit.id, 'annotations'); })
      );
    } else {
      menu.append(
        contextMenuItem('取消选择', function () { selectEntityById(null, '取消选择'); }),
        contextMenuItem('在这里新建方块', function () { createEntityAt('box', world.x, world.y); }),
        contextMenuItem('镜头居中到这里', function () { centerCameraAt(world.x, world.y); })
      );
    }
    menu.classList.remove('is-hidden');
    menu.style.left = clamp(event.clientX, 0, window.innerWidth - 220) + 'px';
    menu.style.top = clamp(event.clientY, 0, window.innerHeight - 160) + 'px';
    requestAnimationFrame(function () {
      const rect = menu.getBoundingClientRect();
      menu.style.left = clamp(event.clientX, 0, Math.max(0, window.innerWidth - rect.width)) + 'px';
      menu.style.top = clamp(event.clientY, 0, Math.max(0, window.innerHeight - rect.height)) + 'px';
    });
  }

  function ensureContextMenu() {
    if (refs.contextMenu) return refs.contextMenu;
    const menu = document.createElement('div');
    menu.className = 'canvas-context-menu is-hidden';
    menu.setAttribute('role', 'menu');
    refs.appShell.appendChild(menu);
    refs.contextMenu = menu;
    return menu;
  }

  function contextMenuItem(label, fn) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.addEventListener('click', function () {
      hideContextMenu();
      fn();
    });
    return button;
  }

  function hideContextMenu() {
    contextMenuState = null;
    if (refs.contextMenu) refs.contextMenu.classList.add('is-hidden');
  }

  function focusEntityInCanvas(entityId) {
    const entity = Store.project.entities.find(function (item) { return item.id === entityId; });
    if (!entity) return;
    const before = clone(Store.project);
    Store.transient(function (project) {
      project.editor.selectedId = entity.id;
      project.editor.selectedIds = [entity.id];
      project.editor.camera.x = entity.x + entity.w / 2;
      project.editor.camera.y = entity.y + entity.h / 2;
    });
    Store.finalizeTransient('定位对象', before);
  }

  function openScopedWindow(entityId, key) {
    selectEntityById(entityId, '选择对象');
    setWindowOpen(key, true);
    if (key === 'annotations') refs.annotationTextInput.focus();
    if (key === 'resources') refs.resourceNameInput.focus();
  }

  function createEntityAt(template, x, y) {
    const entity = defaultEntity(template, Math.round(x - 40), Math.round(y - 40));
    entity.name = typeLabel(entity.type);
    Store.applyPatch({ reason: '在画布新建' + typeLabel(entity.type), operations: [{ op: 'createEntity', template: template, entity: entity }] });
  }

  function centerCameraAt(x, y) {
    const before = clone(Store.project);
    Store.transient(function (project) {
      project.editor.camera.x = x;
      project.editor.camera.y = y;
    });
    Store.finalizeTransient('移动镜头', before);
  }

  function groupSelectedAsFolder() {
    const selected = Store.selectedEntities();
    if (selected.length < 2) {
      setMessage('至少选择两个对象才能组合为文件夹', 'error');
      return;
    }
    const folder = normalizeEntityFolder({
      id: uid('folder'),
      name: '文件夹 ' + (Store.project.entityFolders.length + 1),
    });
    Store.applyPatch({
      reason: '组合为文件夹',
      operations: [{ op: 'createEntityFolder', folder: folder, entityIds: selected.map(function (entity) { return entity.id; }) }],
    });
  }

  function deleteSelectedEntities() {
    const selected = Store.selectedEntities();
    if (!selected.length) return;
    Store.applyPatch({
      reason: selected.length > 1 ? '删除选中对象' : '删除对象',
      operations: selected.map(function (entity) { return { op: 'deleteEntity', id: entity.id }; }),
    });
  }

  function createAnnotationForSelectedGroup(world) {
    const selected = Store.selectedEntities();
    if (!selected.length) return;
    setWindowOpen('annotations', true);
    refs.annotationTextInput.placeholder = '给这 ' + selected.length + ' 个选中对象写集体批注';
    refs.annotationTextInput.focus();
  }

  function setKey(key, value) {
    if (key === 'ArrowLeft' || key.toLowerCase() === 'a') input.left = value;
    if (key === 'ArrowRight' || key.toLowerCase() === 'd') input.right = value;
    if (key === 'ArrowUp' || key.toLowerCase() === 'w') input.up = value;
    if (key === 'ArrowDown' || key.toLowerCase() === 's') input.down = value;
    if (key === ' ') input.jump = value;
  }

  function isTyping() {
    const tag = document.activeElement && document.activeElement.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function hitTest(x, y) {
    return Store.project.entities
      .filter(function (entity) { return entity.visible; })
      .sort(function (a, b) { return b.layer - a.layer; })
      .find(function (entity) { return x >= entity.x && x <= entity.x + entity.w && y >= entity.y && y <= entity.y + entity.h; }) || null;
  }

  function addEntity(template) {
    const cam = Store.project.editor.camera;
    const entity = defaultEntity(template, cam.x - 40, cam.y - 40);
    entity.name = typeLabel(entity.type);
    Store.applyPatch({ reason: '新建' + typeLabel(entity.type), operations: [{ op: 'createEntity', template: template, entity: entity }] });
  }

  function renderEntityList() {
    refs.entityList.innerHTML = '';
    Store.project.entityFolders.forEach(function (folder) {
      const entities = Store.project.entities
        .filter(function (entity) { return entity.folderId === folder.id; })
        .sort(function (a, b) { return a.layer - b.layer || a.name.localeCompare(b.name); });
      if (!entities.length) return;
      const node = createTreeFolder('entity-tree-folder custom-folder', folder.id, folder.name, entities.length, entityTreeOpen);
      entities.forEach(function (entity) { node.body.appendChild(entityTreeRow(entity)); });
      refs.entityList.appendChild(node.root);
    });
    const groups = groupEntitiesByFolder();
    ENTITY_FOLDER_DEFS.forEach(function (folder) {
      const entities = groups[folder.key] || [];
      if (!entities.length) return;
      const node = createTreeFolder('entity-tree-folder', folder.key, folder.label, entities.length, entityTreeOpen);
      entities.forEach(function (entity) {
        node.body.appendChild(entityTreeRow(entity));
      });
      refs.entityList.appendChild(node.root);
    });
    if (!refs.entityList.children.length) appendEmpty(refs.entityList, '场景里还没有对象');
  }

  function groupEntitiesByFolder() {
    const groups = {};
    ENTITY_FOLDER_DEFS.forEach(function (folder) { groups[folder.key] = []; });
    Store.project.entities
      .slice()
      .filter(function (entity) { return !entity.folderId; })
      .sort(function (a, b) { return a.layer - b.layer || a.name.localeCompare(b.name); })
      .forEach(function (entity) {
        const key = entityFolderKey(entity);
        (groups[key] || groups.misc).push(entity);
      });
    return groups;
  }

  function entityFolderKey(entity) {
    if (entity.type === 'player' || entity.components.controller) return 'characters';
    if (entity.type === 'platform') return 'terrain';
    if (entity.type === 'coin' || entity.components.collectible) return 'collectibles';
    if (entity.type === 'enemy' || entity.components.hazard) return 'hazards';
    if (entity.type === 'zone') return 'triggers';
    if (entity.type === 'text') return 'text';
    return 'misc';
  }

  function entityTreeRow(entity) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'entity-row tree-leaf' + (isEntitySelected(entity.id) ? ' selected' : '');
    row.innerHTML = '<span class="entity-swatch"></span><span class="entity-name"></span><span class="entity-type"></span>';
    row.querySelector('.entity-swatch').style.background = entity.color;
    row.querySelector('.entity-name').textContent = entity.name;
    row.querySelector('.entity-type').textContent = entitySummaryText(entity);
    row.addEventListener('click', function () { selectEntityById(entity.id, '选择对象'); });
    return row;
  }

  function entitySummaryText(entity) {
    const pieces = [typeLabel(entity.type)];
    if (!entity.visible) pieces.push('隐藏');
    if (entity.locked) pieces.push('锁定');
    if (entity.resourceRefs && entity.resourceRefs.length) pieces.push(entity.resourceRefs.length + ' 资源');
    return pieces.join(' · ');
  }

  function createTreeFolder(className, key, label, count, openMap) {
    const root = document.createElement('details');
    root.className = className + ' tree-folder';
    root.open = openMap[key] !== false;
    root.addEventListener('toggle', function () { openMap[key] = root.open; });
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.className = 'tree-folder-name';
    title.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'tree-folder-count';
    badge.textContent = String(count);
    summary.append(title, badge);
    const body = document.createElement('div');
    body.className = 'tree-folder-body';
    root.append(summary, body);
    return { root: root, body: body };
  }

  function appendEmpty(parent, text) {
    const empty = document.createElement('div');
    empty.className = 'resource-empty';
    empty.textContent = text;
    parent.appendChild(empty);
  }

  function selectEntityById(id, reason) {
    const nextId = id || null;
    if (Store.project.editor.selectedId === nextId && (Store.project.editor.selectedIds || []).length <= 1) return;
    Store.applyPatch({ reason: reason || '选择对象', operations: [{ op: 'selectEntity', id: nextId }] });
  }

  function selectEntityIds(ids, reason) {
    const next = Array.isArray(ids) ? ids : [];
    Store.applyPatch({ reason: reason || '框选对象', operations: [{ op: 'selectEntities', ids: next }] });
  }

  function isEntitySelected(id) {
    return (Store.project.editor.selectedIds || []).includes(id);
  }

  function renderInspector() {
    refs.inspectorForm.innerHTML = '';
    const entity = Store.selected();
    if (!entity) {
      emptyInspector();
      return;
    }
    addField('名称', 'name', entity.name, 'text', 'wide');
    addField('类型', 'type', entity.type, 'select', '', Object.keys(TYPE_LABELS).map(optionPair(TYPE_LABELS)));
    addField('颜色', 'color', entity.color, 'color');
    addField('图层', 'layer', entity.layer, 'number');
    addField('X', 'x', entity.x, 'number');
    addField('Y', 'y', entity.y, 'number');
    addField('宽度', 'w', entity.w, 'number');
    addField('高度', 'h', entity.h, 'number');
    addField('旋转', 'rotation', entity.rotation, 'number');
    if (entity.type === 'text') addField('文本', 'text', entity.text, 'text', 'wide');
    addField('刚体', 'components.body', entity.components.body, 'select', '', Object.keys(BODY_LABELS).map(optionPair(BODY_LABELS)));
    addField('碰撞', 'components.collider', entity.components.collider, 'checkbox');
    addField('控制器', 'components.controller', entity.components.controller, 'checkbox');
    addField('重力', 'components.gravity', entity.components.gravity, 'checkbox');
    addField('可收集', 'components.collectible', entity.components.collectible, 'checkbox');
    addField('危险', 'components.hazard', entity.components.hazard, 'checkbox');
    addField('可见', 'visible', entity.visible, 'checkbox');
    addField('锁定', 'locked', entity.locked, 'checkbox');
    addField('速度', 'tuning.speed', entity.tuning.speed, 'number');
    addField('跳跃', 'tuning.jump', entity.tuning.jump, 'number');
    addField('重力强度', 'tuning.gravity', entity.tuning.gravity, 'number');
    addField('弹性', 'tuning.bounce', entity.tuning.bounce, 'number');
    addAdvancedInspector(entity);
  }

  function optionPair(labelMap) {
    return function (key) { return { value: key, label: labelMap[key] }; };
  }

  function emptyInspector() {
    const box = document.createElement('div');
    box.className = 'resource-empty wide';
    box.textContent = '未选择对象';
    refs.inspectorForm.appendChild(box);
  }

  function addField(labelText, path, value, type, className, options) {
    const field = document.createElement('label');
    field.className = 'field' + (className ? ' ' + className : '') + (type === 'checkbox' ? ' checkbox-field' : '');
    const caption = document.createElement('span');
    caption.textContent = labelText;
    let inputEl;
    if (type === 'select') {
      inputEl = document.createElement('select');
      (options || []).forEach(function (option) {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        inputEl.appendChild(el);
      });
      inputEl.value = value;
    } else {
      inputEl = document.createElement('input');
      inputEl.type = type;
      if (type === 'checkbox') inputEl.checked = !!value;
      else inputEl.value = value;
    }
    inputEl.addEventListener('change', function () {
      const set = {};
      let next;
      if (type === 'checkbox') next = inputEl.checked;
      else if (type === 'number') next = Number(inputEl.value);
      else next = inputEl.value;
      setNested(set, path, next);
      const entity = Store.selected();
      if (entity) Store.applyPatch({ reason: '属性编辑', operations: [{ op: 'updateEntity', id: entity.id, set: set }] });
    });
    if (type === 'checkbox') field.append(inputEl, caption);
    else field.append(caption, inputEl);
    refs.inspectorForm.appendChild(field);
  }

  function addAdvancedInspector(entity) {
    const panel = document.createElement('section');
    panel.className = 'advanced-panel';
    const title = document.createElement('h3');
    title.textContent = '设定';
    const desc = document.createElement('textarea');
    desc.value = entity.description;
    desc.rows = 3;
    desc.addEventListener('change', function () { updateSelectedEntity({ description: desc.value }); });
    const traitTitle = document.createElement('h3');
    traitTitle.textContent = '特性';
    const list = document.createElement('ul');
    list.className = 'trait-list';
    entity.traits.forEach(function (trait, index) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = trait;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini-action';
      remove.textContent = '×';
      remove.addEventListener('click', function () {
        const next = entity.traits.slice();
        next.splice(index, 1);
        updateSelectedEntity({ traits: next });
      });
      li.append(span, remove);
      list.appendChild(li);
    });
    const tools = document.createElement('div');
    tools.className = 'trait-tools';
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = '新增特性';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'text-button';
    addBtn.textContent = '添加';
    addBtn.addEventListener('click', function () {
      const value = inputEl.value.trim();
      if (!value) return;
      updateSelectedEntity({ traits: normalizeTraits(entity.traits.concat(value), entity.type) });
    });
    inputEl.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); addBtn.click(); } });
    tools.append(inputEl, addBtn);
    const presetBtn = document.createElement('button');
    presetBtn.type = 'button';
    presetBtn.className = 'text-button';
    presetBtn.textContent = '套用蜘蛛';
    presetBtn.addEventListener('click', applySpiderPreset);
    panel.append(title, desc, traitTitle, list, tools, presetBtn, resourceBindingSection(entity));
    refs.inspectorForm.appendChild(panel);
  }

  function resourceBindingSection(entity) {
    const section = document.createElement('section');
    section.className = 'resource-binding-panel';
    const title = document.createElement('h3');
    title.textContent = '角色资源';
    const list = document.createElement('div');
    list.className = 'resource-binding-list';
    if (!entity.resourceRefs.length) {
      const empty = document.createElement('div');
      empty.className = 'resource-empty';
      empty.textContent = '暂无角色资源';
      list.appendChild(empty);
    }
    entity.resourceRefs.forEach(function (ref) {
      const resource = Store.project.resources.find(function (item) { return item.id === ref.resourceId; });
      if (!resource) return;
      const row = document.createElement('div');
      row.className = 'resource-ref-row';
      const meta = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = resource.name;
      const detail = document.createElement('span');
      detail.textContent = resourceTypeLabel(resource.type) + ' · ' + resourceSlotLabel(ref.slot);
      meta.append(name, detail);
      const useRow = document.createElement('div');
      useRow.className = 'resource-ref-use';
      const slot = resourceSlotSelect(ref.slot);
      const note = document.createElement('input');
      note.type = 'text';
      note.value = ref.note || '';
      note.placeholder = '用途，例如：移动时播放';
      const scale = document.createElement('input');
      scale.type = 'number';
      scale.min = '0.1';
      scale.max = '6';
      scale.step = '0.1';
      scale.value = String(ref.visualScale || 1);
      scale.title = '资源视觉缩放，不改变碰撞体';
      scale.setAttribute('aria-label', '资源视觉缩放');
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'mini-action';
      save.textContent = '保存用途';
      save.addEventListener('click', function () {
        attachResourceToEntity(entity.id, resource.id, slot.value, note.value, scale.value);
      });
      const detach = document.createElement('button');
      detach.type = 'button';
      detach.className = 'mini-action';
      detach.textContent = '卸载';
      detach.addEventListener('click', function () { detachResourceFromEntity(entity.id, resource.id); });
      useRow.append(slot, note, scale, save);
      row.append(meta, detach, useRow);
      list.appendChild(row);
    });
    const tools = document.createElement('div');
    tools.className = 'resource-bind-tools';
    const select = document.createElement('select');
    Store.project.resources.forEach(function (resource) {
      const option = document.createElement('option');
      option.value = resource.id;
      option.textContent = resource.name;
      select.appendChild(option);
    });
    const slot = resourceSlotSelect('movementAnimation');
    const note = document.createElement('input');
    note.type = 'text';
    note.placeholder = '用途，例如：移动时播放';
    const attach = document.createElement('button');
    attach.type = 'button';
    attach.className = 'text-button';
    attach.textContent = '加入角色';
    attach.disabled = Store.project.resources.length === 0;
    attach.addEventListener('click', function () { attachResourceToEntity(entity.id, select.value, slot.value, note.value); });
    tools.append(select, slot, note, attach);
    const importTools = document.createElement('div');
    importTools.className = 'resource-import-tools';
    const importSlot = resourceSlotSelect('movementAnimation');
    const importNote = document.createElement('input');
    importNote.type = 'text';
    importNote.placeholder = '用途，例如：移动时播放这个 GIF';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,.gif,.json,.txt,.md';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'text-button primary';
    importButton.textContent = '导入到角色';
    importButton.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      importFilesForEntity(Array.from(fileInput.files || []), entity.id, importSlot.value, importNote.value);
      fileInput.value = '';
    });
    importTools.append(importSlot, importNote, importButton, fileInput);
    section.append(title, list, tools, importTools);
    return section;
  }

  function resourceSlotSelect(value) {
    const select = document.createElement('select');
    Object.keys(RESOURCE_SLOT_LABELS).forEach(function (key) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = RESOURCE_SLOT_LABELS[key];
      select.appendChild(option);
    });
    select.value = RESOURCE_SLOT_LABELS[value] ? value : 'appearance';
    return select;
  }

  function importFilesForEntity(files, entityId, slot, note) {
    const entity = Store.project.entities.find(function (item) { return item.id === entityId; });
    if (!entity || !files.length) return;
    files.forEach(function (file) {
      createResourceFromFile(file, entity.id, slot, note || '', '导入角色资源');
    });
  }

  function setNested(target, path, value) {
    const parts = path.split('.');
    let node = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      node[parts[i]] = node[parts[i]] || {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }

  function updateSelectedEntity(set) {
    const entity = Store.selected();
    if (!entity) return;
    Store.applyPatch({ reason: '设定编辑', operations: [{ op: 'updateEntity', id: entity.id, set: set }] });
  }

  function applySpiderPreset() {
    const entity = Store.selected();
    if (!entity) return;
    Store.applyPatch({
      reason: '套用哈基米蜘蛛',
      operations: [{
        op: 'updateEntity',
        id: entity.id,
        set: {
          name: '哈基米蜘蛛',
          type: 'enemy',
          color: '#ef6666',
          description: '高机动野怪，适合放在墙面、天花板或狭窄通道制造压力。',
          traits: ['可以爬墙', '可以飞扑', '贴着墙面追踪玩家', '靠近时进入攻击预备'],
          components: { body: 'kinematic', collider: true, hazard: true },
          tuning: { speed: Math.max(entity.tuning.speed, 180) },
        },
      }],
    });
  }

  function renderResources() {
    const selected = Store.selected();
    const resources = scopedResources(selected);
    refs.resourceCount.textContent = selected ? selected.name + ' · ' + resources.length + ' 个资源' : Store.project.resources.length + ' 个资源';
    refs.resourceNameInput.placeholder = selected ? '给 ' + selected.name + ' 新建资源' : '资源名称';
    refs.resourceList.innerHTML = '';
    if (!resources.length) {
      appendEmpty(refs.resourceList, selected ? '当前对象还没有资源。新建或导入后会自动挂到它下面。' : '项目里还没有资源');
    }
    renderResourceTree(resources, selected);
    renderAnnotationResourceOptions();
  }

  function scopedResources(selected) {
    if (!selected) return Store.project.resources.slice();
    return Store.project.resources.filter(function (resource) { return resourceBelongsToEntity(resource, selected); });
  }

  function resourceBelongsToEntity(resource, entity) {
    if (!resource || !entity) return false;
    if (resource.linkedEntityId === entity.id) return true;
    return !!resourceRefForEntity(resource, entity);
  }

  function resourceRefForEntity(resource, entity) {
    if (!resource || !entity) return null;
    return (entity.resourceRefs || []).find(function (ref) { return ref.resourceId === resource.id; }) || null;
  }

  function renderResourceTree(resources, selected) {
    const groups = {};
    sortedResources(resources).forEach(function (resource) {
      const key = resourceFolderKey(resource, selected);
      (groups[key] = groups[key] || []).push(resource);
    });
    resourceFolderOrder(groups, selected).forEach(function (key) {
      const items = groups[key] || [];
      if (!items.length) return;
      const folderKey = (selected ? selected.id : 'project') + ':' + key;
      const node = createTreeFolder('resource-tree-folder', folderKey, resourceFolderLabel(key, selected), items.length, resourceTreeOpen);
      items.forEach(function (resource) { node.body.appendChild(resourceCard(resource, selected)); });
      refs.resourceList.appendChild(node.root);
    });
  }

  function sortedResources(resources) {
    return resources.slice().sort(function (a, b) {
      return resourceTypeLabel(a.type).localeCompare(resourceTypeLabel(b.type)) || a.name.localeCompare(b.name);
    });
  }

  function resourceFolderKey(resource, selected) {
    if (selected) {
      const ref = resourceRefForEntity(resource, selected);
      return ref ? ref.slot : (resource.intent && resource.intent.role) || defaultResourceRole(resource.type);
    }
    return resource.type;
  }

  function resourceFolderLabel(key, selected) {
    if (selected) return RESOURCE_SLOT_LABELS[key] || RESOURCE_ROLE_LABELS[key] || key;
    return RESOURCE_TYPE_LABELS[key] || key;
  }

  function resourceFolderOrder(groups, selected) {
    const base = selected ? Object.keys(RESOURCE_SLOT_LABELS) : Object.keys(RESOURCE_TYPE_LABELS);
    const extras = Object.keys(groups).filter(function (key) { return !base.includes(key); }).sort();
    return base.concat(extras);
  }

  function resourceCard(resource, selected) {
    const card = document.createElement('article');
    card.className = 'resource-card';
    card.draggable = true;
    card.dataset.resourceId = resource.id;
    card.addEventListener('dragstart', function (event) {
      event.dataTransfer.setData('text/plain', 'resource:' + resource.id);
      event.dataTransfer.effectAllowed = 'copy';
    });
    const preview = document.createElement('div');
    preview.className = 'resource-preview';
    const imageSrc = resourceImageSrc(resource);
    if (imageSrc) {
      const img = document.createElement('img');
      img.src = imageSrc;
      img.alt = resource.name;
      preview.appendChild(img);
    } else {
      preview.style.background = resource.color;
    }
    const meta = document.createElement('div');
    meta.className = 'resource-meta';
    const title = document.createElement('strong');
    title.textContent = resource.name;
    const detail = document.createElement('span');
    const ref = selected ? resourceRefForEntity(resource, selected) : null;
    const scaleText = ref && Math.abs((ref.visualScale || 1) - 1) > 0.01 ? ' · 视觉 ' + ref.visualScale + 'x' : '';
    detail.textContent = resourceTypeLabel(resource.type) + (ref ? ' · ' + resourceSlotLabel(ref.slot) + scaleText : resourceTargetText(resource));
    const notes = document.createElement('p');
    notes.textContent = resource.notes || resource.tags.join('、') || '资源条目';
    const intent = document.createElement('p');
    intent.className = 'resource-intent';
    intent.textContent = resourceIntentText(resource);
    meta.append(title, detail, notes, intent);
    const actions = document.createElement('div');
    actions.className = 'resource-actions';
    const useBtn = actionButton('使用', function () { useResourceNow(resource.id); });
    const annotateBtn = actionButton('生成批注', function () { createAnnotationForResource(resource.id); });
    const deleteBtn = actionButton('删除', function () { deleteResource(resource.id); });
    if (selected) {
      if (ref) {
        const scaleInput = document.createElement('input');
        scaleInput.type = 'number';
        scaleInput.min = '0.1';
        scaleInput.max = '6';
        scaleInput.step = '0.1';
        scaleInput.value = String(ref.visualScale || 1);
        scaleInput.className = 'resource-scale-input';
        scaleInput.title = '资源视觉缩放，不改变碰撞体';
        scaleInput.setAttribute('aria-label', '资源视觉缩放');
        const scaleBtn = actionButton('保存视觉', function () {
          attachResourceToEntity(selected.id, resource.id, ref.slot, ref.note, scaleInput.value);
        });
        actions.append(scaleInput, scaleBtn);
      }
      const detachBtn = actionButton('卸载', function () { detachResourceFromEntity(selected.id, resource.id); });
      detachBtn.disabled = !ref;
      actions.append(useBtn, annotateBtn, detachBtn, deleteBtn);
    } else {
      const bindBtn = actionButton('挂到选中', function () { bindResourceToSelected(resource.id); });
      bindBtn.disabled = !Store.selected();
      actions.append(bindBtn, useBtn, annotateBtn, deleteBtn);
    }
    const resourceNotes = annotationsForResource(resource.id);
    const annotationBox = document.createElement('div');
    annotationBox.className = 'resource-annotation-box';
    const annotationInput = document.createElement('textarea');
    annotationInput.rows = 2;
    annotationInput.placeholder = '给这个资源写批注，例如：这是跑步 GIF';
    const annotationButton = document.createElement('button');
    annotationButton.type = 'button';
    annotationButton.className = 'text-button primary';
    annotationButton.textContent = '添加资源批注';
    annotationButton.addEventListener('click', function () {
      createResourceAnnotation(resource.id, annotationInput.value, selected && resourceBelongsToEntity(resource, selected) ? selected.id : resource.linkedEntityId);
      annotationInput.value = '';
    });
    const annotationSummary = document.createElement('span');
    annotationSummary.textContent = resourceNotes.length ? resourceNotes.length + ' 条资源批注' : '暂无资源批注';
    annotationBox.append(annotationSummary, annotationInput, annotationButton);
    card.append(preview, meta, actions, annotationBox);
    return card;
  }

  function actionButton(text, fn) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-action';
    button.textContent = text;
    button.addEventListener('click', fn);
    return button;
  }

  function resourceImageSrc(resource) {
    const attachment = (resource.attachments || []).find(function (att) {
      return String(att.mime || '').startsWith('image/') && (att.dataUrl || att.path);
    });
    return attachment ? (attachment.dataUrl || attachment.path) : '';
  }

  function primaryEntityVisual(entity) {
    const refsForEntity = entity.resourceRefs || [];
    const preferred = refsForEntity.find(function (ref) {
      return ref.slot === 'appearance' || ref.slot === 'material';
    }) || refsForEntity[0];
    if (preferred) {
      const resource = Store.project.resources.find(function (item) { return item.id === preferred.resourceId; });
      if (resource) return { resource: resource, ref: preferred };
    }
    const linked = Store.project.resources.find(function (resource) {
      return resource.linkedEntityId === entity.id && ['image', 'sprite', 'animation', 'material'].includes(resource.type);
    }) || null;
    return linked ? { resource: linked, ref: { resourceId: linked.id, slot: resourceSlotForResource(linked), note: '', visualScale: 1 } } : null;
  }

  function primaryEntityResource(entity) {
    const visual = primaryEntityVisual(entity);
    return visual ? visual.resource : null;
  }

  function getResourceImage(resource) {
    const src = resourceImageSrc(resource);
    if (!src) return null;
    const cached = imageCache.get(src);
    if (cached) return cached.loaded ? cached.image : null;
    const image = new Image();
    const entry = { image: image, loaded: false };
    image.onload = function () {
      entry.loaded = true;
      Renderer.draw();
    };
    image.onerror = function () { imageCache.delete(src); };
    image.src = src;
    imageCache.set(src, entry);
    return null;
  }

  function resourceTargetText(resource) {
    if (!resource.linkedEntityId) return '';
    const entity = Store.project.entities.find(function (item) { return item.id === resource.linkedEntityId; });
    return entity ? ' · ' + entity.name : '';
  }

  function resourceIntentText(resource) {
    const intent = resource.intent || {};
    const pieces = [resourceRoleLabel(intent.role), resourceUsageLabel(intent.usage), resourceTimingLabel(intent.timing)];
    if (intent.placement) pieces.push(intent.placement);
    if (resource.uses && resource.uses.length) pieces.push(resource.uses.length + ' 个使用计划');
    return pieces.join(' · ');
  }

  function addResourceFromForm() {
    const name = refs.resourceNameInput.value.trim() || '未命名资源';
    const type = refs.resourceTypeSelect.value || 'note';
    const selected = Store.selected();
    const resource = normalizeResource({
      id: uid('res'),
      name: name,
      type: type,
      color: selected ? selected.color : '#68a7ff',
      tags: selected ? [typeLabel(selected.type)] : [],
      notes: selected ? selected.name + ' 的关联资源。' : '',
      linkedEntityId: selected ? selected.id : null,
      intent: {
        role: defaultResourceRole(type),
        usage: selected ? 'attach' : defaultResourceUsage(type),
        timing: 'immediate',
        placement: selected ? selected.name : '当前场景',
        instruction: selected ? '挂载到 ' + selected.name + '，作为 AI 可读取的对象素材。' : '作为 AI 可读取的项目素材。',
      },
    });
    Store.applyPatch({ reason: '新建资源', operations: [{ op: 'createResource', resource: resource }] });
    refs.resourceNameInput.value = '';
  }

  function importResourceFiles(event) {
    const files = Array.from(event.target.files || []);
    importFilesToResourceScope(files, Store.selected(), '导入资源');
    event.target.value = '';
  }

  function importFilesToResourceScope(files, entity, reason, slot, note) {
    if (!files || !files.length) return;
    files.forEach(function (file) {
      createResourceFromFile(file, entity ? entity.id : null, slot || '', note || '', reason || '导入资源');
    });
  }

  function createResourceFromFile(file, entityId, slot, note, reason) {
    if (!file) return;
    const entity = entityId && Store.project.entities.find(function (item) { return item.id === entityId; });
    const reader = new FileReader();
    reader.onload = function () {
      const type = resourceTypeForFile(file);
      const usage = String(note || '').trim() || (entity ? defaultResourceInstruction(type, entity) : '可被 AI 放入场景或挂载到对象。');
      const resource = normalizeResource({
        id: uid('res'),
        name: String(file.name || '粘贴资源').replace(/\.[^.]+$/, ''),
        type: type,
        color: entity ? entity.color : '#68a7ff',
        tags: entity ? [typeLabel(entity.type)] : [],
        notes: entity ? entity.name + ' 的导入资源。' : '导入文件资源。',
        linkedEntityId: entity ? entity.id : null,
        intent: {
          role: slot || defaultResourceRole(type),
          usage: entity ? 'attach' : 'place',
          timing: usage.includes('移动') || usage.includes('跑') ? 'onStart' : 'immediate',
          placement: entity ? entity.name : '当前画布中心',
          instruction: usage,
        },
        attachments: [{ id: uid('att'), name: file.name || 'clipboard', mime: file.type || 'application/octet-stream', dataUrl: String(reader.result || '') }],
      });
      const operations = [{ op: 'createResource', resource: resource }];
      if (entity) operations.push({ op: 'attachResource', entityId: entity.id, resourceId: resource.id, slot: slot || resourceSlotForResource(resource), note: usage, intent: resource.intent });
      Store.applyPatch({ reason: reason || '导入资源', operations: operations });
    };
    reader.readAsDataURL(file);
  }

  function createTextResource(text, entity, reason) {
    const value = String(text || '').trim();
    if (!value) return;
    const resource = normalizeResource({
      id: uid('res'),
      name: value.split(/\n/)[0].slice(0, 28) || '文本资源',
      type: 'note',
      color: entity ? entity.color : '#68a7ff',
      tags: entity ? [typeLabel(entity.type)] : ['文本'],
      notes: value,
      linkedEntityId: entity ? entity.id : null,
      intent: {
        role: 'lore',
        usage: entity ? 'attach' : 'reference',
        timing: 'immediate',
        placement: entity ? entity.name : '项目',
        instruction: value,
      },
    });
    const operations = [{ op: 'createResource', resource: resource }];
    if (entity) operations.push({ op: 'attachResource', entityId: entity.id, resourceId: resource.id, slot: 'lore', note: value, intent: resource.intent });
    Store.applyPatch({ reason: reason || '粘贴文本资源', operations: operations });
  }

  function resourceTypeForFile(file) {
    const mime = String(file && file.type || '');
    if (mime === 'image/gif') return 'animation';
    if (mime.startsWith('image/')) return 'image';
    return 'note';
  }

  function defaultResourceInstruction(type, entity) {
    if (type === 'animation') return '作为 ' + entity.name + ' 的移动动画。';
    if (type === 'image' || type === 'sprite') return '作为 ' + entity.name + ' 的外观素材。';
    return '作为 ' + entity.name + ' 的关联资源。';
  }

  function bindResourceToSelected(resourceId) {
    const selected = Store.selected();
    if (!selected) return;
    attachResourceToEntity(selected.id, resourceId, 'appearance', '从资源库挂载到选中对象');
  }

  function attachResourceToEntity(entityId, resourceId, slot, note, visualScale) {
    if (!entityId || !resourceId) return;
    const operation = { op: 'attachResource', entityId: entityId, resourceId: resourceId, slot: slot || 'appearance', note: note || '' };
    if (visualScale !== undefined && visualScale !== null && visualScale !== '') {
      operation.visualScale = clamp(finite(visualScale, 1), 0.1, 6);
    }
    Store.applyPatch({
      reason: '挂载资源',
      operations: [operation],
    });
  }

  function detachResourceFromEntity(entityId, resourceId) {
    Store.applyPatch({ reason: '卸载资源', operations: [{ op: 'detachResource', entityId: entityId, resourceId: resourceId }] });
  }

  function deleteResource(resourceId) {
    Store.applyPatch({ reason: '删除资源', operations: [{ op: 'deleteResource', id: resourceId }] });
  }

  function useResourceNow(resourceId) {
    const resource = Store.project.resources.find(function (item) { return item.id === resourceId; });
    if (!resource) return;
    const patch = resourceUsePatch(resource, '使用资源：' + resource.name, { forceCreate: true });
    const dry = Store.applyPatch(patch, { dryRun: true });
    if (!dry.ok) {
      setMessage(dry.error, 'error');
      return;
    }
    const result = Store.applyPatch(patch);
    setMessage(result.ok ? '已使用资源' : result.error, result.ok ? 'info' : 'error');
  }

  function createAnnotationForResource(resourceId) {
    const resource = Store.project.resources.find(function (item) { return item.id === resourceId; });
    const selected = Store.selected();
    const cam = Store.project.editor.camera;
    const annotation = normalizeAnnotation({
      id: uid('ann'),
      title: resource ? resource.name : '资源批注',
      text: resource ? [resource.notes, resource.intent && resource.intent.instruction].filter(Boolean).join('\n') || '资源批注' : '资源批注',
      targetId: selected ? selected.id : (resource ? resource.linkedEntityId : null),
      resourceId: resourceId,
      x: cam.x,
      y: cam.y,
    });
    Store.applyPatch({ reason: '新增资源批注', operations: [{ op: 'createAnnotation', annotation: annotation }] });
  }

  function createResourceAnnotation(resourceId, text, entityId) {
    const value = String(text || '').trim();
    if (!value) {
      setMessage('请输入资源批注内容', 'error');
      return;
    }
    const resource = Store.project.resources.find(function (item) { return item.id === resourceId; });
    if (!resource) return;
    const linkedEntity = entityId && Store.project.entities.find(function (item) { return item.id === entityId; });
    const cam = Store.project.editor.camera;
    const annotation = normalizeAnnotation({
      id: uid('ann'),
      title: value.split(/\n/)[0].slice(0, 28) || resource.name,
      text: value,
      targetId: linkedEntity ? linkedEntity.id : resource.linkedEntityId,
      resourceId: resource.id,
      x: linkedEntity ? linkedEntity.x + linkedEntity.w + 28 : cam.x,
      y: linkedEntity ? linkedEntity.y + 18 : cam.y,
    });
    Store.applyPatch({
      reason: '新增资源批注',
      operations: [
        { op: 'createAnnotation', annotation: annotation },
        { op: 'updateResource', id: resource.id, set: { intent: Object.assign({}, resource.intent, { instruction: value }) } },
      ],
    });
  }

  function renderAnnotations() {
    const selected = Store.selected();
    const selectedMany = Store.selectedEntities();
    const annotations = scopedAnnotationsForSelection(selectedMany);
    refs.annotationCount.textContent = selectedMany.length > 1 ? '已选 ' + selectedMany.length + ' 个对象 · ' + annotations.length + ' 条批注' : (selected ? selected.name + ' · ' + annotations.length + ' 条批注' : Store.project.annotations.length + ' 条批注');
    refs.annotationTextInput.placeholder = selectedMany.length > 1 ? '给这 ' + selectedMany.length + ' 个对象写集体批注' : (selected ? '给 ' + selected.name + ' 写专属批注' : '给场景或资源写批注');
    refs.annotationList.innerHTML = '';
    if (!annotations.length) appendEmpty(refs.annotationList, selectedMany.length ? '当前选择还没有专属批注' : '还没有批注');
    annotations.forEach(function (annotation, index) {
      const card = document.createElement('article');
      card.className = 'annotation-card';
      const meta = document.createElement('div');
      meta.className = 'annotation-meta';
      const title = document.createElement('strong');
      title.textContent = (index + 1) + '. ' + annotation.title;
      const linked = document.createElement('span');
      linked.textContent = annotationLinkedText(annotation);
      const text = document.createElement('p');
      text.textContent = annotation.text || '空批注';
      meta.append(title, linked, text);
      const actions = document.createElement('div');
      actions.className = 'annotation-actions';
      actions.append(
        actionButton('定位', function () { focusAnnotation(annotation.id); }),
        actionButton('删除', function () { deleteAnnotation(annotation.id); })
      );
      card.append(meta, actions);
      refs.annotationList.appendChild(card);
    });
    renderAnnotationResourceOptions();
  }

  function scopedAnnotations(selected) {
    if (!selected) return Store.project.annotations.slice();
    return Store.project.annotations.filter(function (annotation) {
      if (annotation.targetId === selected.id) return true;
      const resource = annotation.resourceId && Store.project.resources.find(function (item) { return item.id === annotation.resourceId; });
      return resourceBelongsToEntity(resource, selected);
    });
  }

  function scopedAnnotationsForSelection(selectedMany) {
    if (!selectedMany.length) return Store.project.annotations.slice();
    if (selectedMany.length === 1) return scopedAnnotations(selectedMany[0]);
    const ids = new Set(selectedMany.map(function (entity) { return entity.id; }));
    return Store.project.annotations.filter(function (annotation) { return annotation.targetId && ids.has(annotation.targetId); });
  }

  function annotationLinkedText(annotation) {
    const parts = [];
    const entity = annotation.targetId && Store.project.entities.find(function (item) { return item.id === annotation.targetId; });
    const resource = annotation.resourceId && Store.project.resources.find(function (item) { return item.id === annotation.resourceId; });
    if (entity) parts.push('对象：' + entity.name);
    if (resource) parts.push('资源：' + resource.name);
    return parts.join(' · ') || '场景批注';
  }

  function renderAnnotationResourceOptions() {
    const current = refs.annotationResourceSelect.value;
    const resources = scopedResources(Store.selected());
    refs.annotationResourceSelect.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '不关联资源';
    refs.annotationResourceSelect.appendChild(empty);
    resources.forEach(function (resource) {
      const option = document.createElement('option');
      option.value = resource.id;
      option.textContent = resource.name;
      refs.annotationResourceSelect.appendChild(option);
    });
    refs.annotationResourceSelect.value = resources.some(function (item) { return item.id === current; }) ? current : '';
  }

  function addAnnotationFromForm() {
    const text = refs.annotationTextInput.value.trim();
    if (!text) {
      setMessage('请输入批注内容', 'error');
      return;
    }
    const selectedMany = Store.selectedEntities();
    if (selectedMany.length > 1) {
      const resourceId = refs.annotationResourceSelect.value || null;
      const operations = selectedMany.map(function (entity) {
        return {
          op: 'createAnnotation',
          annotation: normalizeAnnotation({
            id: uid('ann'),
            title: text.split(/\n/)[0].slice(0, 28) || '批注',
            text: text,
            targetId: entity.id,
            resourceId: resourceId,
            x: entity.x + entity.w + 24,
            y: entity.y,
          }),
        };
      });
      Store.applyPatch({ reason: '新增集体批注', operations: operations });
      refs.annotationTextInput.value = '';
      return;
    }
    const selected = Store.selected();
    const cam = Store.project.editor.camera;
    const annotation = normalizeAnnotation({
      id: uid('ann'),
      title: text.split(/\n/)[0].slice(0, 28) || '批注',
      text: text,
      targetId: selected ? selected.id : null,
      resourceId: refs.annotationResourceSelect.value || null,
      x: selected ? selected.x + selected.w + 24 : cam.x,
      y: selected ? selected.y : cam.y,
    });
    Store.applyPatch({ reason: '新增批注', operations: [{ op: 'createAnnotation', annotation: annotation }] });
    refs.annotationTextInput.value = '';
  }

  function focusAnnotation(annotationId) {
    const annotation = Store.project.annotations.find(function (item) { return item.id === annotationId; });
    if (!annotation) return;
    const point = annotationPoint(annotation);
    Store.project.editor.camera.x = point.x;
    Store.project.editor.camera.y = point.y;
    if (annotation.targetId) {
      Store.project.editor.selectedId = annotation.targetId;
      Store.project.editor.selectedIds = [annotation.targetId];
    }
    Store.notify('focus-annotation');
    scheduleSave();
  }

  function deleteAnnotation(annotationId) {
    Store.applyPatch({ reason: '删除批注', operations: [{ op: 'deleteAnnotation', id: annotationId }] });
  }

  function bindCommands() {
    refs.planBtn.addEventListener('click', planPrompt);
    refs.applyPlanBtn.addEventListener('click', applyPlan);
    refs.copyContextBtn.addEventListener('click', copyContext);
    refs.addResourceBtn.addEventListener('click', addResourceFromForm);
    refs.importResourceBtn.addEventListener('click', function () { refs.resourceFileInput.click(); });
    refs.resourceFileInput.addEventListener('change', importResourceFiles);
    refs.addAnnotationBtn.addEventListener('click', addAnnotationFromForm);
    refs.runQuickCommandBtn.addEventListener('click', function () {
      refs.promptInput.value = refs.quickCommand.value;
      planPrompt();
      applyPlan();
      refs.quickCommand.value = '';
    });
    refs.quickCommand.addEventListener('keydown', function (event) { if (event.key === 'Enter') refs.runQuickCommandBtn.click(); });
    bindFloatingWindows();
    bindResourceImportInteractions();
  }

  function bindResourceImportInteractions() {
    window.addEventListener('paste', function (event) {
      if (isTyping()) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      let files = Array.from(clipboard.files || []);
      if (!files.length && clipboard.items) {
        files = Array.from(clipboard.items).map(function (item) { return item.kind === 'file' ? item.getAsFile() : null; }).filter(Boolean);
      }
      const selected = Store.selected();
      if (files.length) {
        event.preventDefault();
        importFilesToResourceScope(files, selected, selected ? '粘贴到对象资源' : '粘贴资源');
        return;
      }
      const text = clipboard.getData('text/plain');
      if (text && text.trim()) {
        event.preventDefault();
        createTextResource(text, selected, selected ? '粘贴对象文本资源' : '粘贴文本资源');
      }
    });
    [refs.canvas, refs.resourceWindow, refs.resourceList].forEach(function (target) {
      if (!target) return;
      target.addEventListener('dragover', allowResourceDrop);
    });
    refs.canvas.addEventListener('drop', handleCanvasResourceDrop);
    refs.resourceWindow.addEventListener('drop', handleResourcePanelDrop);
  }

  function allowResourceDrop(event) {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleCanvasResourceDrop(event) {
    event.preventDefault();
    const world = Renderer.toWorld(event.clientX, event.clientY);
    const hit = hitTest(world.x, world.y);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      importFilesToResourceScope(files, hit || null, hit ? '拖放到对象资源' : '拖放资源');
      return;
    }
    const resourceId = resourceIdFromDataTransfer(event.dataTransfer);
    if (resourceId && hit) {
      attachResourceToEntity(hit.id, resourceId, 'appearance', '从资源卡拖放到对象');
      selectEntityById(hit.id, '选择对象');
    }
  }

  function handleResourcePanelDrop(event) {
    event.preventDefault();
    const selected = Store.selected();
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      importFilesToResourceScope(files, selected, selected ? '拖放到对象资源板' : '拖放到资源库');
      return;
    }
    const resourceId = resourceIdFromDataTransfer(event.dataTransfer);
    if (resourceId && selected) attachResourceToEntity(selected.id, resourceId, 'appearance', '拖放到对象资源板');
  }

  function resourceIdFromDataTransfer(dataTransfer) {
    const text = dataTransfer && dataTransfer.getData('text/plain');
    const match = /^resource:(.+)$/.exec(String(text || ''));
    return match ? match[1] : '';
  }

  function planPrompt() {
    currentPlan = AI.plan(refs.promptInput.value);
    renderPlanOutput(currentPlan);
    if (currentPlan.ok) {
      const dry = Store.applyPatch(currentPlan.patch, { dryRun: true });
      if (!dry.ok) {
        currentPlan = { ok: false, error: dry.error };
        renderPlanOutput(currentPlan);
      }
    }
  }

  function applyPlan() {
    if (!currentPlan) planPrompt();
    if (!currentPlan || !currentPlan.ok) {
      setMessage(currentPlan && currentPlan.error ? currentPlan.error : '没有可应用的方案', 'error');
      return;
    }
    const planText = formatPlan(currentPlan);
    const result = Store.applyPatch(currentPlan.patch);
    setMessage(result.ok ? '已应用补丁' : result.error, result.ok ? 'info' : 'error');
    refs.planOutput.textContent = planText + '\n\n' + formatResult(result, currentPlan.patch);
  }

  function copyContext() {
    const text = JSON.stringify(AI.context(), null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { setMessage('已复制上下文'); });
    } else {
      refs.planOutput.textContent = text;
    }
  }

  function renderPlanOutput(plan) {
    refs.planOutput.textContent = formatPlan(plan);
  }

  function formatPlan(plan) {
    if (!plan) return '';
    if (!plan.ok) return '无法生成方案\n原因：' + (plan.error || '未知错误');
    const patch = plan.patch || {};
    const ops = Array.isArray(patch.operations) ? patch.operations : [];
    const lines = ['方案：' + (patch.reason || '未命名方案'), '操作数量：' + ops.length];
    if (ops.length) {
      lines.push('');
      ops.forEach(function (op, index) { lines.push((index + 1) + '. ' + describeOperation(op)); });
    }
    return lines.join('\n');
  }

  function formatResult(result, patch) {
    const ops = Array.isArray(patch && patch.operations) ? patch.operations : [];
    return '结果：' + (result.ok ? '成功，已执行 ' + (result.operations || ops.length) + ' 个操作' : '失败：' + result.error);
  }

  function describeOperation(op) {
    if (!op) return '空操作';
    if (op.op === 'createEntity') return opLabel(op.op) + '：' + typeLabel((op.entity || {}).type || op.template) + '「' + ((op.entity || {}).name || typeLabel(op.template)) + '」';
    if (op.op === 'updateEntity') return opLabel(op.op) + '：' + entityDisplayName(op.id) + describeSet(op.set);
    if (op.op === 'deleteEntity') return opLabel(op.op) + '：' + entityDisplayName(op.id);
    if (op.op === 'createEntityFolder') return opLabel(op.op) + '：「' + ((op.folder || {}).name || '文件夹') + '」';
    if (op.op === 'setScene') return opLabel(op.op) + describeSet(op.set);
    if (op.op === 'selectEntity') return opLabel(op.op) + '：' + (op.id ? entityDisplayName(op.id) : '取消选择');
    if (op.op === 'selectEntities') return opLabel(op.op) + '：' + ((op.ids || []).length || 0) + ' 个对象';
    if (op.op === 'createResource') return opLabel(op.op) + '：' + resourceTypeLabel((op.resource || {}).type) + '「' + ((op.resource || {}).name || '未命名资源') + '」';
    if (op.op === 'updateResource') return opLabel(op.op) + '：' + resourceDisplayName(op.id) + describeSet(op.set);
    if (op.op === 'deleteResource') return opLabel(op.op) + '：' + resourceDisplayName(op.id);
    if (op.op === 'attachResource') return opLabel(op.op) + '：' + resourceDisplayName(op.resourceId) + ' → ' + entityDisplayName(op.entityId) + '，' + resourceSlotLabel(op.slot);
    if (op.op === 'detachResource') return opLabel(op.op) + '：' + resourceDisplayName(op.resourceId);
    if (op.op === 'scheduleResourceUse') return opLabel(op.op) + '：' + resourceDisplayName(op.resourceId) + '，' + resourceTimingLabel((op.use || {}).trigger);
    if (op.op === 'createAnnotation') return opLabel(op.op) + '：「' + ((op.annotation || {}).title || '批注') + '」';
    if (op.op === 'deleteAnnotation') return opLabel(op.op) + '：' + annotationDisplayName(op.id);
    if (op.op === 'setWindow') return opLabel(op.op) + '：' + (WINDOW_LABELS[op.key] || op.key) + describeSet(op.set);
    return opLabel(op.op);
  }

  function describeSet(set) {
    const items = flattenSet(set || {});
    if (!items.length) return '';
    return '：' + items.map(function (item) { return item.path + ' = ' + item.value; }).join('，');
  }

  function flattenSet(source, prefix, out) {
    const list = out || [];
    Object.keys(source || {}).forEach(function (key) {
      const path = prefix ? prefix + '.' + key : key;
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) flattenSet(value, path, list);
      else list.push({ path: path, value: value });
    });
    return list;
  }

  function entityDisplayName(id) {
    const entity = Store.project.entities.find(function (item) { return item.id === id; });
    return entity ? '「' + entity.name + '」' : '「' + id + '」';
  }

  function resourceDisplayName(id) {
    const resource = Store.project.resources.find(function (item) { return item.id === id; });
    return resource ? '「' + resource.name + '」' : '「' + id + '」';
  }

  function annotationDisplayName(id) {
    const annotation = Store.project.annotations.find(function (item) { return item.id === id; });
    return annotation ? '「' + annotation.title + '」' : '「' + id + '」';
  }

  function buildAIManifest() {
    return {
      scene: clone(Store.project.scene),
      selectedId: Store.project.editor.selectedId,
      selectedIds: Store.project.editor.selectedIds || [],
      entityFolders: Store.project.entityFolders.map(function (folder) {
        return {
          id: folder.id,
          name: folder.name,
          entityIds: Store.project.entities.filter(function (entity) { return entity.folderId === folder.id; }).map(function (entity) { return entity.id; }),
        };
      }),
      entities: Store.project.entities.map(function (entity) {
        return {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          folderId: entity.folderId,
          position: { x: entity.x, y: entity.y, w: entity.w, h: entity.h, rotation: entity.rotation },
          description: entity.description,
          traits: entity.traits,
          resources: resourcesForEntity(entity).map(function (resource) { return resourceKnowledge(resource, entity.id); }),
          annotations: annotationsForEntity(entity.id).map(annotationKnowledge),
        };
      }),
      resources: Store.project.resources.map(function (resource) { return resourceKnowledge(resource); }),
      annotations: Store.project.annotations.map(annotationKnowledge),
      bindings: Store.project.entities.reduce(function (list, entity) {
        entity.resourceRefs.forEach(function (ref) {
          list.push({ entityId: entity.id, entityName: entity.name, resourceId: ref.resourceId, slot: ref.slot, note: ref.note, visualScale: ref.visualScale });
        });
        return list;
      }, []),
    };
  }

  function resourceKnowledge(resource, entityId) {
    return {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      tags: resource.tags,
      notes: resource.notes,
      color: resource.color,
      linkedEntityId: entityId || resource.linkedEntityId || null,
      intent: resource.intent,
      uses: resource.uses,
      annotations: annotationsForResource(resource.id).map(annotationKnowledge),
      hasImage: !!resourceImageSrc(resource),
    };
  }

  function annotationKnowledge(annotation) {
    return { id: annotation.id, title: annotation.title, text: annotation.text, targetId: annotation.targetId, resourceId: annotation.resourceId, position: { x: annotation.x, y: annotation.y } };
  }

  function annotationsForResource(resourceId) { return Store.project.annotations.filter(function (annotation) { return annotation.resourceId === resourceId; }); }
  function annotationsForEntity(entityId) { return Store.project.annotations.filter(function (annotation) { return annotation.targetId === entityId; }); }

  function resourcesForEntity(entity) {
    const ids = new Set((entity.resourceRefs || []).map(function (ref) { return ref.resourceId; }));
    Store.project.resources.forEach(function (resource) { if (resource.linkedEntityId === entity.id) ids.add(resource.id); });
    return Array.from(ids).map(function (id) { return Store.project.resources.find(function (resource) { return resource.id === id; }); }).filter(Boolean);
  }

  function resolveResourceFromPrompt(text, selected) {
    const lower = String(text || '').toLowerCase();
    const selectedResourceIds = new Set(selected ? (selected.resourceRefs || []).map(function (ref) { return ref.resourceId; }) : []);
    let best = null;
    let bestScore = 0;
    Store.project.resources.forEach(function (resource) {
      let score = 0;
      const haystack = resourceSearchText(resource).toLowerCase();
      if (resource.name && lower.includes(resource.name.toLowerCase())) score += 8;
      resource.tags.forEach(function (tag) { if (tag && lower.includes(String(tag).toLowerCase())) score += 4; });
      if (selectedResourceIds.has(resource.id) || (selected && resource.linkedEntityId === selected.id)) score += isResourcePrompt(text) ? 3 : 1;
      splitTerms(lower).forEach(function (word) { if (word.length > 2 && haystack.includes(word)) score += 1; });
      if (score > bestScore) {
        best = resource;
        bestScore = score;
      }
    });
    if (best) return best;
    if (selected) {
      const firstRef = (selected.resourceRefs || [])[0];
      if (firstRef && isResourcePrompt(text)) return Store.project.resources.find(function (resource) { return resource.id === firstRef.resourceId; }) || null;
    }
    if (Store.project.resources.length === 1 && isResourcePrompt(text)) return Store.project.resources[0];
    return null;
  }

  function isResourcePrompt(text) {
    return /(素材|资源|图片|图像|精灵|材质|设定|挂载|绑定|套用|应用|使用|生成|创建|触发|靠近|接触|asset|resource|place|spawn|attach|use|bind)/i.test(text);
  }

  function resourceSearchText(resource) {
    return [
      resource.name,
      resource.type,
      resource.tags.join(' '),
      resource.notes,
      resource.intent && resource.intent.instruction,
      resource.intent && resource.intent.placement,
      annotationsForResource(resource.id).map(function (annotation) { return annotation.title + ' ' + annotation.text; }).join(' '),
    ].filter(Boolean).join(' ');
  }

  function splitTerms(text) {
    return String(text || '').split(/[\s,，、。;；:_-]+/).map(function (part) { return part.trim().toLowerCase(); }).filter(Boolean);
  }

  function resourceUsePatch(resource, reason, options) {
    const opts = options || {};
    const text = String(reason || '').trim();
    const selected = Store.selected();
    const linked = resource.linkedEntityId && Store.project.entities.find(function (entity) { return entity.id === resource.linkedEntityId; });
    const target = selected || linked || null;
    const wantsAttach = /(挂载|绑定|贴到|套用|应用|赋予|attach|bind)/i.test(text);
    const wantsCreate = opts.forceCreate || /(生成|创建|实例|放入|spawn|place|create|use|使用)/i.test(text) && !wantsAttach;
    const ops = [];
    let entityForUse = target;
    if (target && (wantsAttach || !wantsCreate)) {
      ops.push({ op: 'attachResource', entityId: target.id, resourceId: resource.id, slot: resourceSlotForResource(resource), note: resource.intent.instruction || resource.notes || text, intent: inferResourceIntent(resource, text, target) });
    }
    if (wantsCreate || !entityForUse) {
      const entity = entityFromResource(resource, text);
      entityForUse = entity;
      ops.push({ op: 'createEntity', template: entity.type, entity: entity });
      ops.push({ op: 'attachResource', entityId: entity.id, resourceId: resource.id, slot: resourceSlotForResource(resource), note: '由 AI 根据素材和批注放入场景', intent: inferResourceIntent(resource, text, entity) });
    }
    ops.push({ op: 'scheduleResourceUse', resourceId: resource.id, use: inferResourceUse(resource, text, entityForUse), intent: inferResourceIntent(resource, text, entityForUse) });
    ops.push({ op: 'setWindow', key: 'resources', set: { open: true } });
    return { id: uid('patch'), reason: text || '使用资源：' + resource.name, operations: ops };
  }

  function resourceSlotForResource(resource) {
    if (resource.type === 'animation') return 'movementAnimation';
    if (resource.type === 'material') return 'material';
    if (resource.type === 'audio') return 'audio';
    if (resource.type === 'script') return 'script';
    if (resource.type === 'note') return 'lore';
    const text = resourceSearchText(resource);
    if (/(行为|技能|移动|攻击|爬墙|飞扑|ai|脚本)/i.test(text)) return 'behavior';
    return 'appearance';
  }

  function inferResourceIntent(resource, text, entity) {
    const trigger = inferResourceTrigger(text);
    return {
      role: resourceSlotForResource(resource),
      usage: /(触发|靠近|接触|收集|开场|某时|trigger)/i.test(text) ? 'trigger' : (entity ? 'attach' : 'place'),
      timing: trigger,
      placement: inferResourcePlacementText(text, entity),
      instruction: (text || resource.intent.instruction || resource.notes || '').slice(0, 480),
    };
  }

  function inferResourceUse(resource, text, entity) {
    const point = entity ? { x: entity.x, y: entity.y } : fallbackResourcePoint(resource);
    return {
      id: uid('use'),
      resourceId: resource.id,
      entityId: entity ? entity.id : null,
      trigger: inferResourceTrigger(text),
      placement: inferResourcePlacementText(text, entity),
      note: (text || resource.intent.instruction || resource.notes || '资源使用计划').slice(0, 600),
      x: point.x,
      y: point.y,
      createdAt: nowIso(),
    };
  }

  function inferResourceTrigger(text) {
    if (/(开场|开始|加载|on start|onStart)/i.test(text)) return 'onStart';
    if (/(靠近|接近|范围|approach)/i.test(text)) return 'onApproach';
    if (/(碰到|接触|撞到|contact|touch)/i.test(text)) return 'onContact';
    if (/(收集|拾取|collect)/i.test(text)) return 'onCollect';
    if (/(触发|进入区域|trigger)/i.test(text)) return 'onTrigger';
    if (/(手动|manual)/i.test(text)) return 'manual';
    return 'immediate';
  }

  function inferResourcePlacementText(text, entity) {
    if (/(左边|左侧|left)/i.test(text)) return entity ? entity.name + ' 左侧' : '画布左侧';
    if (/(右边|右侧|right)/i.test(text)) return entity ? entity.name + ' 右侧' : '画布右侧';
    if (/(上方|上面|顶部|天花板|above|top)/i.test(text)) return entity ? entity.name + ' 上方' : '画布上方';
    if (/(下方|下面|底部|below|bottom)/i.test(text)) return entity ? entity.name + ' 下方' : '画布下方';
    if (/(墙|墙面|wall)/i.test(text)) return '墙面或垂直边界';
    if (/(这里|当前位置|当前|选中|this|selected)/i.test(text)) return entity ? entity.name : '当前画布中心';
    return entity ? entity.name : '当前画布中心';
  }

  function entityFromResource(resource, text) {
    const template = inferEntityTemplateFromResource(resource, text);
    const entity = defaultEntity(template, 0, 0);
    entity.name = cleanResourceEntityName(resource.name, template);
    entity.color = resource.color;
    entity.description = resourceDescription(resource, template);
    entity.traits = traitsFromResource(resource, template);
    if (template === 'text') entity.text = entity.name;
    entity.resourceRefs = [normalizeResourceRef({ resourceId: resource.id, slot: resourceSlotForResource(resource), note: resource.intent.instruction || resource.notes || '由资源生成' })];
    placeEntityFromPrompt(entity, text, resource);
    return normalizeEntity(entity);
  }

  function inferEntityTemplateFromResource(resource, text) {
    const source = (text + ' ' + resourceSearchText(resource)).toLowerCase();
    if (/(玩家|主角|player|hero)/i.test(source)) return 'player';
    if (/(平台|地面|墙|platform|ground|floor|wall)/i.test(source)) return 'platform';
    if (/(金币|奖励|收集|coin|collectible|reward)/i.test(source)) return 'coin';
    if (/(敌|怪|野怪|蜘蛛|enemy|monster|spider|hazard)/i.test(source)) return 'enemy';
    if (/(文字|标题|文本|text|title)/i.test(source)) return 'text';
    if (/(区域|触发区|zone|trigger)/i.test(source)) return 'zone';
    if (resource.type === 'material') return 'platform';
    return resource.type === 'note' ? 'text' : 'box';
  }

  function cleanResourceEntityName(name, template) {
    return String(name || '').replace(/(资源|素材|设定|贴图|图片|sprite|asset)$/i, '').trim() || typeLabel(template);
  }

  function resourceDescription(resource, template) {
    const notes = resource.notes || resource.intent.instruction || '';
    const annotations = annotationsForResource(resource.id).map(function (annotation) { return annotation.text; }).filter(Boolean).join(' ');
    return (notes + (annotations ? ' ' + annotations : '') || defaultDescription(template)).slice(0, 500);
  }

  function traitsFromResource(resource, template) {
    const text = resourceDescription(resource, template);
    const picked = text.split(/[。；;.!?\n]+/).map(function (part) { return part.trim(); })
      .filter(function (part) { return /^(可以|会|用于|适合|能够|能|当|在)/.test(part) || /(爬墙|飞扑|追击|触发|收集|伤害|平台|材质)/.test(part); })
      .slice(0, 8);
    return normalizeTraits(defaultTraits(template).concat(picked), template).slice(0, 12);
  }

  function placeEntityFromPrompt(entity, text, resource) {
    const selected = Store.selected();
    const linked = resource.linkedEntityId && Store.project.entities.find(function (item) { return item.id === resource.linkedEntityId; });
    const anchor = selected || linked;
    if (anchor) {
      entity.x = anchor.x + anchor.w + 32;
      entity.y = anchor.y;
      if (/(左边|左侧|left)/i.test(text)) entity.x = anchor.x - entity.w - 32;
      else if (/(右边|右侧|right)/i.test(text)) entity.x = anchor.x + anchor.w + 32;
      else if (/(上方|上面|顶部|天花板|above|top)/i.test(text)) entity.y = anchor.y - entity.h - 32;
      else if (/(下方|下面|底部|below|bottom)/i.test(text)) entity.y = anchor.y + anchor.h + 32;
      else if (/(贴到|挂到|套用|应用)/i.test(text)) { entity.x = anchor.x; entity.y = anchor.y; }
      return;
    }
    const point = fallbackResourcePoint(resource);
    entity.x = point.x;
    entity.y = point.y;
  }

  function fallbackResourcePoint(resource) {
    const annotation = annotationsForResource(resource.id)[0];
    if (annotation) return { x: annotation.x, y: annotation.y };
    const cam = Store.project.editor.camera;
    return { x: cam.x - 40, y: cam.y - 40 };
  }

  const AI = {
    context: function () {
      return {
        engine: {
          name: 'WebHachimi Engine',
          version: PROJECT_VERSION,
          patchOps: Object.keys(OP_LABELS),
        },
        selectedId: Store.project.editor.selectedId,
        selected: Store.selected(),
        manifest: buildAIManifest(),
        project: Store.project,
      };
    },

    plan: function (prompt) {
      const text = String(prompt || '').trim();
      if (!text) return { ok: false, error: '请输入需求' };
      const ops = [];
      const selected = Store.selected();
      const resource = resolveResourceFromPrompt(text, selected);
      if (resource && isResourcePrompt(text)) return { ok: true, patch: resourceUsePatch(resource, text) };
      if (/(平台|platformer|横版|关卡|level)/i.test(text)) return { ok: true, patch: platformerPatch(text) };
      if (/(哈基米蜘蛛|哈吉米蜘蛛|蜘蛛|spider)/i.test(text)) return { ok: true, patch: spiderPatch(text) };
      if (/(清空|重置场景|reset scene|empty)/i.test(text)) {
        return {
          ok: true,
          patch: {
            id: uid('patch'),
            reason: '重置场景',
            operations: [{ op: 'setScene', set: { name: '主场景', background: '#151515' } }]
              .concat(Store.project.entities.map(function (entity) { return { op: 'deleteEntity', id: entity.id }; })),
          },
        };
      }
      if (/(player|玩家|主角)/i.test(text)) ops.push({ op: 'createEntity', template: 'player', entity: defaultEntity('player', -180, 80) });
      if (/(platform|地面|平台)/i.test(text)) ops.push({ op: 'createEntity', template: 'platform', entity: defaultEntity('platform', 0, 220) });
      if (/(coin|金币|奖励)/i.test(text)) {
        for (let i = 0; i < 4; i += 1) ops.push({ op: 'createEntity', template: 'coin', entity: defaultEntity('coin', -150 + i * 90, 70 - i * 30) });
      }
      if (/(enemy|敌人|怪)/i.test(text)) ops.push({ op: 'createEntity', template: 'enemy', entity: defaultEntity('enemy', 250, 170) });
      if (/(text|标题|文字)/i.test(text)) {
        const entity = defaultEntity('text', -220, -240);
        entity.text = text.replace(/.*(?:标题|text)[:：]?\s*/i, '').slice(0, 40) || '新游戏';
        ops.push({ op: 'createEntity', template: 'text', entity: entity });
      }
      if (selected) {
        const set = {};
        if (/(red|红)/i.test(text)) set.color = '#ef6666';
        if (/(green|绿)/i.test(text)) set.color = '#42c89f';
        if (/(blue|蓝)/i.test(text)) set.color = '#68a7ff';
        if (/(yellow|gold|黄|金)/i.test(text)) set.color = '#e6b84a';
        if (/(大|larger|bigger)/i.test(text)) { set.w = Math.round(selected.w * 1.25); set.h = Math.round(selected.h * 1.25); }
        if (/(小|smaller)/i.test(text)) { set.w = Math.round(selected.w * 0.8); set.h = Math.round(selected.h * 0.8); }
        if (/(快|faster|speed)/i.test(text)) set.tuning = { speed: selected.tuning.speed + 120 };
        if (/(慢|slower)/i.test(text)) set.tuning = { speed: Math.max(0, selected.tuning.speed - 120) };
        if (/(爬墙|飞扑)/i.test(text)) {
          const traits = selected.traits.slice();
          if (/爬墙/i.test(text) && !traits.includes('可以爬墙')) traits.push('可以爬墙');
          if (/飞扑/i.test(text) && !traits.includes('可以飞扑')) traits.push('可以飞扑');
          set.traits = traits.slice(0, 12);
        }
        if (Object.keys(set).length) ops.push({ op: 'updateEntity', id: selected.id, set: set });
      }
      if (!ops.length) return { ok: false, error: '请先选择对象，或把要生成的内容说得更具体一点。' };
      return { ok: true, patch: { id: uid('patch'), reason: text, operations: ops } };
    },
  };

  function platformerPatch(reason) {
    const ops = [];
    Store.project.entities.forEach(function (entity) { ops.push({ op: 'deleteEntity', id: entity.id }); });
    ops.push({ op: 'setScene', set: { name: '平台冲刺', background: '#141513', gravity: 1600 } });
    ops.push({ op: 'createEntity', template: 'player', entity: defaultEntity('player', -560, 190) });
    [[-500, 280, 520, 36], [120, 190, 220, 32], [430, 90, 260, 32], [-240, 40, 220, 32], [0, -120, 180, 30]].forEach(function (p, i) {
      const e = defaultEntity('platform', p[0], p[1]);
      e.w = p[2];
      e.h = p[3];
      e.name = '平台 ' + (i + 1);
      ops.push({ op: 'createEntity', template: 'platform', entity: e });
    });
    [-200, 120, 430, 0, 0].forEach(function (x, i) {
      const e = defaultEntity('coin', x, i < 3 ? 115 - i * 45 : -180);
      e.name = '金币 ' + (i + 1);
      ops.push({ op: 'createEntity', template: 'coin', entity: e });
    });
    const enemy = defaultEntity('enemy', 470, 34);
    enemy.name = '巡逻敌人';
    ops.push({ op: 'createEntity', template: 'enemy', entity: enemy });
    const title = defaultEntity('text', -560, -250);
    title.text = '平台冲刺';
    title.color = '#f3f1ea';
    ops.push({ op: 'createEntity', template: 'text', entity: title });
    return { id: uid('patch'), reason: reason || '创建横版平台关卡', operations: ops };
  }

  function spiderPatch(reason) {
    const spider = defaultEntity('enemy', 220, 120);
    spider.name = '哈基米蜘蛛';
    spider.color = '#ef6666';
    spider.description = '高机动野怪，适合放在墙面、天花板或狭窄通道制造突然袭击。';
    spider.traits = ['可以爬墙', '可以飞扑', '贴着墙面追踪玩家', '靠近时进入攻击预备'];
    spider.tuning.speed = 210;
    const resource = normalizeResource({
      id: uid('res'),
      name: '哈基米蜘蛛资源',
      type: 'sprite',
      color: spider.color,
      tags: ['野怪', '蜘蛛', '机动'],
      notes: '记录哈基米蜘蛛的造型、动作和技能设定。',
      linkedEntityId: spider.id,
      intent: { role: 'behavior', usage: 'spawn', timing: 'onApproach', placement: '墙面、天花板或狭窄通道', instruction: 'AI 可以根据批注把它作为高机动野怪放入场景。' },
    });
    const annotation = normalizeAnnotation({
      id: uid('ann'),
      title: '哈基米蜘蛛特性',
      text: '可以爬墙，可以飞扑。适合从墙面或天花板切入玩家路线。',
      targetId: spider.id,
      resourceId: resource.id,
      x: spider.x + spider.w + 24,
      y: spider.y,
    });
    return {
      id: uid('patch'),
      reason: reason || '创建哈基米蜘蛛',
      operations: [
        { op: 'createEntity', template: 'enemy', entity: spider },
        { op: 'createResource', resource: resource },
        { op: 'createAnnotation', annotation: annotation },
        { op: 'setWindow', key: 'resources', set: { open: true } },
        { op: 'setWindow', key: 'annotations', set: { open: true } },
      ],
    };
  }

  function bindFloatingWindows() {
    windowKeys().forEach(function (key) {
      const element = windowElement(key);
      if (!element) return;
      element.addEventListener('pointerdown', startWindowResize, true);
      element.addEventListener('pointermove', updateWindowResizeCursor);
      element.addEventListener('pointerleave', resetWindowResizeCursor);
    });
    document.querySelectorAll('[data-window-handle]').forEach(function (handle) { handle.addEventListener('pointerdown', startWindowDrag); });
    document.querySelectorAll('[data-window-close]').forEach(function (button) {
      button.addEventListener('click', function () { setWindowOpen(button.dataset.windowClose, false); });
    });
    document.querySelectorAll('[data-window-minimize]').forEach(function (button) {
      button.addEventListener('click', function () { toggleWindowCollapse(button.dataset.windowMinimize); });
    });
    window.addEventListener('pointermove', moveWindowDrag);
    window.addEventListener('pointerup', endWindowDrag);
    window.addEventListener('pointermove', moveWindowResize);
    window.addEventListener('pointerup', endWindowResize);
    window.addEventListener('resize', function () {
      reflowDockedWindows();
      Object.keys(Store.project.windows).forEach(function (key) { keepWindowInBounds(key); });
      renderWindows();
    });
  }

  function windowKeys() { return Object.keys(WINDOW_DEFAULTS); }

  function renderWindows() {
    if (!activeWindowDrag && !activeWindowResize) reflowDockedWindows();
    else applyDockLayout();
    windowKeys().forEach(function (key) { applyWindowStyle(key, windowElement(key)); });
    renderWindowManager();
    if (refs.canvas) requestAnimationFrame(function () { Renderer.resize(); });
  }

  function applyWindowStyle(key, element) {
    const state = Store.project.windows[key];
    if (!state || !element) return;
    element.classList.toggle('is-hidden', state.open === false);
    element.classList.toggle('is-docked', isDockEdge(state.snap));
    element.classList.toggle('is-collapsed', state.collapsed === true);
    element.style.left = state.x + 'px';
    element.style.top = state.y + 'px';
    element.style.width = state.w + 'px';
    element.style.height = state.h + 'px';
    element.style.zIndex = state.z;
  }

  function renderWindowManager() {
    refs.windowManagerMenu.innerHTML = '';
    windowKeys().forEach(function (key) {
      const state = Store.project.windows[key];
      const row = document.createElement('div');
      row.className = 'window-manager-row';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'window-manager-name';
      openBtn.textContent = WINDOW_LABELS[key];
      openBtn.dataset.state = state.open === false ? 'closed' : (state.collapsed ? 'minimized' : 'open');
      openBtn.addEventListener('click', function () {
        setWindowOpen(key, true);
        refs.windowManagerMenu.classList.add('is-hidden');
      });
      const minBtn = document.createElement('button');
      minBtn.type = 'button';
      minBtn.textContent = '−';
      minBtn.disabled = state.open === false;
      minBtn.addEventListener('click', function (event) { event.stopPropagation(); toggleWindowCollapse(key); });
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', function (event) { event.stopPropagation(); setWindowOpen(key, false); });
      row.append(openBtn, minBtn, closeBtn);
      refs.windowManagerMenu.appendChild(row);
    });
  }

  function toggleWindowManager() {
    renderWindowManager();
    refs.windowManagerMenu.classList.toggle('is-hidden');
  }

  function toggleWindow(key) {
    const state = Store.project.windows[key];
    if (!state) return;
    state.open = !state.open;
    if (state.open) {
      state.collapsed = false;
      state.z = nextWindowZ();
    }
    keepWindowInBounds(key);
    Store.notify('window-toggle');
    scheduleSave();
  }

  function setWindowOpen(key, open) {
    const state = Store.project.windows[key];
    if (!state) return;
    state.open = open;
    if (open) {
      state.collapsed = false;
      state.z = nextWindowZ();
    }
    Store.notify('window-open');
    scheduleSave();
  }

  function toggleWindowCollapse(key) {
    const state = Store.project.windows[key];
    if (!state) return;
    state.collapsed = !state.collapsed;
    if (!state.collapsed) state.z = nextWindowZ();
    Store.notify('window-collapse');
    scheduleSave();
  }

  function resetWindows() {
    Store.project.windows = defaultWindows();
    Store.notify('window-reset');
    scheduleSave();
  }

  function startWindowResize(event) {
    if (event.button !== 0) return;
    if (event.target && event.target.closest('button,input,select,textarea')) return;
    const element = event.currentTarget;
    const key = element && element.dataset.window;
    const state = key && Store.project.windows[key];
    if (!state || state.collapsed || state.open === false) return;
    const edge = resizeEdgeForEvent(event, element);
    if (!edge) return;
    event.preventDefault();
    event.stopPropagation();
    state.z = nextWindowZ();
    state.snap = '';
    activeWindowResize = {
      key: key,
      pointerId: event.pointerId,
      edge: edge,
      startX: event.clientX,
      startY: event.clientY,
      x: state.x,
      y: state.y,
      w: state.w,
      h: state.h,
    };
    element.style.cursor = cursorForResizeEdge(edge);
    try { element.setPointerCapture(event.pointerId); } catch (error) {}
    reflowDockedWindows();
    Store.notify('window-resize-start');
  }

  function moveWindowResize(event) {
    if (!activeWindowResize || event.pointerId !== activeWindowResize.pointerId) return;
    const state = Store.project.windows[activeWindowResize.key];
    const bounds = layerBounds();
    if (!state || !bounds.valid) return;
    const dx = event.clientX - activeWindowResize.startX;
    const dy = event.clientY - activeWindowResize.startY;
    let x = activeWindowResize.x;
    let y = activeWindowResize.y;
    let w = activeWindowResize.w;
    let h = activeWindowResize.h;
    const edge = activeWindowResize.edge;
    if (edge.includes('right')) w = activeWindowResize.w + dx;
    if (edge.includes('bottom')) h = activeWindowResize.h + dy;
    if (edge.includes('left')) {
      x = activeWindowResize.x + dx;
      w = activeWindowResize.w - dx;
    }
    if (edge.includes('top')) {
      y = activeWindowResize.y + dy;
      h = activeWindowResize.h - dy;
    }
    if (w < MIN_WINDOW_W) {
      if (edge.includes('left')) x -= MIN_WINDOW_W - w;
      w = MIN_WINDOW_W;
    }
    if (h < MIN_WINDOW_H) {
      if (edge.includes('top')) y -= MIN_WINDOW_H - h;
      h = MIN_WINDOW_H;
    }
    if (x < SNAP_GAP) {
      w -= SNAP_GAP - x;
      x = SNAP_GAP;
    }
    if (y < SNAP_GAP) {
      h -= SNAP_GAP - y;
      y = SNAP_GAP;
    }
    if (x + w > bounds.width - SNAP_GAP) w = bounds.width - SNAP_GAP - x;
    if (y + h > bounds.height - SNAP_GAP) h = bounds.height - SNAP_GAP - y;
    state.x = Math.round(x);
    state.y = Math.round(y);
    state.w = Math.round(Math.max(MIN_WINDOW_W, w));
    state.h = Math.round(Math.max(MIN_WINDOW_H, h));
    renderWindows();
  }

  function endWindowResize(event) {
    if (!activeWindowResize || event.pointerId !== activeWindowResize.pointerId) return;
    const element = windowElement(activeWindowResize.key);
    if (element) element.style.cursor = '';
    activeWindowResize = null;
    Store.notify('window-resize-end');
    scheduleSave();
  }

  function updateWindowResizeCursor(event) {
    if (activeWindowDrag || activeWindowResize) return;
    if (event.target && event.target.closest('button,input,select,textarea')) {
      event.currentTarget.style.cursor = '';
      return;
    }
    event.currentTarget.style.cursor = cursorForResizeEdge(resizeEdgeForEvent(event, event.currentTarget));
  }

  function resetWindowResizeCursor(event) {
    if (!activeWindowResize) event.currentTarget.style.cursor = '';
  }

  function resizeEdgeForEvent(event, element) {
    const rect = element.getBoundingClientRect();
    const left = event.clientX - rect.left <= RESIZE_EDGE_SIZE;
    const right = rect.right - event.clientX <= RESIZE_EDGE_SIZE;
    const top = event.clientY - rect.top <= RESIZE_EDGE_SIZE;
    const bottom = rect.bottom - event.clientY <= RESIZE_EDGE_SIZE;
    if (top && left) return 'top-left';
    if (top && right) return 'top-right';
    if (bottom && left) return 'bottom-left';
    if (bottom && right) return 'bottom-right';
    if (left) return 'left';
    if (right) return 'right';
    if (top) return 'top';
    if (bottom) return 'bottom';
    return '';
  }

  function cursorForResizeEdge(edge) {
    if (edge === 'top-left' || edge === 'bottom-right') return 'nwse-resize';
    if (edge === 'top-right' || edge === 'bottom-left') return 'nesw-resize';
    if (edge === 'left' || edge === 'right') return 'ew-resize';
    if (edge === 'top' || edge === 'bottom') return 'ns-resize';
    return '';
  }

  function startWindowDrag(event) {
    if (event.button !== 0) return;
    if (event.target && event.target.closest('button')) return;
    const key = event.currentTarget.dataset.windowHandle;
    const state = Store.project.windows[key];
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    state.z = nextWindowZ();
    state.snap = '';
    activeWindowDrag = { key: key, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: state.x, y: state.y, collapsed: state.collapsed === true };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) {}
    reflowDockedWindows();
    Store.notify('window-drag-start');
  }

  function moveWindowDrag(event) {
    if (!activeWindowDrag || event.pointerId !== activeWindowDrag.pointerId) return;
    const state = Store.project.windows[activeWindowDrag.key];
    const bounds = layerBounds();
    const dragHeight = activeWindowDrag.collapsed ? 42 : state.h;
    state.x = clampWindowAxis(activeWindowDrag.x + event.clientX - activeWindowDrag.startX, state.w, bounds.width);
    state.y = clampWindowAxis(activeWindowDrag.y + event.clientY - activeWindowDrag.startY, dragHeight, bounds.height);
    activeWindowDrag.edge = activeWindowDrag.collapsed ? '' : edgeIntentAt(event);
    showDockPreview(activeWindowDrag.edge, activeWindowDrag.key);
    renderWindows();
  }

  function endWindowDrag(event) {
    if (!activeWindowDrag || event.pointerId !== activeWindowDrag.pointerId) return;
    const key = activeWindowDrag.key;
    const edge = activeWindowDrag.edge;
    activeWindowDrag = null;
    clearDockPreview();
    if (edge) dockWindowToEdge(key, edge);
    else keepWindowInBounds(key);
    Store.notify('window-drag-end');
    scheduleSave();
  }

  function edgeIntentAt(event) {
    const rect = refs.windowLayer.getBoundingClientRect();
    const bounds = layerBounds();
    if (!bounds.valid) return '';
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x <= EDGE_DOCK_RANGE) return 'left';
    if (bounds.width - x <= EDGE_DOCK_RANGE) return 'right';
    if (y <= EDGE_DOCK_RANGE) return 'top';
    if (bounds.height - y <= EDGE_DOCK_RANGE) return 'bottom';
    return '';
  }

  function ensureDockPreview() {
    if (refs.dockPreview) return refs.dockPreview;
    const preview = document.createElement('div');
    preview.className = 'dock-preview is-hidden';
    refs.windowLayer.appendChild(preview);
    refs.dockPreview = preview;
    return preview;
  }

  function showDockPreview(edge, key) {
    const preview = ensureDockPreview();
    if (!edge) {
      clearDockPreview();
      return;
    }
    const bounds = layerBounds();
    const layout = dockLayoutFrames(bounds, edge);
    const rects = dockRectsForEdge(edge, bounds, dockedWindowKeys(edge, key), layout.frames[edge]);
    const rect = rects[key];
    if (!rect) {
      clearDockPreview();
      return;
    }
    preview.className = 'dock-preview';
    preview.style.left = Math.round(rect.x) + 'px';
    preview.style.top = Math.round(rect.y) + 'px';
    preview.style.width = Math.round(rect.w) + 'px';
    preview.style.height = Math.round(rect.h) + 'px';
  }

  function clearDockPreview() {
    if (!refs.dockPreview) return;
    refs.dockPreview.className = 'dock-preview is-hidden';
  }

  function dockWindowToEdge(key, edge) {
    const state = Store.project.windows[key];
    if (!state || !isDockEdge(edge)) return false;
    state.snap = edge;
    state.open = true;
    state.collapsed = false;
    state.z = nextWindowZ();
    reflowDockedWindows();
    Store.notify('window-dock');
    scheduleSave();
    return true;
  }

  function dockedWindowKeys(edge, extraKey) {
    const seen = new Set();
    const keys = windowKeys().filter(function (key) {
      const state = Store.project.windows[key];
      return state && state.open !== false && !state.collapsed && state.snap === edge;
    });
    if (extraKey && Store.project.windows[extraKey] && !keys.includes(extraKey)) keys.push(extraKey);
    return keys.filter(function (key) {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function (a, b) {
      return (Store.project.windows[a].z || 0) - (Store.project.windows[b].z || 0);
    });
  }

  function dockRectsForEdge(edge, bounds, keys, frame) {
    if (!bounds.valid || !keys.length || !isDockEdge(edge)) return {};
    const area = frame || { x: SNAP_GAP, y: SNAP_GAP, w: Math.max(0, bounds.width - SNAP_GAP * 2), h: Math.max(0, bounds.height - SNAP_GAP * 2) };
    const maxW = Math.max(1, area.w);
    const maxH = Math.max(1, area.h);
    const sideW = clamp(Math.round(bounds.width * 0.31), Math.min(290, maxW), Math.min(460, maxW));
    const bandH = clamp(Math.round(bounds.height * 0.34), Math.min(220, maxH), Math.min(360, maxH));
    const rects = {};
    if (edge === 'left' || edge === 'right') {
      const totalGap = DOCK_SPLIT_GAP * Math.max(0, keys.length - 1);
      const slotH = Math.max(60, Math.floor((maxH - totalGap) / keys.length));
      keys.forEach(function (key, index) {
        const y = area.y + index * (slotH + DOCK_SPLIT_GAP);
        const h = index === keys.length - 1 ? Math.max(60, area.y + maxH - y) : slotH;
        rects[key] = {
          x: edge === 'left' ? area.x : Math.max(area.x, area.x + area.w - sideW),
          y: y,
          w: sideW,
          h: h,
        };
      });
      return rects;
    }
    const totalGap = DOCK_SPLIT_GAP * Math.max(0, keys.length - 1);
    const slotW = Math.max(120, Math.floor((maxW - totalGap) / keys.length));
    keys.forEach(function (key, index) {
      const x = area.x + index * (slotW + DOCK_SPLIT_GAP);
      const w = index === keys.length - 1 ? Math.max(120, area.x + maxW - x) : slotW;
      rects[key] = {
        x: x,
        y: edge === 'top' ? area.y : Math.max(area.y, area.y + area.h - bandH),
        w: w,
        h: bandH,
      };
    });
    return rects;
  }

  function reflowDockedWindows() {
    const bounds = layerBounds();
    const layout = dockLayoutFrames(bounds);
    ['left', 'right', 'top', 'bottom'].forEach(function (edge) {
      assignDockRects(edge, dockRectsForEdge(edge, bounds, dockedWindowKeys(edge), layout.frames[edge]));
    });
    applyDockLayout();
  }

  function assignDockRects(edge, rects) {
    dockedWindowKeys(edge).forEach(function (key) {
      if (rects[key]) Object.assign(Store.project.windows[key], rects[key]);
    });
  }

  function dockLayoutFrames(bounds, previewEdge) {
    const base = { x: SNAP_GAP, y: SNAP_GAP, w: Math.max(0, bounds.width - SNAP_GAP * 2), h: Math.max(0, bounds.height - SNAP_GAP * 2) };
    const leftW = (dockedWindowKeys('left').length || previewEdge === 'left') ? dockSideWidth(bounds, base) : 0;
    const rightW = (dockedWindowKeys('right').length || previewEdge === 'right') ? dockSideWidth(bounds, base) : 0;
    const innerX = base.x + leftW;
    const innerW = Math.max(0, base.w - leftW - rightW);
    const topH = (dockedWindowKeys('top').length || previewEdge === 'top') ? dockBandHeight(bounds, { x: innerX, y: base.y, w: innerW, h: base.h }) : 0;
    const bottomH = (dockedWindowKeys('bottom').length || previewEdge === 'bottom') ? dockBandHeight(bounds, { x: innerX, y: base.y, w: innerW, h: base.h }) : 0;
    const sideY = base.y + topH;
    const sideH = Math.max(0, base.h - topH - bottomH);
    return {
      reserves: { left: leftW, right: rightW, top: topH, bottom: bottomH },
      frames: {
        left: { x: base.x, y: sideY, w: leftW, h: sideH },
        right: { x: Math.max(base.x, base.x + base.w - rightW), y: sideY, w: rightW, h: sideH },
        top: { x: innerX, y: base.y, w: innerW, h: topH },
        bottom: { x: innerX, y: Math.max(base.y, base.y + base.h - bottomH), w: innerW, h: bottomH },
      },
    };
  }

  function dockSideWidth(bounds, area) {
    if (!bounds.valid || !area.w) return 0;
    return clamp(Math.round(bounds.width * 0.31), Math.min(290, area.w), Math.min(460, area.w));
  }

  function dockBandHeight(bounds, area) {
    if (!bounds.valid || !area.h) return 0;
    return clamp(Math.round(bounds.height * 0.34), Math.min(220, area.h), Math.min(360, area.h));
  }

  function keepWindowInBounds(key) {
    const state = Store.project.windows[key];
    const bounds = layerBounds();
    if (!state || !bounds.valid) return;
    state.x = clampWindowAxis(state.x, state.w, bounds.width);
    state.y = clampWindowAxis(state.y, state.collapsed ? 42 : state.h, bounds.height);
  }

  function windowElement(key) {
    if (key === 'objects') return refs.objectsWindow;
    if (key === 'properties') return refs.propertiesWindow;
    if (key === 'resources') return refs.resourceWindow;
    if (key === 'annotations') return refs.annotationWindow;
    return null;
  }

  function layerBounds() {
    const rect = refs.windowLayer.getBoundingClientRect();
    return { width: Math.max(0, rect.width), height: Math.max(0, rect.height), valid: rect.width >= 320 && rect.height >= 240 };
  }

  function clampWindowAxis(value, size, axisSize) {
    if (axisSize < 320 || size + SNAP_GAP * 2 > axisSize) return value;
    return clamp(value, SNAP_GAP, Math.max(SNAP_GAP, axisSize - size - SNAP_GAP));
  }

  function nextWindowZ() {
    return windowKeys().reduce(function (max, key) { return Math.max(max, Store.project.windows[key].z || 1); }, 1) + 1;
  }

  function applyDockLayout() {
    const layout = dockLayoutFrames(layerBounds());
    const reserves = layout.reserves;
    refs.appShell.style.setProperty('--dock-left', reserves.left + 'px');
    refs.appShell.style.setProperty('--dock-right', reserves.right + 'px');
    refs.appShell.style.setProperty('--dock-top', reserves.top + 'px');
    refs.appShell.style.setProperty('--dock-bottom', reserves.bottom + 'px');
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify(Store.project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webhachimi-project.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importProject(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        Store.replace(JSON.parse(String(reader.result || '{}')), '导入项目');
        setMessage('项目已导入');
      } catch (error) {
        setMessage(error.message, 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  async function detectServer() {
    if (location.protocol === 'file:') return false;
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const json = await res.json();
      return !!(json && json.ok && json.app === 'webhachimi-engine');
    } catch (error) {
      return false;
    }
  }

  async function loadServerProject() {
    const res = await fetch('/api/project', { cache: 'no-store' });
    if (!res.ok) throw new Error('GET /api/project ' + res.status);
    return await res.json();
  }

  async function saveServerProject(project) {
    const res = await fetch('/api/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: project }),
    });
    if (!res.ok) throw new Error('POST /api/project ' + res.status);
    return await res.json();
  }

  async function forceReloadFromDisk() {
    if (reloadInFlight) return;
    reloadInFlight = true;
    setMessage(Store.server ? '正在从磁盘重新载入' : '正在重新载入本地缓存');
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      if (Store.server) {
        const res = await loadServerProject();
        if (!res.project) throw new Error('磁盘上还没有项目文件');
        Store.replace(res.project, '从磁盘刷新', { history: false, persist: false });
        saveLocal(Store.project);
        setMessage('已从磁盘重新载入');
      } else {
        const local = loadLocal();
        if (!local) throw new Error('没有可重新载入的本地副本');
        Store.replace(local, '从本地刷新', { history: false, persist: false });
        setMessage('已从本地缓存重新载入');
      }
    } catch (error) {
      setMessage(error.message || String(error), 'error');
    } finally {
      reloadInFlight = false;
    }
  }

  function saveLocal(project) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      Store.lastSavedAt = Date.now();
      return true;
    } catch (error) {
      console.warn('本地保存失败', error);
      return false;
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeProject(JSON.parse(raw)) : null;
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  async function flushSave() {
    saveTimer = null;
    const project = clone(Store.project);
    project.savedAt = nowIso();
    const localOk = saveLocal(project);
    if (!Store.server) {
      setMessage(localOk ? '已保存到本地' : '本地保存失败', localOk ? 'info' : 'error');
      return;
    }
    try {
      await saveServerProject(project);
      setMessage('已保存到磁盘');
    } catch (error) {
      setMessage('磁盘保存失败，已保留本地副本', 'error');
    }
  }

  function flushBeforeUnload() {
    const project = clone(Store.project);
    project.savedAt = nowIso();
    saveLocal(project);
    if (Store.server && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({ project: project })], { type: 'application/json' });
      navigator.sendBeacon('/api/project', blob);
    }
  }

  function tick(now) {
    const last = tick.last || now;
    const dt = Math.min(0.05, (now - last) / 1000);
    tick.last = now;
    Runtime.update(dt);
    Renderer.draw();
    Renderer.fpsFrames += 1;
    if (!Renderer.lastFpsTime) Renderer.lastFpsTime = now;
    if (now - Renderer.lastFpsTime > 500) {
      Runtime.fps = Math.round(Renderer.fpsFrames * 1000 / (now - Renderer.lastFpsTime));
      Renderer.fpsFrames = 0;
      Renderer.lastFpsTime = now;
      refs.fpsBadge.textContent = Runtime.fps + ' fps';
    }
    requestAnimationFrame(tick);
  }

  async function boot() {
    collectRefs();
    const local = loadLocal();
    if (local) Store.project = local;
    Store.server = await detectServer();
    if (Store.server) {
      try {
        const res = await loadServerProject();
        if (res.project) Store.project = normalizeProject(res.project);
        else await saveServerProject(Store.project);
      } catch (error) {
        Store.server = false;
        setMessage('服务器读取失败，已使用本地项目', 'error');
      }
    }
    Store.project = normalizeProject(Store.project);
    reflowDockedWindows();
    Runtime.syncFromProject(true);
    Renderer.init();
    Editor.init();
    Store.notify('boot');
    requestAnimationFrame(tick);
  }

  function collectRefs() {
    refs.appShell = document.querySelector('.app-shell');
    refs.canvas = $('gameCanvas');
    refs.saveState = $('saveState');
    refs.runtimeBadge = $('runtimeBadge');
    refs.fpsBadge = $('fpsBadge');
    refs.cursorBadge = $('cursorBadge');
    refs.sceneName = $('sceneName');
    refs.entityList = $('entityList');
    refs.inspectorForm = $('inspectorForm');
    refs.messageLine = $('messageLine');
    refs.playBtn = $('playBtn');
    refs.pauseBtn = $('pauseBtn');
    refs.stepBtn = $('stepBtn');
    refs.resetRuntimeBtn = $('resetRuntimeBtn');
    refs.undoBtn = $('undoBtn');
    refs.redoBtn = $('redoBtn');
    refs.forceReloadBtn = $('forceReloadBtn');
    refs.exportBtn = $('exportBtn');
    refs.importBtn = $('importBtn');
    refs.importInput = $('importInput');
    refs.addEntityBtn = $('addEntityBtn');
    refs.deleteEntityBtn = $('deleteEntityBtn');
    refs.promptInput = $('promptInput');
    refs.planBtn = $('planBtn');
    refs.applyPlanBtn = $('applyPlanBtn');
    refs.planOutput = $('planOutput');
    refs.copyContextBtn = $('copyContextBtn');
    refs.quickCommand = $('quickCommand');
    refs.runQuickCommandBtn = $('runQuickCommandBtn');
    refs.windowLayer = $('windowLayer');
    refs.objectsWindow = $('objectsWindow');
    refs.propertiesWindow = $('propertiesWindow');
    refs.resourceWindow = $('resourceWindow');
    refs.annotationWindow = $('annotationWindow');
    refs.resetWindowsBtn = $('resetWindowsBtn');
    refs.windowManagerBtn = $('windowManagerBtn');
    refs.windowManagerMenu = $('windowManagerMenu');
    refs.resourceCount = $('resourceCount');
    refs.resourceNameInput = $('resourceNameInput');
    refs.resourceTypeSelect = $('resourceTypeSelect');
    refs.addResourceBtn = $('addResourceBtn');
    refs.importResourceBtn = $('importResourceBtn');
    refs.resourceFileInput = $('resourceFileInput');
    refs.resourceList = $('resourceList');
    refs.annotationCount = $('annotationCount');
    refs.annotationTextInput = $('annotationTextInput');
    refs.annotationResourceSelect = $('annotationResourceSelect');
    refs.addAnnotationBtn = $('addAnnotationBtn');
    refs.annotationList = $('annotationList');
  }

  window.addEventListener('beforeunload', flushBeforeUnload);
  window.addEventListener('DOMContentLoaded', boot);
})();
