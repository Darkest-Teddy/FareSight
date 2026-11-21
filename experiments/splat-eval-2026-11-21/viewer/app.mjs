import * as pc from '/pc/playcanvas.mjs';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const panel = $('#panel');
const hud = $('#hud');
const labelsEl = $('#labels');
const statusEl = $('#status');
const overlay = $('#overlay');
const overlayImg = overlay.querySelector('img');

const PROVIDER_NAMES = { sam: 'SAM 3D Objects', idol: 'Idol', trellis: 'TRELLIS', 'idol-space': 'Idol (public Space)' };
const DISH_SPACING = 0.34;
const R2D = 180 / Math.PI;

// ---------- engine ----------
const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: false } });
app.setCanvasFillMode(pc.FILLMODE_NONE);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const resize = () => app.resizeCanvas(canvas.clientWidth, canvas.clientHeight);
new ResizeObserver(resize).observe(canvas);
resize();
app.start();

const camera = new pc.Entity('camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.043, 0.047, 0.051), fov: 40, nearClip: 0.005, farClip: 100 });
// The rig is the VR play-space origin; on desktop it stays at identity.
const rig = new pc.Entity('rig');
app.root.addChild(rig);
rig.addChild(camera);
let cameraClip = { near: 0.005, far: 100 };
function setClip(near, far) {
  cameraClip = { near, far };
  camera.camera.nearClip = near;
  camera.camera.farClip = far;
}
const light = new pc.Entity('light');
light.addComponent('light', { type: 'directional', intensity: 0.9 });
light.setEulerAngles(50, 30, 0);
app.root.addChild(light);
app.scene.ambientLight = new pc.Color(0.45, 0.45, 0.45);

let world = new pc.Entity('world');
app.root.addChild(world);

// ---------- assets ----------
const cache = new Map(); // url -> Promise<pc.Asset>
function load(url, type) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      app.assets.loadFromUrl(url, type, (err, asset) => (err ? reject(new Error(`${url}: ${err}`)) : resolve(asset)));
    }));
  }
  return cache.get(url);
}
function releaseExcept(keep) {
  for (const [url, promise] of cache) {
    if (keep.has(url)) continue;
    cache.delete(url);
    promise.then((asset) => { asset.unload(); app.assets.remove(asset); }).catch(() => {});
  }
}

function showStatus(text) {
  statusEl.textContent = text ?? '';
  statusEl.style.display = text ? 'block' : 'none';
}

// ---------- state ----------
let catalog = { rooms: [], dishes: { providerOrder: [], dishes: [] } };
const state = {
  mode: 'rooms',
  roomId: null, roomConfig: null, roomTier: '100k', overlay: false, overlayOpacity: 0.5,
  dish: null, dishLayout: 'all', dishTier: '60k',
};
let generation = 0;
let controls = null; // { update(dt), hud() }
let labels = [];     // [{ el, pos: pc.Vec3 }]

// ---------- DOM helper ----------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const pressed = (on) => (on ? 'true' : 'false');
const money = (v) => (v == null ? '—' : v === 0 ? '$0' : `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`);
const count = (v) => (v == null ? '—' : Number(v).toLocaleString());
const titleCase = (s) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
function verdict(v) {
  if (v === true) return h('span', { class: 'verdict yes' }, 'Publishable');
  if (v === false) return h('span', { class: 'verdict no' }, 'Not publishable');
  return h('span', { class: 'verdict na' }, 'Unscored');
}
function scoreRows(scores) {
  return Object.entries(scores ?? {}).flatMap(([k, v]) => [h('dt', {}, titleCase(k)), h('dd', {}, `${v} / 5`)]);
}

// ---------- input ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('select, input')) return;
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && document.activeElement === canvas) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || !controls) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  controls.drag(dx, dy, drag.pan);
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); controls?.wheel(e.deltaY); }, { passive: false });

// First-person controls for rooms. Units are model units; upm converts metres.
function flyControls(upm, origin) {
  const pos = new pc.Vec3();
  let yaw = 0, pitch = 0;
  const apply = () => { camera.setPosition(pos); camera.setEulerAngles(pitch, yaw, 0); };
  const tmp = new pc.Vec3();
  return {
    setView(view) {
      pos.set(...view.position);
      const d = new pc.Vec3(...view.target).sub(pos).normalize();
      yaw = Math.atan2(-d.x, -d.z) * R2D;
      pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) * R2D;
      apply();
    },
    pose: () => ({ pos: pos.clone(), yaw }),
    refresh: () => apply(),
    drag(dx, dy) { yaw -= dx * 0.15; pitch = Math.max(-89, Math.min(89, pitch - dy * 0.15)); apply(); },
    wheel(dy) { pos.add(tmp.copy(camera.forward).mulScalar(-dy * 0.0008 * upm)); apply(); },
    update(dt) {
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.8 : 0.6) * upm * dt;
      const move = new pc.Vec3();
      if (keys.has('KeyW')) move.add(camera.forward);
      if (keys.has('KeyS')) move.sub(camera.forward);
      if (keys.has('KeyD')) move.add(camera.right);
      if (keys.has('KeyA')) move.sub(camera.right);
      if (keys.has('KeyE') || keys.has('Space')) move.y += 1;
      if (keys.has('KeyQ') || keys.has('KeyC')) move.y -= 1;
      if (move.lengthSq() > 0) pos.add(move.normalize().mulScalar(speed));
      const turn = 70 * dt;
      if (keys.has('ArrowLeft')) yaw += turn;
      if (keys.has('ArrowRight')) yaw -= turn;
      if (keys.has('ArrowUp')) pitch = Math.min(89, pitch + turn);
      if (keys.has('ArrowDown')) pitch = Math.max(-89, pitch - turn);
      apply();
    },
    hud() {
      const metres = tmp.copy(pos).sub(origin).length() / upm;
      return h('span', {}, 'Est. ', h('strong', {}, `${metres.toFixed(2)} m`), ' from photo 1 · ',
        'drag to look · WASD move · Q/E down/up · Shift faster');
    },
  };
}

// Orbit controls for dishes (metres).
function orbitControls() {
  const target = new pc.Vec3(0, 0.035, 0);
  let yaw = 0, elev = 35, dist = 0.9;
  const apply = () => {
    const e = elev / R2D, y = yaw / R2D;
    camera.setPosition(target.x + dist * Math.sin(y) * Math.cos(e), target.y + dist * Math.sin(e), target.z + dist * Math.cos(y) * Math.cos(e));
    camera.lookAt(target);
  };
  return {
    refresh: () => apply(),
    set({ yaw: a = yaw, elev: b = elev, dist: c = dist, x }) {
      yaw = a; elev = b; dist = c;
      if (x != null) target.set(x, 0.035, 0);
      apply();
    },
    drag(dx, dy, pan) {
      if (pan) {
        const s = dist * 0.0015;
        target.add(camera.right.clone().mulScalar(-dx * s)).add(camera.up.clone().mulScalar(dy * s));
      } else {
        yaw -= dx * 0.4;
        elev = Math.max(-10, Math.min(89, elev + dy * 0.3));
      }
      apply();
    },
    wheel(dy) { dist = Math.max(0.12, Math.min(4, dist * Math.exp(dy * 0.001))); apply(); },
    update(dt) {
      const turn = 90 * dt;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) { yaw -= turn; apply(); }
      if (keys.has('ArrowRight') || keys.has('KeyD')) { yaw += turn; apply(); }
      if (keys.has('ArrowUp') || keys.has('KeyW')) { elev = Math.min(89, elev + turn * 0.6); apply(); }
      if (keys.has('ArrowDown') || keys.has('KeyS')) { elev = Math.max(-10, elev - turn * 0.6); apply(); }
    },
    hud() {
      return h('span', {}, h('strong', {}, `${Math.round(elev)}° elevation`), ' · drag to orbit · scroll to zoom · Shift-drag to pan');
    },
  };
}

// ---------- VR ----------
// Rooms: the scene is scaled to metres and the play space starts at the current desktop
// viewpoint. Dishes: the row of dishes sits at table height in front of the viewer.
const VR = { tableHeight: 0.75, standBack: 0.55, eyeHeight: 1.55, moveSpeed: 0.9, snapDeg: 30 };
let vrStart = null;
let snapReady = true;
let resetHeld = false;

function vrAvailable() {
  return !!app.xr && app.xr.supported && app.xr.isAvailable(pc.XRTYPE_VR);
}

function placeRig(start) {
  rig.setPosition(start.pos);
  rig.setEulerAngles(0, start.yaw, 0);
}

function enterVr() {
  if (app.xr.active || !vrAvailable()) return;
  if (state.mode === 'rooms') {
    const cfg = catalog.rooms.find((r) => r.id === state.roomConfig);
    const upm = cfg?.poses?.units_per_meter_estimate ?? 1;
    const eye = cfg?.poses?.reference_height_m_estimate ?? VR.eyeHeight;
    const p = controls?.pose?.() ?? { pos: new pc.Vec3(), yaw: 0 };
    world.setLocalScale(1 / upm, 1 / upm, 1 / upm);
    vrStart = { pos: new pc.Vec3(p.pos.x / upm, p.pos.y / upm - eye, p.pos.z / upm), yaw: p.yaw };
  } else {
    world.setLocalPosition(0, VR.tableHeight, 0);
    vrStart = { pos: new pc.Vec3(0, 0, VR.standBack), yaw: 0 };
  }
  placeRig(vrStart);
  camera.camera.nearClip = 0.03;
  camera.camera.farClip = 200;
  overlay.style.display = 'none';
  camera.camera.startXr(pc.XRTYPE_VR, pc.XRSPACE_LOCALFLOOR, {
    callback: (err) => {
      if (!err) return;
      showStatus(`Could not start VR: ${err.message}`);
      leaveVr();
    },
  });
}

function leaveVr() {
  rig.setPosition(0, 0, 0);
  rig.setEulerAngles(0, 0, 0);
  world.setLocalScale(1, 1, 1);
  world.setLocalPosition(0, 0, 0);
  camera.camera.nearClip = cameraClip.near;
  camera.camera.farClip = cameraClip.far;
  controls?.refresh?.();
  applyOverlay();
}

function snapTurn(deg) {
  const head = camera.getPosition().clone();
  rig.rotate(0, deg, 0);
  rig.translate(head.sub(camera.getPosition()));
}

function vrUpdate(dt) {
  for (const src of app.xr.input.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const [x, y] = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] ?? 0, gp.axes[1] ?? 0];
    if (src.handedness === 'left') {
      if (Math.hypot(x, y) < 0.15) continue;
      const fwd = camera.forward.clone(); fwd.y = 0; fwd.normalize();
      const right = camera.right.clone(); right.y = 0; right.normalize();
      rig.translate(fwd.mulScalar(-y).add(right.mulScalar(x)).mulScalar(VR.moveSpeed * dt));
    } else if (src.handedness === 'right') {
      if (snapReady && Math.abs(x) > 0.7) { snapTurn(x > 0 ? -VR.snapDeg : VR.snapDeg); snapReady = false; }
      else if (Math.abs(x) < 0.3) snapReady = true;
      const reset = !!gp.buttons[4]?.pressed; // A: back to the starting spot
      if (reset && !resetHeld && vrStart) placeRig(vrStart);
      resetHeld = reset;
    }
  }
}

if (app.xr) {
  app.xr.on('end', leaveVr);
  app.xr.on(`available:${pc.XRTYPE_VR}`, () => renderPanel());
}

app.on('update', (dt) => {
  if (app.xr?.active) vrUpdate(dt);
  else controls?.update(dt);
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  const out = new pc.Vec3();
  for (const l of labels) {
    camera.camera.worldToScreen(l.pos, out);
    const visible = out.z > 0 && out.x > -50 && out.x < w + 50 && out.y > -20 && out.y < hgt + 20;
    l.el.style.display = visible ? 'block' : 'none';
    if (visible) { l.el.style.left = `${out.x}px`; l.el.style.top = `${out.y}px`; }
  }
});
let hudTimer = 0;
app.on('update', (dt) => {
  hudTimer += dt;
  if (hudTimer < 0.1 || !controls) return;
  hudTimer = 0;
  hud.replaceChildren(controls.hud());
});

function resetScene() {
  world.destroy();
  world = new pc.Entity('world');
  app.root.addChild(world);
  labelsEl.replaceChildren();
  labels = [];
}

function addSplat(parent, asset) {
  const e = new pc.Entity('splat');
  e.addComponent('gsplat', { asset, unified: true });
  parent.addChild(e);
  return e;
}

// ---------- rooms ----------
function roomsFor(roomId) { return catalog.rooms.filter((r) => r.roomId === roomId); }

async function showRoom(keepView = false) {
  const gen = ++generation;
  const cfg = catalog.rooms.find((r) => r.id === state.roomConfig);
  renderPanel();
  if (!cfg) return;
  const tier = cfg.tiers.find((t) => t.id === state.roomTier) ?? cfg.tiers[0];
  state.roomTier = tier.id;
  const poses = cfg.poses;
  const upm = poses?.units_per_meter_estimate ?? 1;
  const photo1 = poses?.views?.find((v) => v.id === 'photo-1') ?? poses?.views?.[0];

  const previous = controls;
  const prevPos = camera.getPosition().clone(), prevRot = camera.getRotation().clone();
  resetScene();
  overlayImg.src = cfg.sources[0]?.url ?? '';
  applyOverlay();
  app.scene.ambientLight = new pc.Color(0, 0, 0); // unlit depth mesh would otherwise wash out
  camera.camera.fov = photo1?.vertical_fov_deg ?? 50;
  setClip(Math.max(0.001, photo1?.near ?? 0.005), 60);
  controls = flyControls(upm, new pc.Vec3(...(photo1?.position ?? [0, 0, 0])));
  if (keepView && previous?.setView) {
    // keep the user's viewpoint when switching tiers/configs of the same room
    const fwd = new pc.Vec3(0, 0, -1);
    prevRot.transformVector(fwd, fwd);
    controls.setView({ position: [prevPos.x, prevPos.y, prevPos.z], target: [prevPos.x + fwd.x, prevPos.y + fwd.y, prevPos.z + fwd.z] });
  } else if (photo1) {
    controls.setView(photo1);
  }

  // Splat and depth-mesh data are in the source PLY / OpenCV frame; render poses are in
  // the engine frame (x, y flipped). A 180° roll about Z maps one onto the other.
  const root = new pc.Entity('room-root');
  root.setLocalEulerAngles(0, 0, 180);
  world.addChild(root);

  showStatus(`Loading ${tier.label}…`);
  try {
    if (cfg.kind === 'depth') {
      const asset = await load(tier.url, 'container');
      if (gen !== generation) return;
      const node = asset.resource.instantiateRenderEntity();
      // The mesh's triangle winding was authored for an image-space (y-down) camera.
      for (const render of node.findComponents('render')) {
        for (const mi of render.meshInstances) { mi.material.cull = pc.CULLFACE_NONE; mi.material.update(); }
      }
      // The mesh is photo-1-camera-local in glTF convention (looks -Z, y up), in metres.
      // Map glTF camera → OpenCV camera (180° about X), then camera-to-world (PLY frame).
      const m = cfg.camera1; // camera-to-world, row-major, OpenCV
      const holder = new pc.Entity('depth-mesh');
      const glToCv = new pc.Quat().setFromEulerAngles(180, 0, 0);
      if (m) {
        const rot = new pc.Mat4().set([m[0][0], m[1][0], m[2][0], 0, m[0][1], m[1][1], m[2][1], 0, m[0][2], m[1][2], m[2][2], 0, 0, 0, 0, 1]);
        holder.setLocalPosition(m[0][3], m[1][3], m[2][3]);
        holder.setLocalRotation(new pc.Quat().setFromMat4(rot).mul(glToCv));
      } else {
        holder.setLocalRotation(glToCv);
      }
      holder.setLocalScale(upm, upm, upm);
      holder.addChild(node);
      root.addChild(holder);
    } else {
      const asset = await load(tier.url, 'gsplat');
      if (gen !== generation) return;
      addSplat(root, asset);
    }
    releaseExcept(new Set([tier.url]));
    showStatus(null);
  } catch (err) {
    if (gen === generation) showStatus(`Could not load: ${err.message}`);
  }
}

function applyOverlay() {
  overlay.style.display = state.mode === 'rooms' && state.overlay && overlayImg.src ? 'flex' : 'none';
  overlayImg.style.opacity = state.overlayOpacity;
}

function roomPanel() {
  const roomIds = [...new Set(catalog.rooms.map((r) => r.roomId))];
  if (!roomIds.length) return [h('p', { class: 'help' }, 'No room results yet.')];
  const configs = roomsFor(state.roomId);
  const cfg = catalog.rooms.find((r) => r.id === state.roomConfig);
  const pick = (id) => () => { state.roomConfig = id; syncHash(); showRoom(true); };
  const cell = (photos, res) => {
    const c = configs.find((x) => x.kind === 'splat' && x.photos === photos && x.resolution === res);
    if (!c) return h('span', { class: 'help' }, '—');
    return h('button', { 'aria-pressed': pressed(c.id === state.roomConfig), onclick: pick(c.id),
      title: c.publishable ? 'Publishable' : 'Not publishable' }, `${money(c.costUsd)}`);
  };
  const depth = configs.find((x) => x.kind === 'depth');
  const view = (v) => h('button', { onclick: () => controls?.setView(v) },
    v.label + (v.translation_from_photo_1_m_estimate ? ` (${v.translation_from_photo_1_m_estimate.toFixed(2)} m)` : ''));

  return [
    h('h2', {}, 'Restaurant'),
    h('div', { class: 'row' }, roomIds.map((id) => h('button', {
      'aria-pressed': pressed(id === state.roomId),
      onclick: () => {
        state.roomId = id;
        const same = roomsFor(id).find((x) => cfg && x.photos === cfg.photos && x.resolution === cfg.resolution && x.kind === cfg.kind);
        state.roomConfig = (same ?? roomsFor(id)[0]).id;
        syncHash(); showRoom();
      },
    }, roomsFor(id)[0]?.restaurant ?? id))),
    h('h2', {}, 'Configuration · WorldMirror cost per run'),
    h('div', { class: 'grid2' },
      h('span'), h('span', { class: 'head' }, '518 px'), h('span', { class: 'head' }, '952 px'),
      h('span', { class: 'rowhead' }, '2 photos'), cell(2, 518), cell(2, 952),
      h('span', { class: 'rowhead' }, '3 photos'), cell(3, 518), cell(3, 952)),
    depth && h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { 'aria-pressed': pressed(depth.id === state.roomConfig), onclick: pick(depth.id) }, '1 photo · free depth mesh (2.5D)')),
    cfg && [
      h('h2', {}, 'Asset'),
      h('select', { 'aria-label': 'Asset tier', onchange: (e) => { state.roomTier = e.target.value; showRoom(true); } },
        cfg.tiers.map((t) => h('option', { value: t.id, selected: t.id === state.roomTier }, t.label))),
      h('h2', {}, 'Viewpoints'),
      h('div', { class: 'row' }, (cfg.poses?.views ?? []).map(view)),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: state.overlay, onchange: (e) => { state.overlay = e.target.checked; applyOverlay(); } }),
        'Overlay photo 1 (lines up at the Photo 1 pose)'),
      state.overlay && h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: state.overlayOpacity, 'aria-label': 'Overlay opacity',
        style: 'width:100%', oninput: (e) => { state.overlayOpacity = +e.target.value; applyOverlay(); } }),
      h('h2', {}, 'Result'),
      h('div', { class: 'card' },
        h('header', {}, h('b', {}, cfg.kind === 'depth' ? 'Depth baseline' : `${cfg.photos} photos · ${cfg.resolution} px`),
          cfg.kind === 'depth' ? h('span', { class: 'verdict na' }, 'Baseline') : verdict(cfg.publishable)),
        h('dl', {},
          h('dt', {}, 'Inference cost'), h('dd', {}, money(cfg.costUsd)),
          cfg.predictTimeS != null && [h('dt', {}, 'GPU time'), h('dd', {}, `${cfg.predictTimeS.toFixed(1)} s`)],
          cfg.gaussians != null && [h('dt', {}, 'Raw Gaussians'), h('dd', {}, count(cfg.gaussians))],
          scoreRows(cfg.scores)),
        cfg.evidence && h('p', { class: 'evidence' }, cfg.evidence)),
      h('h2', {}, 'Source photos'),
      h('div', { class: 'thumbs' }, cfg.sources.map((s, i) => h('figure', {},
        h('a', { href: s.page ?? s.url, target: '_blank', rel: 'noreferrer' }, h('img', { src: s.url, alt: `Source photo ${i + 1}`, loading: 'lazy' })),
        h('figcaption', {}, `${i + 1} · ${s.author ?? ''} · ${s.license ?? ''}`)))),
    ],
  ];
}

// ---------- dishes ----------
async function showDish(keepView = false) {
  const gen = ++generation;
  renderPanel();
  const dish = catalog.dishes.dishes.find((d) => d.id === state.dish);
  if (!dish) return;
  const order = catalog.dishes.providerOrder.filter((p) => dish.providers[p]);
  const shown = state.dishLayout === 'all' ? order : order.filter((p) => p === state.dishLayout);
  if (!shown.length && order.length) { state.dishLayout = 'all'; return showDish(keepView); }

  const previous = controls;
  resetScene();
  applyOverlay();
  app.scene.ambientLight = new pc.Color(0.45, 0.45, 0.45);
  camera.camera.fov = 35;
  setClip(0.005, 20);
  if (!(keepView && previous?.set)) {
    controls = orbitControls();
    controls.set({ yaw: 0, elev: 35, dist: shown.length > 1 ? 0.55 + 0.2 * shown.length : 0.5, x: 0 });
  }

  const width = shown.length * DISH_SPACING;
  const table = new pc.Entity('table');
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color(0.16, 0.12, 0.09);
  mat.gloss = 0.3;
  mat.update();
  table.addComponent('render', { type: 'box', material: mat });
  table.setLocalScale(Math.max(width + 0.06, 0.4), 0.012, 0.38);
  table.setLocalPosition(0, -0.0065, 0);
  world.addChild(table);

  const urls = [];
  shown.forEach((p, i) => {
    const x = (i - (shown.length - 1) / 2) * DISH_SPACING;
    const result = dish.providers[p];
    const tier = result.tiers.find((t) => t.id === state.dishTier) ?? result.tiers[0];
    urls.push({ p, x, url: tier.url });
    const el = h('div', { class: 'label' }, h('b', {}, PROVIDER_NAMES[p] ?? p), ` · ${money(result.costUsd)}`);
    labelsEl.append(el);
    labels.push({ el, pos: new pc.Vec3(x, 0.16, 0) });
  });

  showStatus(`Loading ${urls.length} splat${urls.length === 1 ? '' : 's'}…`);
  const settled = await Promise.allSettled(urls.map((u) => load(u.url, 'gsplat')));
  if (gen !== generation) return;
  const failures = [];
  settled.forEach((s, i) => {
    if (s.status !== 'fulfilled') { failures.push(PROVIDER_NAMES[urls[i].p]); return; }
    // Normalized dish files are leveled, in metres, with the plate bottom at y = 0.
    const node = new pc.Entity(urls[i].p);
    node.setLocalPosition(urls[i].x, 0, 0);
    world.addChild(node);
    addSplat(node, s.value);
  });
  releaseExcept(new Set(urls.map((u) => u.url)));
  showStatus(failures.length ? `Could not load: ${failures.join(', ')}` : null);
}

function dishPanel() {
  const dishes = catalog.dishes.dishes;
  if (!dishes.length) return [h('p', { class: 'help' }, 'No dish results yet.')];
  const dish = dishes.find((d) => d.id === state.dish);
  const order = dish ? catalog.dishes.providerOrder.filter((p) => dish.providers[p]) : [];
  const preset = (label, opts) => h('button', { onclick: () => controls?.set(opts) }, label);
  return [
    h('h2', {}, 'Dish'),
    h('div', { class: 'dishes' }, dishes.map((d) => h('button', {
      'aria-pressed': pressed(d.id === state.dish),
      onclick: () => { state.dish = d.id; syncHash(); showDish(); },
      title: `${Object.keys(d.providers).length} result(s)`,
    }, h('img', { src: d.source.url, alt: '', loading: 'lazy' }), h('span', {}, d.id)))),
    dish && [
      h('h2', {}, 'Show'),
      h('div', { class: 'row' },
        h('button', { 'aria-pressed': pressed(state.dishLayout === 'all'), onclick: () => { state.dishLayout = 'all'; showDish(); } }, 'Side by side'),
        order.map((p) => h('button', { 'aria-pressed': pressed(state.dishLayout === p), onclick: () => { state.dishLayout = p; showDish(); } }, PROVIDER_NAMES[p] ?? p))),
      !order.length && h('p', { class: 'help', style: 'margin-top:8px' }, 'No generated splat for this dish yet.'),
      h('h2', {}, 'Asset'),
      h('select', { 'aria-label': 'Asset tier', onchange: (e) => { state.dishTier = e.target.value; showDish(true); } },
        [['60k', '60k SOG (Quest)'], ['30k', '30k SOG'], ['full', 'Full (normalized PLY)']].map(([id, label]) =>
          h('option', { value: id, selected: id === state.dishTier }, label))),
      h('h2', {}, 'Camera'),
      h('div', { class: 'row' },
        preset('Photo angle', { yaw: 0, elev: 35 }), preset('Side', { yaw: 90, elev: 5 }),
        preset('Top', { yaw: 0, elev: 89 }), preset('Back', { yaw: 180, elev: 20 })),
      h('h2', {}, 'Source photo'),
      h('a', { href: dish.source.page ?? dish.source.url, target: '_blank', rel: 'noreferrer' },
        h('img', { src: dish.source.url, alt: `${dish.id} source photo`, style: 'width:100%;border-radius:6px;border:1px solid var(--line);display:block' })),
      h('p', { class: 'help', style: 'margin-top:4px' }, `${dish.source.author ?? ''} · ${dish.source.license ?? ''}`,
        dish.targetWidthM ? ` · scaled to ${Math.round(dish.targetWidthM * 100)} cm` : ''),
      h('h2', {}, 'Results'),
      order.map((p) => {
        const r = dish.providers[p];
        return h('div', { class: 'card' },
          h('header', {}, h('b', {}, PROVIDER_NAMES[p] ?? p), verdict(r.publishable)),
          h('dl', {},
            h('dt', {}, 'Cost'), h('dd', {}, money(r.costUsd)),
            r.runtimeS != null && [h('dt', {}, 'Runtime'), h('dd', {}, `${Number(r.runtimeS).toFixed(1)} s`)],
            r.gaussians != null && [h('dt', {}, 'Raw Gaussians'), h('dd', {}, count(r.gaussians))],
            r.attempt > 1 && [h('dt', {}, 'Attempt'), h('dd', {}, r.attempt)],
            scoreRows(r.scores)),
          r.evidence && h('p', { class: 'evidence' }, r.evidence));
      }),
    ],
  ];
}

// ---------- shell ----------
function renderPanel() {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-pressed', pressed(b.dataset.mode === state.mode)));
  const vr = vrAvailable()
    ? h('div', { class: 'vr' },
      h('button', { onclick: enterVr }, state.mode === 'rooms' ? 'Enter VR at this viewpoint' : 'Enter VR at the table'),
      h('p', { class: 'help' }, 'Left stick moves · right stick turns · A returns to the start. Use the Quest-sized files in VR.'))
    : h('p', { class: 'help vr' }, 'An "Enter VR" button appears when this page is opened in a headset browser over HTTPS.');
  panel.replaceChildren(vr, ...(state.mode === 'rooms' ? roomPanel() : dishPanel()).flat(Infinity).filter(Boolean),
    h('h2', {}, 'Data'),
    h('button', { onclick: async () => { await fetchCatalog(); show(true); } }, 'Reload results'));
}

function show(keepView = false) {
  applyOverlay();
  return state.mode === 'rooms' ? showRoom(keepView) : showDish(keepView);
}

function syncHash() {
  const id = state.mode === 'rooms' ? state.roomConfig : state.dish;
  history.replaceState(null, '', `#${state.mode}${id ? `/${id}` : ''}`);
}

async function fetchCatalog() {
  catalog = await (await fetch('/api/catalog')).json();
  if (!catalog.rooms.some((r) => r.id === state.roomConfig)) {
    const first = catalog.rooms.find((r) => r.kind === 'splat') ?? catalog.rooms[0];
    state.roomConfig = first?.id ?? null;
  }
  state.roomId = catalog.rooms.find((r) => r.id === state.roomConfig)?.roomId ?? null;
  if (!catalog.dishes.dishes.some((d) => d.id === state.dish)) {
    state.dish = (catalog.dishes.dishes.find((d) => Object.keys(d.providers).length) ?? catalog.dishes.dishes[0])?.id ?? null;
  }
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  if (state.mode === b.dataset.mode) return;
  state.mode = b.dataset.mode;
  syncHash();
  show();
}));

(async () => {
  const [mode, id] = location.hash.slice(1).split('/');
  if (mode === 'dishes') { state.mode = 'dishes'; state.dish = id ?? null; }
  else if (id) state.roomConfig = id;
  try {
    await fetchCatalog();
  } catch (err) {
    showStatus(`Could not load catalog: ${err.message}`);
    return;
  }
  syncHash();
  show();
})();
