// Breach Room - level data, generator and solver.
// A level: { name, hint, nodes:[[x,y]], edges:[[a,b]], sources:[idx], core:idx, budget, spread }

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Can anything in `from` still reach `target` when edges in `cut` are removed?
export function reachable(n, edges, cut, from, target) {
  const adj = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], i) => {
    if (cut.has(i)) return;
    adj[a].push(b);
    adj[b].push(a);
  });
  const seen = new Set(from);
  const stack = [...from];
  while (stack.length) {
    const x = stack.pop();
    if (x === target) return true;
    for (const y of adj[x]) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return seen.has(target);
}

// Smallest number of cuts that disconnects every source from the core.
export function minCut(level, max = 5) {
  const n = level.nodes.length, E = level.edges.length;
  const search = (start, left, cut) => {
    if (!reachable(n, level.edges, cut, level.sources, level.core)) return true;
    if (left === 0) return false;
    for (let i = start; i < E; i++) {
      cut.add(i);
      const ok = search(i + 1, left - 1, cut);
      cut.delete(i);
      if (ok) return true;
    }
    return false;
  };
  for (let k = 0; k <= max; k++) if (search(0, k, new Set())) return k;
  return Infinity;
}

export function generate(seed, { mid = 6, src = 1, spread = 4, minK = 2, maxK = 4, name = 'Generated' } = {}) {
  const rnd = mulberry32(seed);
  let last = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const nodes = [];
    const sources = [];
    for (let i = 0; i < src; i++) {
      sources.push(nodes.length);
      nodes.push([-0.34, src === 1 ? 0 : (i === 0 ? 0.15 : -0.15) + (rnd() - 0.5) * 0.05]);
    }
    const cols = 3, per = Math.ceil(mid / cols);
    const colNodes = [];
    let used = 0;
    for (let c = 0; c < cols; c++) {
      const n = Math.min(per, mid - used);
      if (n <= 0) break;
      const col = [];
      for (let k = 0; k < n; k++) {
        col.push(nodes.length);
        nodes.push([
          -0.17 + c * 0.17 + (rnd() - 0.5) * 0.04,
          (n === 1 ? 0 : -0.17 + (0.34 / (n - 1)) * k) + (rnd() - 0.5) * 0.04,
        ]);
      }
      used += n;
      colNodes.push(col);
    }
    const core = nodes.length;
    nodes.push([0.34, 0]);

    const layers = [sources, ...colNodes, [core]];
    const edges = [];
    const seen = new Set();
    const add = (a, b) => {
      const key = a < b ? a + '-' + b : b + '-' + a;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push([a, b]);
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    for (let l = 0; l < layers.length - 1; l++) {
      const next = layers[l + 1];
      for (const a of layers[l]) {
        add(a, pick(next));
        if (rnd() < 0.55) add(a, pick(next));
      }
      for (const b of next) {
        if (!edges.some(([x, y]) => y === b && layers[l].includes(x))) add(pick(layers[l]), b);
      }
      if (l < layers.length - 2 && rnd() < 0.35) add(pick(layers[l]), pick(layers[l + 2]));
    }

    const level = { name, nodes, edges, sources, core, spread, budget: 0 };
    const k = minCut(level, maxK);
    level.budget = k;
    last = level;
    if (k >= minK && k <= maxK) return level;
  }
  return last;
}

const hand = [
  {
    name: 'First Contact',
    hint: 'Pinch a link to cut it. Protect the gold Core.',
    spread: 5,
    nodes: [[-0.3, 0], [-0.1, 0.1], [-0.1, -0.1], [0.1, 0], [0.3, 0]],
    edges: [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]],
    sources: [0], core: 4, budget: 1,
  },
  {
    name: 'Two Roads',
    hint: 'Orange links are about to spread. Watch the clock.',
    spread: 4,
    nodes: [[-0.3, 0], [-0.1, 0.12], [-0.1, -0.12], [0.1, 0.12], [0.1, -0.12], [0.3, 0]],
    edges: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5]],
    sources: [0], core: 5, budget: 2,
  },
  {
    name: 'Double Breach',
    hint: 'Two entry points. Find the choke point.',
    spread: 3.5,
    nodes: [[-0.3, 0.15], [-0.3, -0.15], [-0.1, 0.15], [-0.1, 0], [-0.1, -0.15], [0.1, 0.1], [0.1, -0.1], [0.3, 0]],
    edges: [[0, 2], [0, 3], [1, 3], [1, 4], [2, 5], [3, 5], [3, 6], [4, 6], [5, 7], [6, 7]],
    sources: [0, 1], core: 7, budget: 2,
  },
];

export const CAMPAIGN = [
  ...hand,
  { ...generate(404, { mid: 6, src: 1, spread: 3.5, minK: 3, maxK: 3, name: 'The Maze' }), hint: 'Fewer cuts than links. Think.' },
  { ...generate(505, { mid: 8, src: 2, spread: 3, minK: 3, maxK: 4, name: 'Zero Day' }), hint: 'Last one. Good luck.' },
];

export function dailyLevel(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const seed = y * 10000 + m * 100 + d;
  const label = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const lvl = generate(seed, { mid: 8, src: 2, spread: 3.5, minK: 3, maxK: 4, name: 'Daily ' + label });
  lvl.hint = 'Same puzzle for everyone today.';
  return lvl;
}
