'use strict';
const MAP_W = 4400, MAP_H = 4400, CELL = 160;
const NAV_CRUSH = { crate: 1, sandbag: 1 }; // what a tank's route may go straight through

class Zone {
  constructor(w, h, scale = 1) {
    this.w = w; this.h = h;
    this.cx = w / 2; this.cy = h / 2;
    this.r = Math.hypot(w, h) / 2 + 50; // covers whole map initially
    // closes in about 2.5 minutes: the lobby is down to a handful by then, so the circle decides the end
    this.phases = [
      { wait: 28, shrink: 18, frac: 0.55, dps: 1.5 },
      { wait: 14, shrink: 14, frac: 0.55, dps: 3 },
      { wait: 12, shrink: 12, frac: 0.5,  dps: 5 },
      { wait: 10, shrink: 10, frac: 0.5,  dps: 8 },
      { wait: 8,  shrink: 8,  frac: 0.45, dps: 12 },
      { wait: 6,  shrink: 10, frac: 0,    dps: 18 },
    ];
    if (scale !== 1) for (const p of this.phases) { p.wait *= scale; p.shrink *= scale; } // big maps: a slower circle
    this.phase = 0; this.state = 'wait'; this.timer = this.phases[0].wait; this.done = false; this.fixed = false;
    this.pickTarget();
  }
  // Arena modes: the zone never moves and never hurts.
  makeFixed() { this.fixed = true; this.tx = this.cx; this.ty = this.cy; this.tr = this.r; }
  get current() { return this.phases[Math.min(this.phase, this.phases.length - 1)]; }
  get dps() { return this.fixed ? 0 : this.current.dps; }
  // Center/radius bots should navigate toward (the upcoming circle).
  get goalX() { return this.done ? this.cx : this.tx; }
  get goalY() { return this.done ? this.cy : this.ty; }
  get goalR() { return this.done ? this.r : this.tr; }
  pickTarget() {
    const p = this.current;
    const nr = this.r * p.frac;
    const maxOff = Math.max(0, this.r - nr) * 0.85;
    const a = U.rand(0, Math.PI * 2), d = U.rand(0, maxOff);
    const margin = Math.min(nr, 250);
    this.tx = U.clamp(this.cx + Math.cos(a) * d, margin, this.w - margin);
    this.ty = U.clamp(this.cy + Math.sin(a) * d, margin, this.h - margin);
    this.tr = nr;
    this.sx = this.cx; this.sy = this.cy; this.sr = this.r;
  }
  // Returns 'shrink' or 'wait' on a state change, else null.
  update(dt) {
    if (this.done || this.fixed) return null;
    this.timer -= dt;
    const p = this.current;
    if (this.state === 'wait') {
      if (this.timer <= 0) { this.state = 'shrink'; this.timer = p.shrink; return 'shrink'; }
    } else {
      const t = 1 - U.clamp(this.timer / p.shrink, 0, 1);
      const e = t * t * (3 - 2 * t);
      this.cx = U.lerp(this.sx, this.tx, e); this.cy = U.lerp(this.sy, this.ty, e); this.r = U.lerp(this.sr, this.tr, e);
      if (this.timer <= 0) {
        this.cx = this.tx; this.cy = this.ty; this.r = this.tr;
        this.phase++;
        if (this.phase >= this.phases.length) { this.done = true; this.state = 'done'; }
        else { this.state = 'wait'; this.timer = this.current.wait; this.pickTarget(); }
        return 'wait';
      }
    }
    return null;
  }
  contains(x, y) { return this.fixed || U.dist(x, y, this.cx, this.cy) <= this.r; }
}

class Loot {
  constructor(x, y, kind, weapon) {
    this.x = x; this.y = y; this.kind = kind; this.weapon = weapon || null;
    this.r = 16; this.alive = true; this.seed = Math.random() * 10; this.respawnAt = 0;
  }
  get label() {
    switch (this.kind) {
      case 'weapon': return this.weapon.name;
      case 'ammo': return 'Ammo';
      case 'medkit': return 'Medkit';
      case 'shield': return 'Shield';
    }
    return '?';
  }
  get color() {
    switch (this.kind) {
      case 'weapon': return this.weapon.color;
      case 'ammo': return '#d9b36a';
      case 'medkit': return '#ff5c6c';
      case 'shield': return '#5fb3ff';
    }
    return '#fff';
  }
}

class World {
  // opts: size (square side; height makes it a rectangle), loot (bool), fixedZone (bool), roads (bool), zoneScale (number),
  // custom (fn(world) that lays the map out by hand instead of generating one; its return value becomes world.sites)
  constructor(mapDef, opts = {}) {
    this.map = mapDef || MAPS.grass;
    this.w = opts.size || MAP_W; this.h = opts.height || opts.size || MAP_H;
    this.area = (this.w * this.h) / (MAP_W * MAP_H); // scales obstacle and loot counts
    this.shape = this.map.shape || 'square';
    this.islandR = this.w / 2 - 40;
    this.obstacles = []; this.loot = []; this.decor = []; this.roads = []; this.pads = []; this.dirty = []; this.version = 0;
    this.trenches = []; this.wire = []; // War: rectangles of dug-in cover and of barbed wire (neither is solid)
    this.labels = []; this.props = []; this.sites = null; // custom maps: pads = floors, labels = place names on the ground, props = flat decorations
    this.cols = Math.ceil(this.w / CELL); this.rows = Math.ceil(this.h / CELL);
    this.grid = new Array(this.cols * this.rows);
    this.lootGrid = new Array(this.cols * this.rows); // loot never moves, so it is bucketed once where it lands
    for (let i = 0; i < this.grid.length; i++) { this.grid[i] = []; this.lootGrid[i] = []; }
    if (opts.custom) this.sites = opts.custom(this);
    else {
      if (opts.roads && this.map.layout !== 'grid') this.layRoads();
      this.generate();
    }
    if (opts.loot !== false) this.spawnLoot();
    this.zone = new Zone(this.w, this.h, opts.zoneScale || 1);
    if (opts.fixedZone) this.zone.makeFixed();
  }

  // Is a circle of radius r at (x,y) inside the playable area (map square, or the island disc)?
  inBounds(x, y, r) {
    if (x < r || y < r || x > this.w - r || y > this.h - r) return false;
    if (this.shape === 'circle') return U.dist(x, y, this.w / 2, this.h / 2) <= this.islandR - r;
    return true;
  }
  clampInside(e) {
    e.x = U.clamp(e.x, e.r, this.w - e.r);
    e.y = U.clamp(e.y, e.r, this.h - e.r);
    if (this.shape === 'circle') {
      const cx = this.w / 2, cy = this.h / 2, d = U.dist(e.x, e.y, cx, cy), max = this.islandR - e.r;
      if (d > max) { e.x = cx + (e.x - cx) / d * max; e.y = cy + (e.y - cy) / d * max; }
    }
  }

  bbox(o) {
    return o.type === 'rect' ? { x: o.x, y: o.y, w: o.w, h: o.h } : { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 };
  }
  overlaps(a, b, m) {
    const A = this.bbox(a), B = this.bbox(b);
    return A.x - m < B.x + B.w && A.x + A.w + m > B.x && A.y - m < B.y + B.h && A.y + A.h + m > B.y;
  }
  addObstacle(o) {
    this.obstacles.push(o);
    const b = this.bbox(o);
    const x0 = U.clamp(Math.floor(b.x / CELL), 0, this.cols - 1), x1 = U.clamp(Math.floor((b.x + b.w) / CELL), 0, this.cols - 1);
    const y0 = U.clamp(Math.floor(b.y / CELL), 0, this.rows - 1), y1 = U.clamp(Math.floor((b.y + b.h) / CELL), 0, this.rows - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.grid[cy * this.cols + cx].push(o);
  }
  // Cars smash crates: take one obstacle out of the world. The renderer redraws the tiles listed in `dirty`.
  removeObstacle(o) {
    const i = this.obstacles.indexOf(o); if (i < 0) return;
    this.obstacles.splice(i, 1);
    for (const cell of this.grid) { const k = cell.indexOf(o); if (k >= 0) cell.splice(k, 1); }
    this.dirty.push(this.bbox(o)); this.version++;
  }

  // A loose grid of straight roads, laid before anything else so nothing is built on them.
  layRoads() {
    const n = Math.max(2, Math.round(this.w / 2200)), rw = 150, gap = this.w / n;
    for (let i = 0; i < n; i++) {
      const at = () => Math.round(gap * (i + 0.5) + U.rand(-gap * 0.22, gap * 0.22) - rw / 2);
      this.roads.push({ x: 0, y: at(), w: this.w, h: rw, horiz: true });
      this.roads.push({ x: at(), y: 0, w: rw, h: this.h, horiz: false });
    }
  }
  inTrench(x, y) {
    const T = this.trenches;
    for (let i = 0; i < T.length; i++) { const r = T[i]; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true; }
    return false;
  }
  inWire(x, y) {
    const T = this.wire;
    for (let i = 0; i < T.length; i++) { const r = T[i]; if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true; }
    return false;
  }
  onRoad(x, y) {
    for (const r of this.roads) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    return false;
  }

  tryPlace(o, margin) {
    const b = this.bbox(o);
    if (!this.inBounds(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) / 2 + 30)) return false;
    for (const r of this.roads) if (b.x < r.x + r.w + 12 && b.x + b.w > r.x - 12 && b.y < r.y + r.h + 12 && b.y + b.h > r.y - 12) return false;
    for (const other of this.obstacles) if (this.overlaps(o, other, margin)) return false;
    this.addObstacle(o);
    return true;
  }

  generate() {
    const m = this.map, w = this.w, h = this.h, n = (base) => Math.round(base * this.area);
    if (m.layout === 'grid') this.generateGrid();
    else {
      // Building clusters ("towns")
      for (let c = 0; c < n(m.towns); c++) {
        const cx = U.rand(350, w - 350), cy = U.rand(350, h - 350);
        const count = U.randInt(3, 7);
        for (let i = 0; i < count; i++) {
          for (let t = 0; t < 12; t++) {
            const bw = U.randInt(90, 260), bh = U.randInt(90, 260);
            const x = U.clamp(cx + U.rand(-380, 380), 80, w - bw - 80);
            const y = U.clamp(cy + U.rand(-380, 380), 80, h - bh - 80);
            if (this.tryPlace({ type: 'rect', x, y, w: bw, h: bh, kind: 'building', color: U.pick(m.buildings) }, 60)) break;
          }
        }
      }
    }
    // Crates
    for (let i = 0; i < n(m.crates); i++) {
      for (let t = 0; t < 10; t++) {
        const s = U.randInt(34, 54);
        const x = U.rand(80, w - 80 - s), y = U.rand(80, h - 80 - s);
        if (this.tryPlace({ type: 'rect', x, y, w: s, h: s, kind: 'crate', color: m.crate }, 50)) break;
      }
    }
    // Trees and rocks
    for (let i = 0; i < n(m.trees); i++) {
      for (let t = 0; t < 10; t++) {
        const r = U.randInt(20, 42);
        const x = U.rand(80, w - 80), y = U.rand(80, h - 80);
        const tree = Math.random() < m.treeRatio;
        if (this.tryPlace({ type: 'circle', x, y, r, kind: tree ? 'tree' : 'rock', color: tree ? U.pick(m.treeColors) : m.rock }, 50)) break;
      }
    }
    // Non-solid ground patches for visual variety
    for (let i = 0; i < n(480); i++) {
      const x = U.rand(0, w), y = U.rand(0, h);
      if (!this.inBounds(x, y, 0)) continue;
      this.decor.push({ x, y, r: U.rand(30, 130), color: U.pick(m.decor) });
    }
  }

  // City layout: blocks of buildings separated by straight streets.
  generateGrid() {
    const m = this.map, block = 420, street = 110, margin = 120;
    for (let by = margin; by + block < this.h - margin; by += block + street) {
      for (let bx = margin; bx + block < this.w - margin; bx += block + street) {
        if (Math.random() < 0.15) continue; // plaza
        const count = U.randInt(1, 3);
        for (let i = 0; i < count; i++) {
          for (let t = 0; t < 10; t++) {
            const bw = U.randInt(110, 300), bh = U.randInt(110, 300);
            const x = bx + U.rand(0, block - bw), y = by + U.rand(0, block - bh);
            if (this.tryPlace({ type: 'rect', x, y, w: bw, h: bh, kind: 'building', color: U.pick(m.buildings) }, 50)) break;
          }
        }
      }
    }
  }

  spawnLoot() {
    const n = (base) => Math.round(base * this.area);
    const table = [{ v: 'smg', w: 30 }, { v: 'shotgun', w: 25 }, { v: 'rifle', w: 25 }, { v: 'sniper', w: 8 }, { v: 'pistol', w: 10 }, { v: 'rocket', w: 5 }];
    const place = (kind, weapon) => {
      const p = this.freeSpot(20, 60);
      if (p) this.addLoot(new Loot(p.x, p.y, kind, weapon));
    };
    for (let i = 0; i < n(100); i++) place('weapon', makeWeapon(U.weightedPick(table)));
    for (let i = 0; i < n(80); i++) place('ammo');
    for (let i = 0; i < n(60); i++) place('medkit');
    for (let i = 0; i < n(55); i++) place('shield');
  }

  addLoot(l) {
    this.loot.push(l);
    this.lootGrid[U.clamp(Math.floor(l.y / CELL), 0, this.rows - 1) * this.cols + U.clamp(Math.floor(l.x / CELL), 0, this.cols - 1)].push(l);
    return l;
  }
  // Forget loot that has been picked up or has expired (War, where the dead keep dropping more).
  pruneLoot() {
    this.loot = this.loot.filter((l) => l.alive || l.respawnAt);
    for (let i = 0; i < this.lootGrid.length; i++) if (this.lootGrid[i].length) this.lootGrid[i] = this.lootGrid[i].filter((l) => l.alive || l.respawnAt);
  }
  // Calls fn for every loot item (alive or not) in the grid cells within r of a point.
  lootNear(x, y, r, fn) {
    const x0 = U.clamp(Math.floor((x - r) / CELL), 0, this.cols - 1), x1 = U.clamp(Math.floor((x + r) / CELL), 0, this.cols - 1);
    const y0 = U.clamp(Math.floor((y - r) / CELL), 0, this.rows - 1), y1 = U.clamp(Math.floor((y + r) / CELL), 0, this.rows - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.lootGrid[cy * this.cols + cx];
      for (let i = 0; i < cell.length; i++) fn(cell[i]);
    }
  }

  freeSpot(r, margin = 0) {
    for (let t = 0; t < 300; t++) {
      const x = U.rand(r + margin, this.w - r - margin), y = U.rand(r + margin, this.h - r - margin);
      if (this.inBounds(x, y, r + margin) && !this.circleBlocked(x, y, r + 8)) return { x, y };
    }
    return null;
  }

  cellsAround(x, y, r, fn) {
    const x0 = U.clamp(Math.floor((x - r) / CELL), 0, this.cols - 1), x1 = U.clamp(Math.floor((x + r) / CELL), 0, this.cols - 1);
    const y0 = U.clamp(Math.floor((y - r) / CELL), 0, this.rows - 1), y1 = U.clamp(Math.floor((y + r) / CELL), 0, this.rows - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const cell = this.grid[cy * this.cols + cx];
      for (let i = 0; i < cell.length; i++) fn(cell[i]);
    }
  }

  solidAt(px, py) {
    if (px < 0 || py < 0 || px >= this.w || py >= this.h) return true;
    const cell = this.grid[Math.floor(py / CELL) * this.cols + Math.floor(px / CELL)];
    for (let i = 0; i < cell.length; i++) {
      const o = cell[i];
      if (o.type === 'rect') { if (px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h) return true; }
      else { const dx = px - o.x, dy = py - o.y; if (dx * dx + dy * dy < o.r * o.r) return true; }
    }
    return false;
  }

  // skipKind: ignore one kind of obstacle (drivers ignore crates, which a car smashes through), or a { kind: 1 } set
  circleBlocked(x, y, r, skipKind) {
    let hit = false;
    this.cellsAround(x, y, r, (o) => {
      if (hit || o.kind === skipKind || (skipKind && typeof skipKind === 'object' && skipKind[o.kind])) return;
      if (o.type === 'rect') {
        const nx = U.clamp(x, o.x, o.x + o.w), ny = U.clamp(y, o.y, o.y + o.h);
        if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) hit = true;
      } else if (U.dist(x, y, o.x, o.y) < r + o.r) hit = true;
    });
    return hit;
  }

  // Push a circular entity out of any obstacles and keep it inside the playable area.
  // Several passes so that being pushed out of one obstacle into another still settles.
  resolveCircle(e) {
    for (let pass = 0; pass < 3; pass++) {
      const sx = e.x, sy = e.y;
      this.resolveOnce(e);
      if (e.x === sx && e.y === sy) break;
    }
  }
  resolveOnce(e) {
    this.cellsAround(e.x, e.y, e.r + 4, (o) => {
      if (o.type === 'rect') {
        const nx = U.clamp(e.x, o.x, o.x + o.w), ny = U.clamp(e.y, o.y, o.y + o.h);
        const dx = e.x - nx, dy = e.y - ny, d = Math.hypot(dx, dy);
        if (d >= e.r) return;
        if (d === 0) {
          const left = e.x - o.x, right = o.x + o.w - e.x, top = e.y - o.y, bottom = o.y + o.h - e.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) e.x = o.x - e.r; else if (m === right) e.x = o.x + o.w + e.r;
          else if (m === top) e.y = o.y - e.r; else e.y = o.y + o.h + e.r;
        } else { const p = (e.r - d) / d; e.x += dx * p; e.y += dy * p; }
      } else {
        const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), min = e.r + o.r;
        if (d >= min) return;
        if (d === 0) e.x += min; else { const p = (min - d) / d; e.x += dx * p; e.y += dy * p; }
      }
    });
    this.clampInside(e);
  }

  // ---------------------------------------------------------------- finding a way round
  // A coarse grid (40px cells, filled in lazily and thrown away whenever an obstacle is removed) for bots that have
  // walked into something. big = tank-sized clearance, ignoring what a tank drives through.
  navFree(cx, cy, big) {
    const g = this.nav || (this.nav = { N: 40, cols: Math.ceil(this.w / 40), rows: Math.ceil(this.h / 40), v: -1, a: null, b: null });
    if (g.v !== this.version) { g.v = this.version; g.a = new Uint8Array(g.cols * g.rows); g.b = new Uint8Array(g.cols * g.rows); }
    if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return false;
    const arr = big ? g.b : g.a, i = cy * g.cols + cx;
    if (!arr[i]) {
      const x = (cx + 0.5) * g.N, y = (cy + 0.5) * g.N, r = big ? 44 : 21;
      arr[i] = this.inBounds(x, y, r) && !this.circleBlocked(x, y, r, big ? NAV_CRUSH : undefined) ? 1 : 2;
    }
    return arr[i] === 1;
  }
  navLine(x0, y0, x1, y1, big, skip = true) {
    const d = U.dist(x0, y0, x1, y1), n = Math.max(1, Math.ceil(d / 14)), N = 40;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      if (skip && k * d < 34) continue; // whoever is asking may be pressed against the wall they want to get round
      if (!this.navFree(Math.floor((x0 + (x1 - x0) * k) / N), Math.floor((y0 + (y1 - y0) * k) / N), big)) return false;
    }
    return true;
  }
  // A* from (ax, ay) to (bx, by). Returns a short list of points to walk through in order (the last is the goal),
  // or null when there is no way (a sealed compound) or it is too far to be worth searching.
  navPath(ax, ay, bx, by, big) {
    this.navFree(0, 0, big);
    const g = this.nav, N = g.N, cols = g.cols, rows = g.rows;
    const near = (x, y) => {
      const cx = U.clamp(Math.floor(x / N), 0, cols - 1), cy = U.clamp(Math.floor(y / N), 0, rows - 1);
      for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.navFree(cx + dx, cy + dy, big)) return (cy + dy) * cols + cx + dx;
      }
      return -1;
    };
    const s = near(ax, ay), e = near(bx, by);
    if (s < 0 || e < 0) return null;
    const ex = e % cols, ey = Math.floor(e / cols);
    if (!g.cost) { g.cost = new Float32Array(cols * rows); g.from = new Int32Array(cols * rows); g.done = new Uint8Array(cols * rows); } // reused between searches
    const cost = g.cost.fill(Infinity), from = g.from.fill(-1), done = g.done.fill(0);
    const heap = []; // binary heap of [f, cell]
    const push = (f, c) => { let i = heap.length; heap.push([f, c]); while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
      }
      return top[1];
    };
    const h = (c) => { const dx = Math.abs((c % cols) - ex), dy = Math.abs(Math.floor(c / cols) - ey); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    cost[s] = 0; push(h(s), s);
    let found = false;
    for (let n = 0; heap.length && n < 4500; n++) {
      const c = pop();
      if (done[c]) continue;
      done[c] = 1;
      if (c === e) { found = true; break; }
      const cx = c % cols, cy = Math.floor(c / cols);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.navFree(nx, ny, big)) continue;
        if (dx && dy && !(this.navFree(cx + dx, cy, big) && this.navFree(cx, cy + dy, big))) continue; // no cutting corners
        const k = ny * cols + nx, nc = cost[c] + (dx && dy ? 1.414 : 1);
        if (done[k] || nc >= cost[k]) continue;
        cost[k] = nc; from[k] = c; push(nc + h(k), k);
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = e; c !== s && c >= 0; c = from[c]) cells.push({ x: (c % cols + 0.5) * N, y: (Math.floor(c / cols) + 0.5) * N });
    cells.reverse();
    if (cells.length && this.navFree(Math.floor(bx / N), Math.floor(by / N), big)) cells[cells.length - 1] = { x: bx, y: by };
    // keep only the corners: from each point, skip ahead to the furthest one with a clear line to it
    const out = []; let px = ax, py = ay;
    for (let i = 0; i < cells.length;) {
      let j = Math.min(cells.length - 1, i + 14);
      while (j > i && !this.navLine(px, py, cells[j].x, cells[j].y, big, i === 0)) j--;
      out.push(cells[j]); px = cells[j].x; py = cells[j].y; i = j + 1;
    }
    return out;
  }

  lineOfSight(ax, ay, bx, by) {
    const d = U.dist(ax, ay, bx, by);
    const steps = Math.max(1, Math.ceil(d / 12));
    const dx = (bx - ax) / steps, dy = (by - ay) / steps;
    for (let i = 1; i < steps; i++) if (this.solidAt(ax + dx * i, ay + dy * i)) return false;
    return true;
  }
}
