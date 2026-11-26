'use strict';
// Campaign: six story missions played in order, each on its own hand-built map.
//
// A mission has two halves:
//   map(b)            lays the map out with a MapBuilder (roads, rooms you can walk into, compounds, props, woods)
//                     and returns its named locations. The layout is seeded, so it is the same map every time.
//   build(h, game, L) puts the enemies and vehicles on it and returns the list of stages, using the locations L.
// Stages run one after another:
//   reach    get to a place                         { at, r }
//   clear    kill every actor in `targets`          { targets }
//   kill     same, but each target gets a marker    { targets }
//   hold     hold E at a spot for `time` seconds    { at, time, verb }
//   breach   hold E at a compound gate, then the charge blows the gate off   { compound, time }
//   survive  stay alive for `time` seconds; wave() runs every `every` seconds { at, time, every, wave }
//   deliver  bring a car to a place (fails if it is destroyed)               { car, at, r }
// Any stage may add: text (HUD line), label (marker name), say ([[who, line], ...] radio chatter when it starts),
// onStart(), limit (seconds, mission fails when it runs out) and failText.
// The mission fails if the player dies. The story is told on the briefing screen (chapter, story, objectives and a
// picture of the map), over the radio during the mission, and in the debrief. Progress is saved by Progress.

const GUARD_SKIN = { color: '#a8473d', accent: '#26282e', hat: 'helmet' };
const BOSS_SKIN = { color: '#3a2233', accent: '#f2b632', hat: 'crown', eyes: '#ff5252', aura: 'rgba(255,82,82,0.6)' };

// Lays out a custom map on an empty World. Everything random goes through a seeded generator.
class MapBuilder {
  constructor(world, seed) {
    this.w = world; this.map = world.map; this.keeps = [];
    let s = seed | 0;
    this.rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  r(a, b) { return a + this.rnd() * (b - a); }
  pick(arr) { return arr[Math.floor(this.rnd() * arr.length)]; }
  add(o) { this.w.addObstacle(o); return o; }
  // ground features (not solid)
  road(x, y, w, h) { this.w.roads.push({ x, y, w, h, horiz: w >= h }); }
  pad(x, y, w, h, color) { this.w.pads.push({ x, y, w, h, color }); }
  label(text, x, y, size = 44) { this.w.labels.push({ text, x, y, size }); }
  prop(kind, x, y, r) { this.w.props.push({ kind, x, y, r }); }
  keepout(x, y, w, h) { this.keeps.push({ x, y, w, h }); } // scatter() leaves this rectangle empty
  // solid pieces
  box(kind, x, y, w, h, color) { return this.add({ type: 'rect', x, y, w, h, kind, color: color || '#3d424c' }); }
  solid(kind, x, y, r, color) { return this.add({ type: 'circle', x, y, r, kind, color: color || '#777' }); }
  wall(x, y, w, h) { return this.box('wall', x, y, w, h); }
  building(x, y, w, h) { return this.box('building', x, y, w, h, this.pick(this.map.buildings)); }
  crate(x, y, s = 44) { return this.box('crate', x, y, s, s, this.map.crate); }
  // One wall of length len starting at (x, y); door = 0..1 position of a gap D wide, or undefined for none.
  run(x, y, len, horiz, T, door, D) {
    if (door === undefined) return void this.wall(x, y, horiz ? len : T, horiz ? T : len);
    const a = U.clamp(len * door - D / 2, 16, len - D - 16);
    if (horiz) { this.wall(x, y, a, T); this.wall(x + a + D, y, len - a - D, T); }
    else { this.wall(x, y, T, a); this.wall(x, y + a + D, T, len - a - D); }
  }
  // A walled room or fenced yard you can walk into. doors: { n|s|e|w: 0..1 along that wall }.
  room(x, y, w, h, doors = {}, o = {}) {
    const T = o.T || 22, D = o.D || 110;
    if (o.floor !== false) this.pad(x, y, w, h, o.floor || 'rgba(52,48,44,0.55)');
    this.run(x, y, w, true, T, doors.n, D); this.run(x, y + h - T, w, true, T, doors.s, D);
    this.run(x, y + T, h - T * 2, false, T, doors.w, D); this.run(x + w - T, y + T, h - T * 2, false, T, doors.e, D);
    this.keepout(x - 70, y - 70, w + 140, h + 140);
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  }
  // A sealed walled yard with one locked gate that only a breaching charge opens.
  compound(cx, cy, cw, ch, side) {
    const T = 28, G = 120, x0 = cx - cw / 2, y0 = cy - ch / 2;
    this.pad(x0, y0, cw, ch, 'rgba(40,42,48,0.55)');
    let gate = null;
    const run = (sd, x, y, len, horiz) => {
      if (sd !== side) return void this.wall(x, y, horiz ? len : T, horiz ? T : len);
      const a = (len - G) / 2;
      if (horiz) { this.wall(x, y, a, T); this.wall(x + a + G, y, a, T); gate = this.box('gate', x + a, y + 4, G, T - 8, '#8a6a2f'); }
      else { this.wall(x, y, T, a); this.wall(x, y + a + G, T, a); gate = this.box('gate', x + 4, y + a, T - 8, G, '#8a6a2f'); }
    };
    run('n', x0, y0, cw, true); run('s', x0, y0 + ch - T, cw, true);
    run('w', x0, y0 + T, ch - T * 2, false); run('e', x0 + cw - T, y0 + T, ch - T * 2, false);
    const gx = gate.x + gate.w / 2, gy = gate.y + gate.h / 2, d = 75;
    const out = side === 'n' ? { x: gx, y: gy - d } : side === 's' ? { x: gx, y: gy + d } : side === 'w' ? { x: gx - d, y: gy } : { x: gx + d, y: gy };
    this.keepout(x0 - 170, y0 - 170, cw + 340, ch + 340);
    return { x: cx, y: cy, w: cw, h: ch, gate: { ob: gate, x: gx, y: gy, out } };
  }
  // n trees / rocks / crates / buildings somewhere in a rectangle, clear of roads, keepouts and each other.
  scatter(kind, n, x, y, w, h) {
    const m = this.map;
    for (let i = 0; i < n; i++) for (let t = 0; t < 8; t++) {
      const px = this.r(x, x + w), py = this.r(y, y + h);
      let o;
      if (kind === 'tree') o = { type: 'circle', x: px, y: py, r: Math.round(this.r(20, 42)), kind, color: this.pick(m.treeColors) };
      else if (kind === 'rock') o = { type: 'circle', x: px, y: py, r: Math.round(this.r(18, 40)), kind, color: m.rock };
      else if (kind === 'crate') { const s = Math.round(this.r(34, 54)); o = { type: 'rect', x: px, y: py, w: s, h: s, kind, color: m.crate }; }
      else o = { type: 'rect', x: px, y: py, w: Math.round(this.r(110, 240)), h: Math.round(this.r(110, 220)), kind: 'building', color: this.pick(m.buildings) };
      const b = this.w.bbox(o);
      if (this.keeps.some((k) => b.x < k.x + k.w && b.x + b.w > k.x && b.y < k.y + k.h && b.y + b.h > k.y)) continue;
      if (this.w.tryPlace(o, kind === 'building' ? 60 : 46)) break;
    }
  }
  decor(n) {
    for (let i = 0; i < n; i++) {
      const x = this.r(0, this.w.w), y = this.r(0, this.w.h);
      if (this.w.inBounds(x, y, 0)) this.w.decor.push({ x, y, r: this.r(30, 130), color: this.pick(this.map.decor) });
    }
  }
  // A roadblock: sandbags either side of the road, a guard hut, and a row of crates across the carriageway.
  checkpoint(x, y, horiz, name) {
    if (horiz) {
      for (const cy of [y + 8, y + 54, y + 100]) this.crate(x, cy, 42);
      this.box('sandbag', x - 130, y - 44, 260, 24); this.box('sandbag', x - 130, y + 170, 260, 24);
      this.room(x - 240, y + 230, 170, 140, { e: 0.5 }, { D: 80 });
      this.label(name, x, y - 90, 34); this.keepout(x - 300, y - 140, 600, 560);
      return { x: x - 60, y: y + 290 };
    }
    for (const cx of [x + 8, x + 54, x + 100]) this.crate(cx, y, 42);
    this.box('sandbag', x - 44, y - 130, 24, 260); this.box('sandbag', x + 170, y - 130, 24, 260);
    this.room(x - 260, y - 70, 170, 140, { e: 0.5 }, { D: 80 });
    this.label(name, x - 180, y - 120, 34); this.keepout(x - 320, y - 200, 640, 420);
    return { x: x - 60, y: y + 150 };
  }
}

const CAMPAIGN = [
  {
    id: 'm1', name: 'First Light', kind: 'Recon', theme: 'grass', size: 3000, allies: 0, seed: 101,
    chapter: 'Chapter One', place: 'Harrow Valley, 05:40',
    brief: 'Slip in alone, take the relay station and get a signal out.',
    story: [
      'Three weeks ago the Ashen Guard rolled into Harrow Valley in a single night. By morning Marshal Dray owned the roads, the radio and every town between the mountains and the sea. Nobody outside even knows it happened.',
      'You are Wren. You were born here, and you are the only one the resistance managed to get back inside. Atlas, the voice in your ear, is the last operator still broadcasting.',
      'North of your drop point, past the old Mill Farm, the Guard is using the valley\'s relay station to jam everything. Take it back and the outside world hears the truth.',
    ],
    objectives: ['Reach the Relay Station', 'Clear the Guard patrol in the yard', 'Send the signal from the control hut', 'Get to the helicopter at LZ Bravo'],
    debrief: 'The signal is out. For the first time in three weeks, someone outside knows Harrow Valley is still fighting. Atlas has already picked the next target: the Guard\'s payroll.',
    intro: [['Atlas', 'Wren, this is Atlas. You are the only one we got in. Make it count.'], ['Atlas', 'Follow the road north past Mill Farm. The relay station is the fenced yard with the mast.']],
    map(b) {
      b.road(0, 2260, 3000, 150); b.road(1640, 0, 150, 3000);
      b.label('DROP POINT', 330, 2480); b.keepout(150, 2440, 400, 420); b.crate(210, 2590); b.crate(262, 2600); b.crate(236, 2646);
      b.label('MILL FARM', 1000, 1540);
      b.room(760, 1620, 300, 220, { s: 0.5 }); b.building(1110, 1620, 190, 250); b.crate(800, 1880); b.crate(852, 1890); b.crate(1330, 1700); b.crate(1330, 1752);
      b.keepout(700, 1500, 700, 500);
      const yx = 1960, yy = 900, yw = 620, yh = 520;
      b.room(yx, yy, yw, yh, { s: 0.3, w: 0.62 }, { T: 12, D: 150, floor: 'rgba(70,72,66,0.5)' });
      b.solid('tower', yx + 190, yy + 230, 34);
      const hut = b.room(yx + 380, yy + 60, 200, 170, { s: 0.5 }, { D: 90 });
      b.box('console', hut.cx - 32, hut.y + 28, 64, 28);
      b.crate(yx + 60, yy + 60); b.crate(yx + 112, yy + 66); b.crate(yx + 470, yy + 400); b.crate(yx + 520, yy + 410);
      b.label('RELAY STATION', yx + yw / 2, yy - 46);
      b.prop('helipad', 2650, 400, 110); b.label('LZ BRAVO', 2650, 240); b.keepout(2470, 200, 360, 400);
      b.scatter('tree', 190, 0, 0, 1600, 2200); b.scatter('tree', 90, 1820, 1500, 1180, 720); b.scatter('tree', 60, 0, 2440, 3000, 560);
      b.scatter('tree', 40, 1820, 0, 1180, 860); b.scatter('rock', 45, 0, 0, 3000, 3000); b.scatter('crate', 22, 0, 0, 3000, 3000);
      b.decor(240);
      return { start: { x: 350, y: 2640 }, yard: { x: yx + yw / 2, y: yy + yh / 2 }, patrol: { x: yx + 250, y: yy + 390 }, console: { x: hut.cx, y: hut.cy + 22 }, lz: { x: 2650, y: 400 } };
    },
    build(h, game, L) {
      const patrol = h.squad(3, L.patrol.x, L.patrol.y, { weapons: ['pistol'], roam: 200 });
      return [
        { type: 'reach', at: L.yard, r: 430, label: 'Relay Station', text: 'Get to the Relay Station' },
        { type: 'clear', targets: patrol, text: 'Clear the patrol out of the yard', say: [['Atlas', 'That is the patrol. Take them before they call it in.']] },
        { type: 'hold', at: L.console, time: 4, verb: 'send the signal', label: 'Control hut', text: 'Send the signal from the control hut', say: [['Atlas', 'Yard is yours. The set is in the hut by the mast.']] },
        { type: 'reach', at: L.lz, r: 110, label: 'LZ Bravo', text: 'Get to the helicopter at LZ Bravo', say: [['Atlas', 'We hear you, Wren. Loud and clear. Bird is inbound to LZ Bravo, north-east.']],
          onStart() { h.squad(2, L.yard.x, L.yard.y, { weapons: ['smg', 'pistol'], roam: 500, from: 700, hunt: true }); } },
      ];
    },
  },
  {
    id: 'm2', name: 'Knock Knock', kind: 'Breach', theme: 'city', size: 3000, allies: 2, seed: 202,
    chapter: 'Chapter Two', place: 'Carrow, old town, 23:10',
    brief: 'Blow the gate of the Payroll Depot, clear the yard and take the ledgers.',
    story: [
      'The signal worked. Two people in Carrow heard it and knocked on the safehouse door asking where to sign. Their names are Koda and Lynx, and tonight they are coming with you.',
      'An army runs on its payroll. The Guard keeps its ledgers, every name, route and safehouse it pays for, in a walled depot two blocks past Market Square. One gate, on the west wall. One charge in your bag.',
      'Blow the gate, clear the yard, and take the ledgers from the office at the back. Then get them home.',
    ],
    objectives: ['Cross Market Square to the Payroll Depot', 'Plant the breaching charge on the gate', 'Clear the yard', 'Take the ledgers from the office', 'Bring them back to the Safehouse'],
    debrief: 'Names, routes, safehouses. The ledgers put a face on the whole occupation. One name is on every page: Brask, the quartermaster who feeds and arms all of it.',
    intro: [['Atlas', 'Two locals volunteered. Keep them alive if you can.'], ['Atlas', 'Head east across Market Square. The depot gate faces the street.']],
    map(b) {
      for (const c of [640, 1430, 2220]) { b.road(0, c, 3000, 140); b.road(c, 0, 140, 3000); }
      const B = [[60, 640], [780, 1430], [1570, 2220], [2360, 2940]];
      const block = (x0, x1, y0, y1) => { // four buildings, one per corner of the block
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        for (const [qx, qy] of [[x0, y0], [mx, y0], [x0, my], [mx, my]]) {
          if (b.rnd() < 0.18) { b.crate(qx + 90, qy + 90); continue; }
          const bw = Math.round(b.r(150, mx - x0 - 60)), bh = Math.round(b.r(140, my - y0 - 60));
          b.building(qx + b.r(24, mx - x0 - bw - 24), qy + b.r(24, my - y0 - bh - 24), bw, bh);
        }
      };
      B.forEach((bx, i) => B.forEach((by, j) => { if (!((i === 0 && j === 2) || (i === 1 && j === 1) || (i === 2 && j === 1))) block(bx[0], bx[1], by[0], by[1]); }));
      // safehouse (start)
      const safe = b.room(170, 1740, 320, 250, { e: 0.5 });
      b.box('console', safe.x + 40, safe.y + 36, 64, 28); b.crate(safe.x + 230, safe.y + 170, 40);
      b.building(90, 2040, 240, 150); b.building(380, 2050, 200, 140); b.label('SAFEHOUSE', 330, 1690, 38);
      // market square
      b.solid('fountain', 1105, 1105, 52); b.label('MARKET SQUARE', 1105, 850, 40);
      for (const [x, y] of [[860, 900], [912, 900], [1250, 900], [1302, 900], [860, 1290], [912, 1290], [1250, 1290], [1302, 1290], [880, 1090], [1320, 1100]]) b.crate(x, y, 44);
      b.solid('tree', 960, 1010, 30, '#3f7a45'); b.solid('tree', 1250, 1210, 30, '#3f7a45');
      // payroll depot
      const dep = b.compound(1895, 1105, 610, 610, 'w');
      b.building(1960, 840, 200, 160);
      const office = b.room(1940, 1190, 230, 190, { w: 0.5 }, { D: 90 });
      b.box('console', office.x + 130, office.y + 40, 64, 28);
      b.crate(1640, 850); b.crate(1692, 850); b.crate(1640, 1330); b.crate(1780, 1340); b.crate(1840, 880);
      b.label('PAYROLL DEPOT', 1895, 742, 38);
      b.scatter('crate', 26, 0, 0, 3000, 3000);
      b.decor(200);
      return { start: { x: 560, y: 1865 }, safe: { x: safe.cx, y: safe.cy }, depot: dep, yard: { x: 1760, y: 1105 }, office: { x: office.cx + 20, y: office.cy + 30 }, market: { x: 1105, y: 1105 } };
    },
    build(h, game, L) {
      const guards = h.squad(4, L.yard.x, L.yard.y - 120, { weapons: ['smg', 'shotgun', 'pistol'], roam: 150, spread: 90 }).concat(h.squad(2, L.yard.x, L.yard.y + 150, { weapons: ['smg', 'pistol'], roam: 120, spread: 80 }));
      return [
        { type: 'reach', at: L.depot.gate.out, r: 300, label: 'Depot gate', text: 'Cross Market Square to the Payroll Depot' },
        { type: 'breach', compound: L.depot, time: 3, text: 'Plant the charge on the depot gate', say: [['Atlas', 'Set it and step back. It is not a small charge.']] },
        { type: 'clear', targets: guards, text: 'Clear the depot yard', say: [['Atlas', 'Gate is down. Go, go!']] },
        { type: 'hold', at: L.office, time: 3, verb: 'take the ledgers', label: 'Office', text: 'Take the ledgers from the office', say: [['Atlas', 'Yard is clear. The office is the room at the back.']] },
        { type: 'reach', at: L.safe, r: 110, label: 'Safehouse', text: 'Bring the ledgers back to the Safehouse', say: [['Atlas', 'Got them? Then get home. The whole district heard that gate go.']],
          onStart() { h.squad(3, L.market.x, L.market.y, { weapons: ['smg', 'pistol'], roam: 600, from: 500, hunt: true }); } },
      ];
    },
  },
  {
    id: 'm3', name: 'A Quiet Word', kind: 'Assassination', theme: 'snow', size: 3400, allies: 0, seed: 303,
    chapter: 'Chapter Three', place: 'Greywood, above the snow line, 04:15',
    brief: 'Quartermaster Brask is at the Logging Camp tonight. He does not leave it.',
    story: [
      'Brask. Quartermaster of the Ashen Guard. Every bullet, every meal and every litre of fuel in the valley crosses his desk. The ledgers say he inspects the Greywood logging camp tonight, with a small escort and no armour.',
      'Koda and Lynx wanted to come. You said no. This one is quiet, and it is yours: your family\'s mill is on the first page of his requisition book.',
      'Go in from the Trailhead, cross the forest however you like, and find him by the fire. When it is done the whole wood will wake up. A helicopter will wait at the Ranger Station for exactly one minute.',
    ],
    objectives: ['Find the Logging Camp', 'Eliminate Quartermaster Brask', 'Reach the Ranger Station helipad within 60 seconds'],
    debrief: 'Brask is gone and the supply lines went with him. In his coat was a fuel order: one truck, parked at the Guard motor pool in the dunes, feeding every tank Dray owns.',
    intro: [['Atlas', 'One target. Brask. He wears a crown on his collar, you cannot miss him.'], ['Atlas', 'The camp is north-east, past the frozen lake. His escort is good. Pick your moment.']],
    map(b) {
      b.road(380, 480, 120, 2920); b.road(380, 480, 2520, 120);
      b.room(150, 3010, 220, 170, { e: 0.5 }, { D: 90 }); b.crate(410, 3220); b.label('TRAILHEAD', 520, 2960, 38); b.keepout(100, 2900, 700, 420);
      b.pad(1300, 1500, 900, 650, 'rgba(150,200,235,0.55)'); b.label('FROZEN LAKE', 1750, 1840, 46); b.keepout(1300, 1500, 900, 650);
      // logging camp: tents round a fire, a command tent, a watch tower and log piles
      b.pad(2230, 720, 660, 600, 'rgba(120,105,90,0.35)'); b.keepout(2180, 660, 760, 720);
      b.prop('fire', 2550, 1000, 26);
      for (const [x, y] of [[2300, 790], [2500, 740], [2710, 800], [2290, 1130], [2740, 1110]]) b.box('tent', x, y, 110, 80, '#6b7355');
      const cmd = b.room(2460, 1150, 210, 150, { n: 0.5 }, { T: 14, D: 100, floor: 'rgba(90,96,70,0.6)' });
      b.box('console', cmd.cx - 32, cmd.y + cmd.h - 52, 64, 26);
      b.solid('tower', 2250, 980, 28);
      for (const [x, y] of [[2660, 960], [2712, 960], [2686, 912], [2420, 900]]) b.crate(x, y, 46);
      b.label('LOGGING CAMP', 2550, 660, 40);
      const rs = b.room(240, 220, 250, 190, { e: 0.5 }, { D: 90 }); b.box('console', rs.x + 36, rs.y + 34, 64, 28);
      b.prop('helipad', 760, 300, 100); b.label('RANGER STATION', 520, 170, 38); b.keepout(200, 130, 720, 330);
      b.scatter('tree', 430, 0, 0, 3400, 3400); b.scatter('rock', 55, 0, 0, 3400, 3400); b.scatter('crate', 20, 0, 0, 3400, 3400);
      b.decor(260);
      return { start: { x: 560, y: 3120 }, camp: { x: 2550, y: 1000 }, brask: { x: 2560, y: 1090 }, lz: { x: 760, y: 300 } };
    },
    build(h, game, L) {
      const escort = h.squad(2, L.camp.x - 150, L.camp.y - 60, { weapons: ['smg', 'rifle'], roam: 170, spread: 70 }).concat(h.squad(2, L.camp.x + 130, L.camp.y - 90, { weapons: ['smg', 'shotgun'], roam: 170, spread: 70 }));
      const brask = h.enemy(L.brask.x, L.brask.y, { name: 'Brask', boss: true, hp: 240, shield: 60, weapons: ['rifle'], roam: 90, spread: 30 });
      return [
        { type: 'reach', at: L.camp, r: 560, label: 'Logging Camp', text: 'Find the Logging Camp' },
        { type: 'kill', targets: [brask], text: 'Eliminate Quartermaster Brask', say: [['Atlas', 'That is him, by the command tent. Escort is ' + escort.length + ' strong. Your call how.']] },
        { type: 'reach', at: L.lz, r: 105, label: 'Ranger Station', limit: 60, failText: 'The helicopter could not wait', text: 'Reach the Ranger Station helipad',
          say: [['Atlas', 'Target down. Every unit in Greywood just woke up. Ranger Station, far west. Run.']],
          onStart() { h.squad(4, L.lz.x + 500, L.lz.y + 300, { weapons: ['smg', 'pistol'], roam: 900, from: 500, hunt: true }); } },
      ];
    },
  },
  {
    id: 'm4', name: 'Fuel Run', kind: 'Escort', theme: 'desert', size: 6000, allies: 1, cars: 5, seed: 404,
    chapter: 'Chapter Four', place: 'The Saltway, noon',
    brief: 'Steal the fuel truck from the Guard Motor Pool and drive it down the Saltway to our depot.',
    story: [
      'Dray\'s armour drinks fuel, and since Brask died nobody is ordering more. What is left sits in one truck in the Guard Motor Pool at the top of the Saltway.',
      'Steal it. The Saltway runs east past Checkpoint Alpha, turns south at the junction, and passes Bravo and Charlie before it reaches the Resistance Depot. Lynx is riding shotgun.',
      'The checkpoints have barriers across the road. The truck goes through barriers. It does not go through much else, and if it burns, so does the plan.',
    ],
    objectives: ['Get into the Guard Motor Pool and take the fuel truck', 'Drive down the Saltway through the checkpoints', 'Park the truck inside the Resistance Depot'],
    debrief: 'Their tanks are parked and ours are fuelled. With no armour, the Guard is pulling everything back to the Atoll to break out by sea.',
    intro: [['Atlas', 'The motor pool is the fenced yard south of the road. The truck is inside.'], ['Atlas', 'Shooters at every checkpoint. Do not stop for them.']],
    map(b) {
      b.road(0, 640, 4760, 150); b.road(4610, 640, 150, 4700); b.road(4610, 5190, 1390, 150);
      // guard motor pool
      const mp = b.room(220, 880, 720, 540, { n: 0.4 }, { T: 12, D: 190, floor: 'rgba(90,80,62,0.5)' });
      b.building(260, 1200, 270, 170);
      for (const y of [980, 1090, 1200]) b.solid('tank', 830, y, 40);
      b.crate(300, 930); b.crate(352, 936); b.crate(640, 1330);
      b.label('GUARD MOTOR POOL', 580, 1480, 40);
      const cps = [b.checkpoint(2400, 640, true, 'CHECKPOINT ALPHA'), b.checkpoint(4610, 2500, false, 'CHECKPOINT BRAVO'), b.checkpoint(4610, 4100, false, 'CHECKPOINT CHARLIE')];
      // a town off the road
      b.label('DRY WELLS', 3200, 1380, 40);
      for (const [x, y, w, h] of [[2900, 1460, 220, 160], [3200, 1440, 180, 200], [3460, 1500, 200, 150], [3000, 1720, 240, 150], [3340, 1740, 190, 170]]) b.building(x, y, w, h);
      b.solid('fountain', 3270, 1680, 34); b.keepout(2820, 1300, 920, 660);
      // resistance depot
      const dp = b.room(5140, 5420, 720, 470, { n: 0.5 }, { T: 14, D: 220, floor: 'rgba(80,90,70,0.5)' });
      b.building(5180, 5700, 220, 150); b.solid('tank', 5760, 5540, 40); b.solid('tank', 5760, 5650, 40); b.crate(5200, 5470); b.crate(5252, 5476);
      b.prop('helipad', 5500, 5640, 90); b.label('RESISTANCE DEPOT', 5500, 5950, 38);
      b.keepout(0, 420, 1100, 1140); b.keepout(4900, 5100, 1100, 900);
      b.scatter('rock', 300, 0, 0, 6000, 6000); b.scatter('tree', 150, 0, 0, 6000, 6000); b.scatter('crate', 60, 0, 0, 6000, 6000); b.scatter('building', 30, 0, 1900, 4300, 4000);
      b.decor(900);
      return { start: { x: 520, y: 520 }, pool: { x: mp.cx, y: mp.cy }, truck: { x: 500, y: 1060 }, cps, depot: { x: dp.cx, y: dp.cy } };
    },
    build(h, game, L) {
      const truck = h.vehicle('truck', L.truck.x, L.truck.y, 1300, -Math.PI / 2);
      h.squad(3, L.pool.x + 60, L.pool.y + 40, { weapons: ['pistol', 'smg'], roam: 150, spread: 90 });
      for (const c of L.cps) h.squad(3, c.x, c.y, { weapons: ['smg', 'rifle', 'pistol'], roam: 200, spread: 90 });
      return [
        { type: 'reach', at: truck, r: 110, label: 'Fuel truck', text: 'Take the fuel truck from the Guard Motor Pool', follow: true },
        { type: 'deliver', car: truck, at: L.depot, r: 230, label: 'Resistance Depot', text: 'Drive the fuel truck to the Resistance Depot', say: [['Atlas', 'East along the Saltway, then south at the junction. Stay on the road, it is faster.']] },
      ];
    },
  },
  {
    id: 'm5', name: 'Hold Fast', kind: 'Defence', theme: 'island', size: 2800, allies: 3, seed: 505,
    chapter: 'Chapter Five', place: 'The Atoll, dusk',
    brief: 'Light the Lighthouse so our boats can find the island, then hold it until they land.',
    story: [
      'No fuel, no quartermaster, no secrets. The Guard is finished in the valley and it knows it. Dray has ordered everything he has left to the Atoll, to break out by sea and come back with an army.',
      'Our boats can stop them, if they can find the island in the dark. The old Lighthouse in the middle has not been lit in ten years. You, Koda, Lynx and a fisherman called Rex are going to light it.',
      'The moment it burns, every landing party on the North, East and West beaches will come straight for it. Hold the Lighthouse for eighty seconds. That is all the boats need.',
    ],
    objectives: ['Climb from the Fishing Village to the Lighthouse', 'Light the lamp', 'Hold the Lighthouse for 80 seconds against the landings (supplies arrive by the lamp between waves)'],
    debrief: 'The boats made it. The breakout failed on the beaches, and what is left of the Ashen Guard has fallen back behind the walls of Fortress Dray. There is one name left in the ledger.',
    intro: [['Atlas', 'Lighthouse is dead centre of the island, straight north of the village.'], ['Atlas', 'Once it is lit they will come from the beaches. All of them.']],
    map(b) {
      b.pad(1200, 1200, 400, 400, 'rgba(120,120,126,0.6)');
      b.solid('beacon', 1400, 1400, 46);
      b.box('sandbag', 1250, 1160, 300, 24); b.box('sandbag', 1250, 1616, 300, 24); b.box('sandbag', 1160, 1250, 24, 300); b.box('sandbag', 1616, 1250, 24, 300);
      b.crate(1270, 1270); b.crate(1486, 1270); b.crate(1270, 1486); b.crate(1486, 1486);
      b.label('LIGHTHOUSE', 1400, 1100, 40); b.keepout(1060, 1040, 680, 700);
      b.building(1150, 2200, 160, 130); b.room(1370, 2210, 210, 160, { n: 0.5 }, { D: 90 }); b.building(1640, 2200, 150, 140); b.building(1250, 2400, 150, 110);
      b.pad(1470, 2440, 110, 260, 'rgba(120,90,55,0.8)'); b.crate(1600, 2420); b.crate(1100, 2380);
      b.label('FISHING VILLAGE', 1400, 2130, 38); b.keepout(1050, 2000, 820, 720);
      b.label('NORTH BEACH', 1400, 300, 36); b.label('EAST BEACH', 2400, 1330, 36); b.label('WEST BEACH', 400, 1330, 36);
      b.keepout(1150, 120, 500, 380); b.keepout(2200, 1150, 480, 500); b.keepout(120, 1150, 480, 500);
      b.scatter('tree', 170, 0, 0, 2800, 2800); b.scatter('rock', 45, 0, 0, 2800, 2800); b.scatter('crate', 26, 0, 0, 2800, 2800);
      b.decor(220);
      return { start: { x: 1400, y: 2060 }, beacon: { x: 1400, y: 1400 }, lamp: { x: 1400, y: 1490 }, beaches: [{ x: 1400, y: 300 }, { x: 2440, y: 1400 }, { x: 360, y: 1400 }] };
    },
    build(h, game, L) {
      let n = 0;
      return [
        { type: 'reach', at: L.beacon, r: 230, label: 'Lighthouse', text: 'Get up to the Lighthouse' },
        { type: 'hold', at: L.lamp, time: 3, verb: 'light the lamp', label: 'Lighthouse', text: 'Light the Lighthouse lamp' },
        { type: 'survive', at: L.beacon, time: 80, every: 19, label: 'Lighthouse', text: 'Hold the Lighthouse until the boats land',
          say: [['Atlas', 'She is lit! Boats are eighty seconds out. Hold on.']],
          wave() {
            const bch = L.beaches[n % 3], names = ['North Beach', 'East Beach', 'West Beach'];
            h.say('Atlas', 'Landing party on ' + names[n % 3] + '!');
            n++;
            for (const a of h.squad(n < 3 ? 2 : 3, bch.x, bch.y, { weapons: n > 3 ? ['rifle', 'smg'] : n > 1 ? ['smg', 'pistol'] : ['pistol'], roam: 200, spread: 130, hunt: true })) a.brain.post = { x: L.beacon.x, y: L.beacon.y, r: 220 };
            // between landings the squad patches up and a crate of supplies is broken open by the lamp
            for (const a of game.actors) if (a.alive && a.team === 0) { a.hp = Math.min(a.maxHp, a.hp + 35); a.shield = Math.min(a.maxShield, a.shield + 25); }
            if (n > 1) for (const kind of ['medkit', 'ammo', 'shield']) game.dropLoot(L.lamp.x + U.rand(-70, 70), L.lamp.y + U.rand(10, 70), kind);
          } },
      ];
    },
  },
  {
    id: 'm6', name: 'Kingfall', kind: 'Breach and assassination', theme: 'grass', size: 3600, allies: 3, cars: 3, seed: 606,
    chapter: 'Chapter Six', place: 'Fortress Dray, before dawn',
    brief: 'Breach Fortress Dray, end the Marshal in his Keep, and get clear before the shells land.',
    story: [
      'Marshal Dray built his fortress on the hill above Ashford the week he arrived, as if he already knew he would need somewhere to make a last stand. He is in the Keep now, with what is left of his guard around him.',
      'You have the whole squad, the last breaching charge, and three weeks of the valley\'s anger. The gate is in the south wall, at the top of the road from the Forward Camp. Same as the depot, only angrier.',
      'One more thing. Dray has ordered his own artillery to level the fortress if he falls, so nothing in it can be used against him at a trial. When he drops, you have under a minute to reach LZ Echo.',
    ],
    objectives: ['Fight up the road to the fortress gate', 'Plant the breaching charge', 'Eliminate Marshal Dray in the Keep', 'Reach LZ Echo within 55 seconds'],
    debrief: 'Dray is dead and the Ashen Guard died with him. By noon the roads are open and the relay is playing music. Atlas turns out to be a retired schoolteacher called Maren, and she says to take a week off. You both know you will not.',
    intro: [['Atlas', 'This is the last one, Wren. Dray is inside and he knows you are coming.'], ['Atlas', 'Take the road east, then north up the hill. The gate is in the south wall.']],
    map(b) {
      b.road(0, 3050, 3600, 150); b.road(2325, 1640, 150, 1410);
      b.pad(240, 3240, 520, 280, 'rgba(110,100,80,0.35)'); b.prop('fire', 500, 3380, 24);
      for (const [x, y] of [[270, 3260], [620, 3260], [280, 3420]]) b.box('tent', x, y, 110, 80, '#5d6b4d');
      b.crate(640, 3430); b.crate(692, 3436); b.label('FORWARD CAMP', 500, 3560, 36); b.keepout(180, 3200, 660, 400);
      // fortress
      const f = b.compound(2400, 1200, 920, 780, 's');
      for (const [x, y] of [[1912, 782], [2888, 782], [1912, 1618], [2888, 1618]]) b.solid('tower', x, y, 30);
      const keep = b.room(2215, 870, 370, 260, { s: 0.5 }, { D: 120, floor: 'rgba(70,50,60,0.6)' });
      b.box('console', keep.cx - 32, keep.y + 30, 64, 28);
      b.building(1990, 880, 150, 300); b.building(2660, 880, 150, 300);
      for (const [x, y] of [[2040, 1400], [2092, 1400], [2700, 1400], [2752, 1400], [2180, 1250], [2580, 1250]]) b.crate(x, y, 46);
      b.label('FORTRESS DRAY', 2400, 740, 44); b.label('KEEP', keep.cx, keep.cy + 40, 30);
      b.box('sandbag', 2180, 1830, 130, 24); b.box('sandbag', 2490, 1830, 130, 24); b.keepout(2100, 1640, 600, 400);
      // Ashford, the village under the hill
      b.label('ASHFORD', 1150, 2060, 40);
      b.room(900, 2140, 260, 200, { s: 0.5 }); b.building(1220, 2130, 200, 170); b.building(940, 2420, 220, 150); b.room(1230, 2380, 230, 190, { w: 0.5 });
      b.solid('fountain', 1180, 2350, 30); b.keepout(820, 2000, 760, 660);
      b.prop('helipad', 450, 450, 110); b.label('LZ ECHO', 450, 290, 38); b.keepout(270, 250, 380, 400);
      b.scatter('tree', 300, 0, 0, 3600, 3600); b.scatter('rock', 65, 0, 0, 3600, 3600); b.scatter('crate', 40, 0, 0, 3600, 3600);
      b.decor(300);
      return { start: { x: 520, y: 3160 }, fort: f, keep: { x: keep.cx, y: keep.cy + 30 }, outpost: { x: 2400, y: 1920 }, ashford: { x: 1190, y: 2360 }, lz: { x: 450, y: 450 } };
    },
    build(h, game, L) {
      const f = L.fort;
      const guards = h.squad(2, f.x - 250, f.y + 230, { weapons: ['rifle', 'smg', 'shotgun'], roam: 150, spread: 90 })
        .concat(h.squad(2, f.x + 250, f.y + 230, { weapons: ['smg', 'shotgun'], roam: 150, spread: 90 }), h.squad(2, f.x, f.y + 120, { weapons: ['smg', 'rifle'], roam: 110, spread: 70 }));
      const dray = h.enemy(L.keep.x, L.keep.y, { name: 'Marshal Dray', boss: true, hp: 420, shield: 100, weapons: ['rifle', 'shotgun'], roam: 80, spread: 40 });
      h.squad(2, L.outpost.x, L.outpost.y, { weapons: ['smg', 'pistol'], roam: 180 });
      h.squad(2, L.ashford.x, L.ashford.y, { weapons: ['smg', 'pistol'], roam: 220 });
      return [
        { type: 'reach', at: f.gate.out, r: 330, label: 'Fortress gate', text: 'Fight up the road to the fortress gate' },
        { type: 'breach', compound: f, time: 3, text: 'Plant the charge on the fortress gate', say: [['Atlas', 'You know the drill. Set it and get back.']] },
        { type: 'kill', targets: [dray], text: 'Eliminate Marshal Dray in the Keep', say: [['Dray', 'So you are the ghost they sent. Come in, then.']] },
        { type: 'reach', at: L.lz, r: 115, label: 'LZ Echo', limit: 55, failText: 'The artillery found you', text: 'Get to LZ Echo before the shells land',
          say: [['Atlas', 'He is down! Guard artillery is ranging the fortress. LZ Echo, north-west. Move!']],
          onStart() { for (const g of guards) if (g.alive) g.brain.post = null; } },
      ];
    },
  },
];

const Campaign = {
  // The mission's map, built from scratch (also used to draw it on the briefing screen).
  world(idx, loot) {
    const m = CAMPAIGN[idx];
    return new World(MAPS[m.theme], { size: m.size, loot: !!loot, fixedZone: true, custom: (w) => m.map(new MapBuilder(w, m.seed)) });
  },

  // ---------------------------------------------------------------- setup
  setup(game, idx) {
    const m = CAMPAIGN[idx], p = game.player, L = game.world.sites;
    const c = game.camp = { idx, m, i: 0, stages: [], radio: [], fail: '', enemies: [], first: false, radioShown: false, lastPlace: null };
    const h = this.helpers(game, c);
    p.x = L.start.x; p.y = L.start.y; p.meds = Math.max(p.meds, 2);
    for (const a of game.actors) if (a !== p) { const q = game.spotNear(p.x, p.y, 50, 170, a.r) || p; a.x = q.x; a.y = q.y; a.shield = Math.max(a.shield, 50); a.meds = 2; }
    c.stages = m.build(h, game, L);
    game.renderer.camX = p.x; game.renderer.camY = p.y;
    game.flashBanner(m.chapter.toUpperCase() + ' - ' + m.name.toUpperCase(), true, 2.8);
    for (const l of m.intro || []) this.say(game, l[0], l[1]);
  },

  helpers(game, c) {
    const w = game.world;
    // One enemy soldier posted around (x, y). o: name, weapons (pick one; bosses carry all), hp, shield, roam
    // (post radius), spread (how far from the point they may start), boss, from (start this far away and walk
    // in), hunt (chases gunfire).
    const enemy = (x, y, o = {}) => {
      let pos = null;
      if (o.from) for (let t = 0; t < 40 && !pos; t++) {
        const a = U.rand(0, Math.PI * 2), q = { x: x + Math.cos(a) * o.from, y: y + Math.sin(a) * o.from };
        if (w.inBounds(q.x, q.y, 40) && !w.circleBlocked(q.x, q.y, 26) && U.dist(q.x, q.y, game.player.x, game.player.y) > 480) pos = q;
      }
      pos = pos || game.spotNear(x, y, 0, o.spread || 130, 20) || { x, y };
      const a = new Actor(pos.x, pos.y, o.name || U.pick(BOT_NAMES), GUARD_SKIN.color, false);
      a.team = 1; a.skin = GUARD_SKIN; a.noLoot = true;
      a.weapons = (o.boss ? o.weapons || ['rifle'] : [U.pick(o.weapons || ['smg'])]).map((k) => { const wp = makeWeapon(k); wp.reserve = wp.ammoPickup * 4; return wp; });
      a.wi = 0;
      const br = new BotBrain(a);
      game.toughenBot(a, br);
      br.post = { x, y, r: o.roam || 160 }; br.likesCars = false; br.noCarUntil = Infinity; br.hunter = br.hunter || !!o.hunt;
      a.brain = br;
      if (o.hp) { a.maxHp = o.hp; a.hp = o.hp; }
      if (o.shield !== undefined) a.shield = o.shield;
      if (o.boss) { a.boss = true; a.r = 21; a.skin = BOSS_SKIN; a.color = BOSS_SKIN.color; a.meds = 2; }
      game.actors.push(a); game.brains.push(br); c.enemies.push(a);
      return a;
    };
    const squad = (n, x, y, o) => { const out = []; for (let i = 0; i < n; i++) out.push(enemy(x, y, o)); return out; };
    const vehicle = (kind, x, y, hp, angle) => {
      const v = new Vehicle(x, y, VEHICLES[kind]);
      if (hp) { v.hp = hp; v.maxHp = hp; }
      if (angle !== undefined) v.angle = angle;
      game.vehicles = game.vehicles.filter((o) => U.dist(o.x, o.y, x, y) > 200);
      game.vehicles.push(v);
      return v;
    };
    return { enemy, squad, vehicle, say: (who, text) => this.say(game, who, text) };
  },

  // ---------------------------------------------------------------- radio
  say(game, who, text) { if (game.camp) game.camp.radio.push({ who, text, t: 2.6 + text.length * 0.05 }); },
  tickRadio(game, dt) {
    const c = game.camp, el = game.$('radio'), cur = c.radio[0];
    if (!cur) { if (c.radioShown) { el.classList.add('hidden'); c.radioShown = false; } return; }
    if (!cur.shown) {
      cur.shown = true; c.radioShown = true;
      el.innerHTML = '<b>' + cur.who + '</b>' + cur.text; el.classList.remove('hidden');
      Sound.tone(980, 0.05, 0.06, 'square'); Sound.tone(740, 0.05, 0.05, 'square');
    }
    cur.t -= dt;
    if (cur.t <= 0) c.radio.shift();
  },
  // Walking into a named place announces it once.
  tickPlace(game) {
    const c = game.camp, p = game.player;
    let near = null, bd = 380;
    for (const l of game.world.labels) { const d = U.dist(p.x, p.y, l.x, l.y + 200); if (d < bd) { bd = d; near = l; } }
    if (near && near !== c.lastPlace) { c.lastPlace = near; game.notify(p, near.text); }
  },

  // ---------------------------------------------------------------- stages
  stage(game) { const c = game.camp; return c ? c.stages[c.i] || null : null; },
  left(st) { let n = 0; for (const t of st.targets) if (t.alive) n++; return n; },
  // Holding E on the spot. Progress resets if the player lets go, walks off or gets in a car.
  holding(game, st, at, r, dt) {
    const p = game.player;
    const on = !p.car && game.holdingE && U.dist(p.x, p.y, at.x, at.y) < r;
    st.p = on ? (st.p || 0) + dt : 0;
    p.actionProgress = st.p / st.time;
    return st.p >= st.time;
  },

  update(game, dt) {
    const c = game.camp; if (!c) return;
    this.tickRadio(game, dt);
    const p = game.player;
    if (!p.alive) return this.fail(game, 'You were killed');
    if (Math.floor(game.time * 4) !== Math.floor((game.time - dt) * 4)) this.tickPlace(game);
    const st = c.stages[c.i]; if (!st) return;
    if (!st.started) {
      st.started = true; st.t = 0;
      if (st.onStart) st.onStart(game);
      for (const l of st.say || []) this.say(game, l[0], l[1]);
    }
    st.t += dt;
    if (st.limit && st.t > st.limit) return this.fail(game, st.failText || 'Out of time');
    let done = false;
    switch (st.type) {
      case 'reach': done = U.dist(p.x, p.y, st.at.x, st.at.y) < (st.r || 120); break;
      case 'kill': case 'clear': done = this.left(st) === 0; break;
      case 'hold': done = this.holding(game, st, st.at, 85, dt); break;
      case 'breach': {
        const g = st.compound.gate;
        if (st.fuse === undefined) {
          if (this.holding(game, st, g.out, 95, dt)) { st.fuse = 4; p.actionProgress = 0; game.notify(p, 'Charge set - get clear!'); Sound.zone(); }
        } else {
          const before = st.fuse; st.fuse -= dt;
          if (Math.floor(st.fuse * 3) !== Math.floor(before * 3)) Sound.tone(1200, 0.05, 0.12, 'square');
          if (st.fuse <= 0) {
            game.bombBlast = true; game.explode(g.x, g.y, 120, null, null, 200); game.bombBlast = false;
            game.renderer.shake = 20;
            game.world.removeObstacle(g.ob);
            done = true;
          }
        }
        break;
      }
      case 'survive':
        if (st.next === undefined) st.next = 2;
        if (st.wave && st.t >= st.next && st.t < st.time - 6) { st.next += st.every || 15; st.wave(game); }
        done = st.t >= st.time;
        break;
      case 'deliver':
        if (!st.car.alive) return this.fail(game, 'The ' + st.car.name.toLowerCase() + ' was destroyed');
        done = U.dist(st.car.x, st.car.y, st.at.x, st.at.y) < (st.r || 160);
        break;
    }
    if (!done) return;
    p.actionProgress = 0;
    c.i++;
    if (c.i >= c.stages.length) return this.complete(game);
    game.notify(p, 'Objective complete');
    Sound.kill();
  },

  fail(game, reason) { game.camp.fail = reason; game.endGame(false); },
  complete(game) {
    const c = game.camp, d = Progress.data.campaign;
    c.first = !d.done.includes(c.m.id);
    if (c.first) d.done.push(c.m.id);
    d.unlocked = Math.max(d.unlocked, Math.min(CAMPAIGN.length - 1, c.idx + 1));
    Progress.data.prefs.mission = Math.min(CAMPAIGN.length - 1, c.idx + 1);
    game.endGame(true);
  },

  // HUD line for the current objective.
  text(game) {
    const st = this.stage(game); if (!st) return '';
    let s = st.text || '';
    if (st.type === 'breach' && st.fuse !== undefined) s = 'Charge set - get clear! ' + Math.ceil(st.fuse);
    else if (st.type === 'kill' || st.type === 'clear') { const n = this.left(st); if (st.type === 'clear' || n > 1) s += ' (' + n + ' left)'; }
    else if (st.type === 'survive') s += ' - ' + U.fmtTime(st.time - st.t);
    if (st.limit) s += ' - ' + U.fmtTime(st.limit - st.t);
    return s;
  },
  // "Hold [E] to ..." when the player is standing on a hold / breach spot.
  prompt(game) {
    const st = this.stage(game), p = game.player; if (!st || p.car) return '';
    if (st.type === 'hold' && U.dist(p.x, p.y, st.at.x, st.at.y) < 85) return 'Hold [E] to ' + st.verb;
    if (st.type === 'breach' && st.fuse === undefined && U.dist(p.x, p.y, st.compound.gate.out.x, st.compound.gate.out.y) < 95) return 'Hold [E] to plant the charge';
    return '';
  },
  // Where the objective markers go: [{ x, y, r, label, hot }]
  marks(game) {
    const st = this.stage(game), out = []; if (!st) return out;
    switch (st.type) {
      case 'reach': out.push({ x: st.at.x, y: st.at.y, r: st.follow ? 60 : Math.min(st.r || 120, 130), label: st.label || 'Objective' }); break;
      case 'hold': out.push({ x: st.at.x, y: st.at.y, r: 70, label: st.label || 'Objective' }); break;
      case 'breach': { const g = st.compound.gate; if (st.fuse === undefined) out.push({ x: g.out.x, y: g.out.y, r: 80, label: 'Gate' }); else out.push({ x: g.x, y: g.y, r: 200, label: 'Charge ' + Math.ceil(st.fuse), hot: true }); break; }
      case 'kill': for (const t of st.targets) if (t.alive) out.push({ x: t.x, y: t.y, r: 46, label: t.name, hot: true }); break;
      case 'clear': if (this.left(st) <= 3) for (const t of st.targets) if (t.alive) out.push({ x: t.x, y: t.y, r: 40, label: '', hot: true }); break;
      case 'survive': out.push({ x: st.at.x, y: st.at.y, r: 200, label: st.label || 'Hold' }); break;
      case 'deliver':
        if (game.player.car === st.car) out.push({ x: st.at.x, y: st.at.y, r: Math.min(st.r || 160, 150), label: st.label || 'Destination' });
        else out.push({ x: st.car.x, y: st.car.y, r: 60, label: st.car.name });
        break;
    }
    return out;
  },
};
