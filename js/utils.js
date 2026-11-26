'use strict';
const U = {
  rand: (a, b) => a + Math.random() * (b - a),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  angle: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  },
  lerpAngle(a, b, t) { return a + U.normAngle(b - a) * U.clamp(t, 0, 1); },
  pointInRect: (px, py, r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h,
  weightedPick(table) {
    let total = 0;
    for (const e of table) total += e.w;
    let r = Math.random() * total;
    for (const e of table) { r -= e.w; if (r <= 0) return e.v; }
    return table[table.length - 1].v;
  },
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  },
  fmtTime(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
};
