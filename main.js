import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { CAMPAIGN, dailyLevel, reachable } from './levels.js';

const COL = { node: 0x2de2e6, inf: 0xff3b4e, core: 0xffc83d, edge: 0x2a6f8f, danger: 0xff8a3d, hot: 0xfff176 };

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer, { optionalFeatures: ['local-floor', 'hand-tracking'] }));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.25, 0.35); // desktop preview only; in VR the headset drives the camera
camera.lookAt(0, 1.25, -0.55);

// star dust for atmosphere
{
  const g = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 400; i++) {
    const r = 3 + Math.random() * 4, a = Math.random() * Math.PI * 2, h = Math.random() * 4;
    pts.push(Math.cos(a) * r, h, Math.sin(a) * r);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x1b3a5c, size: 0.03 })));
}

const root = new THREE.Group(); // seated, arm's reach in front of the player
root.position.set(0, 1.25, -0.55);
scene.add(root);
const graph = new THREE.Group();
graph.scale.setScalar(0.85);
root.add(graph);
const menuGroup = new THREE.Group();
root.add(menuGroup);

// ---------- text panels ----------
function makePanel(w, h, px, py) {
  const c = document.createElement('canvas');
  c.width = px; c.height = py;
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
  m.userData = { c, t, key: '' };
  return m;
}
function drawPanel(p, lines, color = '#7df9ff', big = 64) {
  const key = lines.join('|') + color;
  if (p.userData.key === key) return;
  p.userData.key = key;
  const { c, t } = p.userData;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(6,12,24,0.85)';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = color; g.lineWidth = 6;
  g.strokeRect(3, 3, c.width - 6, c.height - 6);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    g.font = (i === 0 ? `bold ${big}px` : '38px') + ' system-ui, sans-serif';
    g.fillText(ln, c.width / 2, ((i + 1) * c.height) / (lines.length + 1));
  });
  t.needsUpdate = true;
}

const hud = makePanel(0.8, 0.2, 1024, 256);
hud.position.set(0, 0.36, 0);
root.add(hud);

const title = makePanel(0.8, 0.2, 1024, 256);
title.position.set(0, 0.17, 0);
drawPanel(title, ['BREACH ROOM', 'Pinch a button to start. Hands only.'], '#7df9ff', 90);
menuGroup.add(title);

const buttons = [];
function addButton(x, label, sub, fn) {
  const b = makePanel(0.24, 0.12, 512, 256);
  b.position.set(x, -0.02, 0);
  drawPanel(b, [label, sub], '#ffc83d', 80);
  b.userData.fn = fn;
  menuGroup.add(b);
  buttons.push(b);
}

// ---------- game state ----------
let state = 'menu', stateAt = 0, msg = '';
let level = null, levelIdx = 0, daily = false;
let cut = new Set(), infected = new Set(), cutsLeft = 0, timer = 0;
let nodeMeshes = [], edgeMeshes = [];
const hover = new Set();

function setState(s, m = '') { state = s; msg = m; stateAt = performance.now(); graph.visible = s !== 'menu'; menuGroup.visible = s === 'menu'; }

function edgeColor(i) {
  const [a, b] = level.edges[i];
  return infected.has(a) !== infected.has(b) ? COL.danger : COL.edge;
}

function refresh() {
  nodeMeshes.forEach((m, i) => m.material.color.setHex(infected.has(i) ? COL.inf : i === level.core ? COL.core : COL.node));
  edgeMeshes.forEach((m, i) => { m.visible = !cut.has(i); m.material.color.setHex(edgeColor(i)); });
}

function buildGraph() {
  graph.clear();
  nodeMeshes = []; edgeMeshes = [];
  const up = new THREE.Vector3(0, 1, 0);
  level.edges.forEach(([a, b]) => {
    const A = new THREE.Vector3(...level.nodes[a], 0), B = new THREE.Vector3(...level.nodes[b], 0);
    const len = A.distanceTo(B);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 6), new THREE.MeshBasicMaterial({ color: COL.edge }));
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.scale.y = len;
    m.quaternion.setFromUnitVectors(up, B.clone().sub(A).normalize());
    graph.add(m); edgeMeshes.push(m);
  });
  level.nodes.forEach(([x, y], i) => {
    const r = i === level.core ? 0.04 : 0.026;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshBasicMaterial({ color: COL.node }));
    m.position.set(x, y, 0);
    graph.add(m); nodeMeshes.push(m);
  });
}

function loadLevel(l) {
  level = l;
  cut = new Set();
  infected = new Set(l.sources);
  cutsLeft = l.budget;
  timer = -l.spread * 0.5; // grace period before the first spread
  buildGraph();
  refresh();
  setState('play');
}

function startCampaign() { daily = false; levelIdx = 0; loadLevel(CAMPAIGN[0]); }
function startDaily() { daily = true; loadLevel(dailyLevel()); }
addButton(-0.14, 'PLAY', '5 levels', startCampaign);
addButton(0.14, 'DAILY', 'new each day', startDaily);

function next() {
  if (state === 'lost') { loadLevel(level); return; }
  if (daily) { setState('menu'); return; }
  levelIdx++;
  if (levelIdx >= CAMPAIGN.length) { setState('menu'); return; }
  loadLevel(CAMPAIGN[levelIdx]);
}

function tick() {
  const add = [];
  level.edges.forEach(([a, b], i) => {
    if (cut.has(i)) return;
    if (infected.has(a) && !infected.has(b)) add.push(b);
    else if (infected.has(b) && !infected.has(a)) add.push(a);
  });
  add.forEach((x) => infected.add(x));
  refresh();
  if (infected.has(level.core)) setState('lost', 'Core compromised');
}

function distToSegment(p, a, b) {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}
function nearestEdge(local) {
  let best = -1, bd = 0.06;
  level.edges.forEach(([a, b], i) => {
    if (cut.has(i)) return;
    const d = distToSegment(local, new THREE.Vector3(...level.nodes[a], 0), new THREE.Vector3(...level.nodes[b], 0));
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function tryCut(local) {
  const i = nearestEdge(local);
  if (i < 0) return;
  cut.add(i); cutsLeft--;
  refresh();
  if (!reachable(level.nodes.length, level.edges, cut, [...infected], level.core)) setState('won', 'Breach contained');
  else if (cutsLeft <= 0) setState('lost', 'Out of cuts');
}

function onPinch(world) {
  if (state === 'menu') {
    const l = root.worldToLocal(world.clone());
    for (const b of buttons) {
      if (Math.hypot(l.x - b.position.x, l.y - b.position.y) < 0.1 && Math.abs(l.z) < 0.2) { b.userData.fn(); return; }
    }
  } else if (state === 'play') {
    tryCut(graph.worldToLocal(world.clone()));
  } else if (performance.now() - stateAt > 700) {
    next();
  }
}

// ---------- hand tracking (pinch = thumb tip + index tip) ----------
const hands = [0, 1].map((i) => {
  const h = renderer.xr.getHand(i);
  scene.add(h);
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  cursor.visible = false;
  scene.add(cursor);
  return { h, cursor, pinching: false };
});

function updateHand(H) {
  const th = H.h.joints['thumb-tip'], ix = H.h.joints['index-finger-tip'];
  if (!th || !ix || !th.visible || !ix.visible) { H.cursor.visible = false; H.pinching = false; return; }
  const d = th.position.distanceTo(ix.position);
  H.cursor.position.copy(th.position).add(ix.position).multiplyScalar(0.5);
  H.cursor.visible = true;
  const was = H.pinching;
  if (!was && d < 0.025) H.pinching = true;
  else if (was && d > 0.04) H.pinching = false;
  H.cursor.material.color.setHex(H.pinching ? COL.hot : 0xffffff);
  if (state === 'play') {
    const i = nearestEdge(graph.worldToLocal(H.cursor.position.clone()));
    if (i >= 0) hover.add(i);
  }
  if (H.pinching && !was) onPinch(H.cursor.position.clone());
}

// ---------- desktop preview: click = pinch ----------
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.55);
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  ray.setFromCamera(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1), camera);
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(plane, p)) onPinch(p);
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- loop ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop((time) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  hover.clear();
  hands.forEach(updateHand);

  if (state === 'play') {
    timer += dt;
    if (timer >= level.spread) { timer = 0; tick(); }
    edgeMeshes.forEach((m, i) => { if (m.visible) m.material.color.setHex(hover.has(i) ? COL.hot : edgeColor(i)); });
    nodeMeshes.forEach((m, i) => m.scale.setScalar(infected.has(i) ? 1 + 0.15 * Math.sin(time / 180 + i) : 1));
  }

  if (state === 'menu') {
    root.visible = true;
    drawPanel(hud, ['', ''], '#000000');
    hud.visible = false;
  } else {
    hud.visible = true;
    if (state === 'play') {
      const t = Math.max(0, Math.ceil(level.spread - Math.max(timer, 0)));
      drawPanel(hud, [level.name, `Cuts left: ${cutsLeft}    Spread in ${timer < 0 ? '...' : t + 's'}`, level.hint || ''].filter((x, i) => i < 2 || x), '#7df9ff', 56);
    } else if (state === 'won') {
      const last = !daily && levelIdx >= CAMPAIGN.length - 1;
      drawPanel(hud, [msg.toUpperCase(), last ? 'All levels cleared! Pinch for menu' : 'Pinch to continue'], '#5dff9a', 56);
    } else {
      drawPanel(hud, [msg.toUpperCase(), 'Pinch to retry'], '#ff3b4e', 56);
    }
  }
  renderer.render(scene, camera);
});

setState('menu');
