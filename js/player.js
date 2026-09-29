/* ============================================================
 * 第一人称控制：行走 / 冲刺 / 跳跃 / 游泳潜水 / 驾船
 * 视角支持指针锁定与鼠标拖动两种模式（iframe 内也能环视）
 * ============================================================ */
(function () {
  const S = window.Seaside;

  const st = (S.player = {
    mode: 'walk',            // walk | swim | boat
    pos: [0, 0, -10],
    yaw: Math.PI,            // 面朝 +z（大海）
    pitch: -0.04,
    vel: [0, 0, 0],
    velY: 0,
    grounded: true,
    bobT: 0,
    sprint: false,
    eye: 0
  });
  st.pos[1] = S.terrainHeight(0, -10) + S.CFG.EYE;

  S.boatLookYaw = 0;
  S.boatLookPitch = 0;
  S.keys = {};

  /* ---------- 键盘 ---------- */
  window.addEventListener('keydown', (e) => {
    S.keys[e.code] = true;
    if (e.code === 'KeyE' && !e.repeat && S.tryBoard) S.tryBoard();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') st.sprint = true;
  });
  window.addEventListener('keyup', (e) => {
    S.keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') st.sprint = false;
  });

  /* ---------- 鼠标视角 ---------- */
  function applyLook(ax, ay) {
    if (st.mode === 'boat') {
      S.boatLookYaw = S.clamp(S.boatLookYaw + ax * 1.1, -1.4, 1.4);
      S.boatLookPitch = S.clamp(S.boatLookPitch + ay * 1.6, -0.7, 0.7);
    } else {
      st.yaw += ax;
      st.pitch = S.clamp(st.pitch + ay, -1.35, 1.35);
    }
  }

  let dragging = false, lastX = 0, lastY = 0;
  document.addEventListener('mousemove', (e) => {
    const locked = !!document.pointerLockElement;
    if (locked) {
      applyLook(-e.movementX * 0.0022, -e.movementY * 0.0022);
    } else if (dragging) {
      applyLook(-(e.clientX - lastX) * 0.0045, -(e.clientY - lastY) * 0.0045);
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  document.addEventListener('mousedown', (e) => {
    const c = document.getElementById('gpuCanvas');
    if (c) c.focus();
    if (!document.pointerLockElement) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
  });
  document.addEventListener('mouseup', () => { dragging = false; });
  document.addEventListener('click', (e) => {
    const c = document.getElementById('gpuCanvas');
    if (c && e.target === c && !document.pointerLockElement && c.requestPointerLock) {
      try { c.requestPointerLock(); } catch (err) { /* iframe 内会被拒绝，拖动兜底 */ }
    }
  });

  /* ---------- 每帧更新 ---------- */
  const tmpFwd = [0, 0, 0];
  S.updatePlayer = function (dt, t) {
    const k = S.keys;
    const b = S.boat;

    if (st.mode === 'boat' && b) {
      // 站位：船中心稍后
      st.pos[0] = b.x - Math.sin(b.heading) * 0.35;
      st.pos[2] = b.z - Math.cos(b.heading) * 0.35;
      st.pos[1] = b.y + 1.05;
      st.eye = 0;
      return;
    }

    // 输入方向（局部：前后 / 左右）
    let ix = 0, iz = 0;
    if (k.KeyW || k.ArrowUp) iz += 1;
    if (k.KeyS || k.ArrowDown) iz -= 1;
    if (k.KeyA || k.ArrowLeft) ix -= 1;
    if (k.KeyD || k.ArrowRight) ix += 1;
    const il = Math.hypot(ix, iz);
    if (il > 0) { ix /= il; iz /= il; }

    const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
    const rx = -fz, rz = fx;

    const ground = S.terrainHeight(st.pos[0], st.pos[2]);
    const surf = S.waveHeight(st.pos[0], st.pos[2], t);

    // 模式切换
    if (st.mode === 'walk') {
      if (ground < -0.62 && st.pos[1] < surf + 0.55) st.mode = 'swim';
    } else if (st.mode === 'swim') {
      if (ground > -0.35 && st.pos[1] > ground + 0.2 && st.pos[1] > surf - 0.35) {
        st.mode = 'walk'; st.velY = 0;
      }
    }

    let speed;
    if (st.mode === 'swim') {
      speed = S.CFG.SWIM * (st.sprint ? 1.45 : 1);
    } else {
      speed = st.sprint ? S.CFG.RUN : S.CFG.WALK;
    }

    let dx = (fx * iz + rx * ix) * speed;
    let dz = (fz * iz + rz * ix) * speed;

    if (st.mode === 'swim') {
      // 水中：可上浮/下潜
      const wantUp = !!(k.Space);
      const wantDown = !!st.sprint && !!(k.KeyC || k.ControlLeft);
      let vy = st.velY;
      const targetY = Math.max(ground + 0.45, surf - 0.30);
      if (wantUp) vy = 1.5;
      else if (wantDown) vy = -1.5;
      else vy += (targetY - st.pos[1]) * 2.4 * dt;
      vy *= 1 - 1.8 * dt;
      st.velY = vy;
      st.pos[1] += vy * dt;
      const minY = ground + 0.35;
      if (st.pos[1] < minY) { st.pos[1] = minY; st.velY = Math.max(st.velY, 0); }
      // 游泳时朝向可上下看
      dz += 0; // 水平移动
    } else {
      // 重力与跳跃
      st.velY -= 22 * dt;
      if (k.Space && st.grounded) { st.velY = 6.2; st.grounded = false; }
      st.pos[1] += st.velY * dt;
      const target = ground + S.CFG.EYE;
      if (st.pos[1] <= target) {
        st.pos[1] = target; st.velY = 0; st.grounded = true;
      } else {
        st.grounded = false;
      }
    }

    // 平滑速度
    const smooth = st.mode === 'swim' ? 4 : 9;
    st.vel[0] += (dx - st.vel[0]) * Math.min(1, dt * smooth);
    st.vel[2] += (dz - st.vel[2]) * Math.min(1, dt * smooth);

    st.pos[0] += st.vel[0] * dt;
    st.pos[2] += st.vel[2] * dt;

    const lim = S.CFG.WORLD_LIMIT;
    st.pos[0] = S.clamp(st.pos[0], -lim, lim);
    st.pos[2] = S.clamp(st.pos[2], -lim, lim);

    // 步伐起伏
    const moving = Math.hypot(st.vel[0], st.vel[2]);
    if (st.mode === 'walk' && moving > 0.3) {
      st.bobT += dt * (st.sprint ? 13 : 9);
      st.eye = Math.sin(st.bobT) * 0.045 * Math.min(1, moving / 5);
    } else if (st.mode === 'swim') {
      st.bobT += dt * 1.6;
      st.eye = Math.sin(st.bobT) * 0.03;
    } else {
      st.eye += (0 - st.eye) * Math.min(1, dt * 6);
    }
  };
})();
