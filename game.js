// game.js —— 游戏循环：WASD 移动、AABB 碰撞、战斗判定框（作为子实体）
(function (global) {
  'use strict';
  const S = global.State;
  const E = global.Engine;

  const keys = Object.create(null);
  const mouse = { down: false, rdown: false, x: 0, y: 0, downAt: 0 };
  const combat = {
    lastDash: -10, dashUntil: -10, dashDx: 0, dashDy: 0,
    lastParry: -10, lastAttack: -10, charging: false, chargeStart: 0,
  };
  const PLAYER_SPEED = 300;
  const DASH_SPEED = 1200;
  const DASH_TIME = 0.2;
  const DASH_CD = 1;
  const PARRY_CD = 2;
  const PARRY_TIME = 0.5;
  const ATTACK_CD = 0.4;
  const CHARGE_THRESHOLD = 1.0;

  // ===== 时间作为游戏的一等属性 =====
  // clock.time 只在未暂停时累加，所有依赖时间的判断（CD、lifetime、charge）都读它。
  // 暂停 = 时间停止流动。继续 = 从原点续上，按键、CD、剩余 dash 都自然恢复。
  const clock = { time: 0, paused: false };
  function gameTime() { return clock.time; }
  function setPaused(p) { clock.paused = !!p; }
  function isPaused()  { return clock.paused; }

  let dom, renderStageOnly;
  let lastReal = performance.now();
  let running = false;

  function init(refs, opts) {
    dom = refs;
    renderStageOnly = opts.renderStageOnly;
    bindInputs();
  }

  function start() {
    if (running) return;
    running = true;
    lastReal = performance.now();
    requestAnimationFrame(loop);
  }

  function bindInputs() {
    window.addEventListener('keydown', function (e) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
    dom.stage.addEventListener('mousemove', function (e) {
      const p = E.screenToWorld(e.clientX, e.clientY);
      mouse.x = p.x; mouse.y = p.y;
    });
    dom.stage.addEventListener('mousedown', function (e) {
      if (S.state.editMode) return;
      if (e.button === 0) {
        e.preventDefault();
        mouse.down = true;
        mouse.downAt = gameTime();
        combat.charging = true;
        combat.chargeStart = mouse.downAt;
      }
      if (e.button === 2) { e.preventDefault(); mouse.rdown = true; }
      if (mouse.down && mouse.rdown) tryParry();
      else if (e.button === 2) tryDash();
    });
    dom.stage.addEventListener('mouseup', function (e) {
      if (S.state.editMode) return;
      const now = gameTime();
      if (e.button === 0) {
        e.preventDefault();
        const heldFor = now - mouse.downAt;
        mouse.down = false;
        if (combat.charging) {
          combat.charging = false;
          if (heldFor >= CHARGE_THRESHOLD) tryChargeAttack();
          else tryNormalAttack();
        }
      }
      if (e.button === 2) { e.preventDefault(); mouse.rdown = false; }
    });
    dom.stage.addEventListener('contextmenu', function (e) { if (!S.state.editMode) e.preventDefault(); });
  }

  function findPlayer() {
    return S.getFirstObjectByRole('player');
  }
  function findFloors() {
    return S.getObjectsByRole('floor');
  }

  function aabbOverlap(a, b) {
    const aw = S.getShapeWidth(a), ah = S.getShapeHeight(a);
    const bw = S.getShapeWidth(b), bh = S.getShapeHeight(b);
    return a.x < b.x + bw && a.x + aw > b.x && a.y < b.y + bh && a.y + ah > b.y;
  }

  function tryMove(player, dx, dy) {
    const floors = findFloors();
    player.x += dx;
    floors.forEach(function (f) {
      if (aabbOverlap(player, f)) {
        if (dx > 0) player.x = f.x - S.getShapeWidth(player);
        else if (dx < 0) player.x = f.x + S.getShapeWidth(f);
      }
    });
    player.y += dy;
    floors.forEach(function (f) {
      if (aabbOverlap(player, f)) {
        if (dy > 0) player.y = f.y - S.getShapeHeight(player);
        else if (dy < 0) player.y = f.y + S.getShapeHeight(f);
      }
    });
  }

  function spawnHitbox(owner, label, w, h, dx, dy, lifetime, theme) {
    const px = owner.x + S.getShapeWidth(owner) / 2 + dx - w / 2;
    const py = owner.y + S.getShapeHeight(owner) / 2 + dy - h / 2;
    const shape = S.normalizeShape({
      id: S.generateShapeId(),
      type: 'square',
      name: owner.name + '-' + label,
      role: 'hitbox',
      x: px, y: py, width: w, height: h,
      pivotX: 0.5, pivotY: 0.5, rotation: 0,
      look: 'fancy', theme: theme || 'red',
      parentId: owner.id, isHitbox: true, lifetime: lifetime,
    }, S.state.nextId - 1);
    S.ensureObjectInStage(shape);
    S.state.objects.push(shape);
  }

  function getAimVector(player) {
    const cx = player.x + S.getShapeWidth(player) / 2;
    const cy = player.y + S.getShapeHeight(player) / 2;
    const dx = mouse.x - cx; const dy = mouse.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { dx: dx / len, dy: dy / len };
  }

  function tryDash() {
    const now = gameTime();
    if (now - combat.lastDash < DASH_CD) return;
    const player = findPlayer(); if (!player) return;
    const v = getAimVector(player);
    combat.lastDash = now;
    combat.dashUntil = now + DASH_TIME;
    combat.dashDx = v.dx; combat.dashDy = v.dy;
  }

  function tryParry() {
    const now = gameTime();
    if (now - combat.lastParry < PARRY_CD) return;
    const player = findPlayer(); if (!player) return;
    combat.lastParry = now;
    combat.charging = false;
    spawnHitbox(player, '弹反', 200, 200, 0, 0, PARRY_TIME, 'blue');
  }

  function tryNormalAttack() {
    const now = gameTime();
    if (now - combat.lastAttack < ATTACK_CD) return;
    const player = findPlayer(); if (!player) return;
    combat.lastAttack = now;
    const v = getAimVector(player);
    spawnHitbox(player, '普攻', 120, 120, v.dx * 90, v.dy * 90, 0.2, 'red');
  }

  function tryChargeAttack() {
    const now = gameTime();
    if (now - combat.lastAttack < ATTACK_CD) return;
    const player = findPlayer(); if (!player) return;
    combat.lastAttack = now;
    const v = getAimVector(player);
    spawnHitbox(player, '蓄力', 250, 250, v.dx * 130, v.dy * 130, 0.6, 'purple');
  }

  // update 只在游戏时间流动时被调用；不再自己判断 editMode。
  function update(dt) {
    const player = findPlayer();
    if (player) {
      let mx = 0, my = 0;
      if (keys['w']) my -= 1;
      if (keys['s']) my += 1;
      if (keys['a']) mx -= 1;
      if (keys['d']) mx += 1;
      if (mx || my) {
        const len = Math.hypot(mx, my) || 1;
        mx /= len; my /= len;
        tryMove(player, mx * PLAYER_SPEED * dt, my * PLAYER_SPEED * dt);
      }
      if (gameTime() < combat.dashUntil) {
        tryMove(player, combat.dashDx * DASH_SPEED * dt, combat.dashDy * DASH_SPEED * dt);
      }
    }
    S.state.objects = S.state.objects.filter(function (o) {
      if (!o.isHitbox || o.lifetime == null) return true;
      o.lifetime -= dt;
      return o.lifetime > 0;
    });
    if (player) S.ensureObjectInStage(player);
  }

  function loop(now) {
    if (!running) return;
    const realDt = Math.min(0.05, (now - lastReal) / 1000);
    lastReal = now;
    if (!clock.paused) {
      clock.time += realDt;
      update(realDt);
      renderStageOnly && renderStageOnly();
    }
    requestAnimationFrame(loop);
  }

  global.Game = {
    init: init,
    start: start,
    setPaused: setPaused,
    isPaused: isPaused,
    gameTime: gameTime,
    clock: clock,
  };
})(window);
