'use strict';
// War: two armies of 40 fight over five positions strung across a trench battlefield.
//
//   The field   West HQ - West Trench (A) - Windmill Ridge (B) - Hollow Cross (C) - Iron Works (D) - East Trench (E) - East HQ
//               built by War.build with the campaign's MapBuilder; the east half is the west half rotated 180 degrees.
//   Positions   A side may only capture the position next to the ones it already holds, so there is always one front.
//               A position is a wide sector of the front (pt.hx by pt.hy either side of its flag), so the fight
//               spreads along the trench line. Standing in it moves it; more soldiers move it faster. All five wins.
//   Offensives  The battle moves in phases (War.tickPhase): an opening race for the middle, then lulls in which most
//               soldiers hold their line, broken by offensives. The armies take turns: a whistle, a barrage on the
//               target, and nearly everyone goes over the top while the other army digs in to stop them.
//   Tickets     Every death costs the army one reinforcement, and holding fewer positions bleeds them. Zero loses.
//   Trenches    Soldiers standing in a trench are missed by most bullets fired from further than 140px away
//               (Actor.cover, checked in Bullet.update) and take half damage from blasts (Game.explode).
//   Wire        Slows anyone on foot. Tanks flatten it, along with sandbags and crates.
//   Tanks       WAR_VEHICLES.tank: armoured against bullets, a cannon and a machine gun on a turret that follows the
//               driver's aim. MG nests are the same thing with no engine and no cannon.
//   Support     Grenades (G), an artillery fire mission (T), resupply and tank repair inside any position you hold.
// Bots are ordinary BotBrains: War.objectiveFor sends each one to the position its army is attacking or defending.

const WAR_SIDES = [
  { name: 'Coalition', color: '#4f86d9', accent: '#2c5aa3', css: '#6aa5ff', rgb: '106,165,255', hull: '#5f7352', tent: '#5d6f58' },
  { name: 'Dominion', color: '#c9483f', accent: '#8a2e27', css: '#ff6b5e', rgb: '255,107,94', hull: '#77706a', tent: '#7d5a50' },
];
// armor: fraction of bullet damage that gets through. gun: cannon / mg = seconds between shots, muzzle = barrel length.
const WAR_VEHICLES = {
  tank: { id: 'tank', name: 'Tank', seats: 1, hp: 1200, max: 250, accel: 190, turn: 1.7, len: 100, wid: 58, r: 38, armor: 0.12, crush: true, offroad: true, gun: { cannon: 3.2, mg: 0.11, muzzle: 64 } },
  nest: { id: 'nest', name: 'MG Nest', seats: 1, hp: 420, max: 0, accel: 0, turn: 0, len: 64, wid: 64, r: 30, armor: 0.5, gun: { mg: 0.085, muzzle: 36 } },
};
const WAR_GUN = { key: 'shell', name: 'Tank Shell', dmg: 140, speed: 950, range: 1250, color: '#ffd27a', kind: 'rocket', splash: 60, radius: 110 };
const WAR_MG = { key: 'mg', name: 'Machine Gun', dmg: 12, speed: 980, range: 820, color: '#f6c344' };
const WAR_CLASSES = [
  { v: { id: 'rifleman', guns: ['rifle'] }, w: 40 },
  { v: { id: 'assault', guns: ['smg', 'shotgun'] }, w: 22 },
  { v: { id: 'gunner', guns: ['lmg'] }, w: 14 },
  { v: { id: 'marksman', guns: ['sniper'] }, w: 9 },
  { v: { id: 'at', guns: ['rocket', 'smg'] }, w: 15 },
];
// wave: seconds between each army's reinforcement waves (default 10). The side storming a last trench gets its men
// back sooner than the side holding it, or the trench would never fall.
// allOut: the army whose every offensive is smoke, barrage and an extra tank together (it is storming a last trench).
// Battle types. owners: who starts with A-E (-1 = nobody). tickets: multiplier per army. bleed: holding fewer
// positions costs reinforcements. timeout: who wins when the clock runs out ('count' = whoever has more left).
const WAR_BATTLES = {
  front:   { id: 'front', name: 'Frontline', desc: 'Two positions each and a race for the middle. The armies trade offensives.', owners: [0, 0, -1, 1, 1], tickets: [1, 1], bleed: true, timeout: 'count' },
  assault: { id: 'assault', name: 'Breakthrough', desc: 'You hold four positions and they are down to their last trench. Storm it, or bleed them dry, before the clock or your army runs out.', owners: [0, 0, 0, 0, 1], tickets: [2, 1], wave: [5, 16], allOut: 0, bleed: false, timeout: 'lose', duration: 780 },
  defend:  { id: 'defend', name: 'Last Stand', desc: 'They hold four positions and you are down to your last trench. Lose it and it is over. Hold for twelve minutes.', owners: [0, 1, 1, 1, 1], tickets: [1, 2], wave: [16, 5], allOut: 1, bleed: false, timeout: 'win', duration: 720 },
};
// locked: positions that cannot change hands. score: no reinforcements; holding the middle earns a point a second and
// this many wins. brawl: no lulls or offensives, most of both armies go for the objective all the time.
// size: soldiers per army. tanks: how many each army keeps in the field (default 2); tankEvery / reservedEvery:
// seconds until a new one, and until the player's own is replaced. arty: false = no artillery or aircraft.
WAR_BATTLES.hill = { id: 'hill', name: 'Hill Fight', desc: 'One position in the middle and both armies want it. No lines, no lulls. First army to hold it for three minutes in total wins.', owners: [0, 0, -1, 1, 1], locked: [1, 1, 0, 1, 1], score: 180, brawl: true, wave: [6, 6], tickets: [1, 1], bleed: false, timeout: 'count', duration: 720 };
WAR_BATTLES.raid = { id: 'raid', name: 'Night Raid', desc: 'Twelve against twelve in the dark. No tanks, no artillery, no aircraft. Take the three positions between the main lines, or outlast them.', owners: [0, 0, -1, 1, 1], locked: [1, 0, 0, 0, 1], size: 12, sky: 'night', tanks: 0, arty: false, tickets: [0.3, 0.3], bleed: true, timeout: 'count', duration: 540 };
WAR_BATTLES.armour = { id: 'armour', name: 'Tank Battle', desc: 'Both armies bring their armour: five tanks a side with more arriving all the time, and yours is replaced twelve seconds after you lose it.', owners: [0, 0, -1, 1, 1], tanks: 5, tankEvery: 10, reservedEvery: 12, tickets: [1, 1], bleed: true, timeout: 'count' };
const WAR_BATTLE_ORDER = ['front', 'assault', 'defend', 'hill', 'raid', 'armour'];
// What the player carries. C cycles through them (War.changeKit).
const WAR_KITS = [
  { id: 'rifleman', name: 'Rifleman', guns: ['rifle'], grenades: 4, tip: 'rifle and four grenades' },
  { id: 'assault', name: 'Assault', guns: ['smg', 'shotgun'], shield: 80, tip: 'SMG, shotgun and heavy armour' },
  { id: 'gunner', name: 'Machine Gunner', guns: ['lmg'], tip: 'a 60-round belt' },
  { id: 'marksman', name: 'Marksman', guns: ['sniper'], tip: 'one shot, long range' },
  { id: 'at', name: 'Anti-Tank', guns: ['rocket', 'smg'], rockets: 6, tip: 'six rockets for their armour' },
  { id: 'medic', name: 'Medic', guns: ['smg'], meds: 5, heal: true, tip: 'five medkits, and soldiers near you heal' },
];
// How an offensive goes in. mine / foe: the banner when it is yours or theirs.
const WAR_PUSHES = [
  { v: { id: 'infantry', mine: 'OVER THE TOP', foe: 'ENEMY OFFENSIVE' }, w: 40 },
  { v: { id: 'armour', mine: 'ARMOURED THRUST', foe: 'ENEMY ARMOUR' }, w: 20 },
  { v: { id: 'barrage', mine: 'CREEPING BARRAGE', foe: 'INCOMING BARRAGE' }, w: 20 },
  { v: { id: 'smoke', mine: 'SMOKE ASSAULT', foe: 'ENEMY SMOKE ATTACK' }, w: 20 },
];
const WAR_SKIES = [{ name: '', tint: null }, { name: '', tint: null }, { name: 'Dusk', tint: 'rgba(255,120,40,0.13)' }, { name: 'Night', tint: 'rgba(8,14,48,0.36)' }, { name: 'Overcast', tint: 'rgba(120,130,145,0.16)' }, { name: 'Dawn', tint: 'rgba(255,190,150,0.11)' }];
const WAR_NAMES = {
  west: ['West Trench', 'Linden Line', 'Sunset Line', 'Mud Lane'], east: ['East Trench', 'Harrow Line', 'Dawn Line', 'Cinder Lane'],
  farm: ['Windmill Ridge', 'Mill Farm', 'Orchard Hill'], quarry: ['Stone Quarry', 'Slate Pit', 'Grey Cut'], bunkers: ['Iron Works', 'Redoubt Nine', 'The Bastion'],
  village: ['Hollow Cross', 'Ashby', 'Saint Varen'], fort: ['Fort Kessel', 'Star Redoubt', 'The Citadel'], wood: ['Black Wood', 'Crow Copse', 'Gallows Wood'], crossroads: ['Four Ways', 'Quarter Mile', 'Tollgate'],
};
const WAR_CRUSH = { crate: 1, sandbag: 1 }; // what a tank drives straight through

const War = {
  // ---------------------------------------------------------------- the battlefield
  world(map, mode) {
    const theme = Object.assign({}, map, { shape: 'square', layout: 'towns', border: map.border || '#2a2a2a' });
    return new World(theme, { size: mode.width, height: mode.height, loot: false, fixedZone: true, custom: (w) => War.build(new MapBuilder(w, (Math.random() * 1e9) | 0)) });
  },

  build(b) {
    const w = b.w, W = w.w, H = w.h, flip = b.rnd() < 0.5;
    // what changes from battle to battle: where the lines run, what the forward positions and the middle are, the names
    const mx = Math.round(b.r(1380, 1620)), fx = Math.round(b.r(2560, 2860)), fy = Math.round(b.r(520, 900));
    const F = War.force || {}; // tests can pin the terrain: War.force = { fwd, mid }
    const fwds = ['farm', 'quarry', 'bunkers'], mids = ['village', 'fort', 'wood', 'crossroads'];
    const fwd = fwds.includes(F.fwd) ? F.fwd : b.pick(fwds), mid = mids.includes(F.mid) ? F.mid : b.pick(mids);
    // s = 1 lays the same piece out for the east army (rotated 180 degrees about the middle of the map);
    // flip mirrors the whole field north-south, so the forward positions swap sides
    const R = (s, x, y, ww, hh) => { const r = s ? { x: W - x - ww, y: H - y - hh, w: ww, h: hh } : { x, y, w: ww, h: hh }; if (flip) r.y = H - r.y - r.h; return r; };
    const P = (s, x, y) => { const p = s ? { x: W - x, y: H - y } : { x, y }; if (flip) p.y = H - p.y; return p; };
    const inv = (v) => (v === undefined ? undefined : 1 - v);
    const doors = (s, d) => {
      let o = d;
      if (s) o = { n: inv(o.s), s: inv(o.n), e: inv(o.w), w: inv(o.e) };
      if (flip) o = { n: o.s, s: o.n, e: inv(o.e), w: inv(o.w) };
      return o;
    };
    const trench = (s, x, y, ww, hh) => { const r = R(s, x, y, ww, hh); w.trenches.push(r); b.keepout(r.x - 40, r.y - 40, r.w + 80, r.h + 80); };
    const wire = (s, x, y, ww, hh) => { const r = R(s, x, y, ww, hh); w.wire.push(r); b.keepout(r.x - 30, r.y - 30, r.w + 60, r.h + 60); };
    const bags = (s, x, y, ww, hh) => { const r = R(s, x, y, ww, hh); b.box('sandbag', r.x, r.y, r.w, r.h, '#b39a6b'); };
    const room = (s, x, y, ww, hh, d, o) => { const r = R(s, x, y, ww, hh); b.room(r.x, r.y, r.w, r.h, doors(s, d), o); };
    const house = (s, x, y, ww, hh) => { const r = R(s, x, y, ww, hh); b.building(r.x, r.y, r.w, r.h); };
    const crate = (s, x, y) => { const r = R(s, x, y, 44, 44); b.crate(r.x, r.y, 44); };
    b.road(0, H / 2 - 70, W, 140);
    if (mid === 'crossroads') b.road(W / 2 - 70, 0, 140, H);
    b.pad(mx + 350, 0, W - (mx + 350) * 2, H, 'rgba(74,54,34,0.3)'); // the churned mud of no man's land
    // A zigzag fire trench running north-south at x, with sandbags and a wire belt on the enemy side.
    const line = (s, x, y0, y1) => {
      let i = 0;
      for (let y = y0; y < y1 - 10; y += 330, i++) {
        const xo = x - 35 + (i % 2 ? 70 : 0), hh = Math.min(330, y1 - y);
        trench(s, xo, y, 70, hh);
        if (y + hh < y1 - 10) trench(s, x - 35, y + hh - 70, 140, 70);
        const m = y + hh / 2;
        if (Math.abs(m - H / 2) < 230) continue; // the road stays open
        bags(s, xo + 92, m - 80, 24, 160);
        wire(s, x + 300, y + 20, 36, 130); wire(s, x + 300, y + 150, 36, 130);
      }
    };
    // pieces that are scattered at random are rolled once, so both armies get the same ones
    const quarry = [], wood = [];
    for (let i = 0; i < 11; i++) { const y = b.r(110, 880); if (Math.abs(y - 510) > 80) quarry.push([b.r(-440, -130), y, Math.round(b.r(24, 42))]); }
    for (let i = 0; i < 90 && wood.length < 30; i++) {
      const x = b.r(3390, 3790), y = b.r(1620, 2580);
      if (Math.abs(y - H / 2) < 125 || (x > 3530 && x < 3710 && y > 1940 && y < 2340) || wood.some((q) => U.dist(q[0], q[1], x, y) < 78)) continue;
      wood.push([x, y, Math.round(b.r(22, 38))]);
    }
    const nests = [], depots = [[], []];
    for (const s of [0, 1]) {
      const side = WAR_SIDES[s];
      for (const [tx, ty] of [[230, 1560], [430, 1560], [230, 1720], [230, 2390], [430, 2550], [230, 2550]]) { const r = R(s, tx, ty, 150, 96); b.box('tent', r.x, r.y, r.w, r.h, side.tent); }
      for (const [cx, cy] of [[470, 1740], [522, 1746], [470, 2400], [600, 1900], [600, 2260]]) crate(s, cx, cy);
      for (const py of [1560, 2310]) { const r = R(s, 700, py, 240, 330); b.pad(r.x, r.y, r.w, r.h, 'rgba(60,60,64,0.5)'); }
      depots[s] = [P(s, 820, 1640), P(s, 820, 1800), P(s, 820, 2400), P(s, 820, 2560)];
      const hk = R(s, 120, 1460, 900, 1280); b.keepout(hk.x, hk.y, hk.w, hk.h);
      const lb = P(s, 450, 1480); b.label(side.name.toUpperCase() + ' HQ', lb.x, lb.y, 40);
      // the main line, with two communication trenches leading back from it
      line(s, mx, 450, H - 450);
      trench(s, mx - 470, 1180, 440, 60); trench(s, mx - 470, 2960, 440, 60);
      nests.push(Object.assign(P(s, mx + 220, 1480), { pi: s ? 4 : 0 }), Object.assign(P(s, mx + 220, 2720), { pi: s ? 4 : 0 }));
      // the forward line, and whatever stands behind it
      line(s, fx, fy, fy + 990);
      trench(s, fx - 450, fy + 480, 420, 60);
      nests.push(Object.assign(P(s, fx + 200, fy + 495), { pi: s ? 3 : 1 }));
      if (fwd === 'farm') { house(s, fx - 370, fy + 180, 200, 150); const tw = P(s, fx - 230, fy + 760); b.solid('tower', tw.x, tw.y, 32); crate(s, fx - 150, fy + 230); }
      else if (fwd === 'quarry') for (const q of quarry) { const p = P(s, fx + q[0], fy + q[1]); b.solid('rock', p.x, p.y, q[2], b.map.rock); }
      else for (const k of [0, 1, 2]) { if (k === 1) continue; room(s, fx - 400, fy + 80 + k * 330, 200, 170, { e: 0.5 }); crate(s, fx - 180, fy + 130 + k * 330); }
      const fk = R(s, fx - 480, fy + 40, 440, 910); b.keepout(fk.x, fk.y, fk.w, fk.h);
      // this army's half of the middle
      trench(s, 3585, 1990, 70, 300);
      if (mid === 'village') {
        room(s, 3470, 1700, 260, 200, { s: 0.5, e: 0.5 }); house(s, 3880, 1690, 210, 170);
        const v3 = R(s, 3610, 1960, 130, 22); b.wall(v3.x, v3.y, v3.w, v3.h); crate(s, 3760, 1930);
      } else if (mid === 'fort') {
        for (const y of [1840, 2210]) bags(s, 3520, y, 24, 150);
        for (const k of [0, 1, 2]) bags(s, 3560 + k * 180, 1800, 150, 24);
        nests.push(Object.assign(P(s, 3690, 1900), { pi: 2 }));
        crate(s, 3760, 1930); crate(s, 3812, 1936); crate(s, 3900, 1870);
      } else if (mid === 'wood') {
        for (const q of wood) { const p = P(s, q[0], q[1]); b.solid('tree', p.x, p.y, q[2], b.pick(b.map.treeColors)); }
      } else {
        house(s, 3480, 1780, 200, 180); room(s, 3470, 2240, 210, 180, { n: 0.5, e: 0.5 }); crate(s, 3700, 1900); crate(s, 3640, 2200);
      }
    }
    b.keepout(3350, 1600, 900, 1000);
    const two = (arr) => { const i = Math.floor(b.rnd() * arr.length); return [arr[i], arr[(i + 1 + Math.floor(b.rnd() * (arr.length - 1))) % arr.length]]; };
    const fn = two(WAR_NAMES[fwd]);
    const names = [b.pick(WAR_NAMES.west), fn[0], b.pick(WAR_NAMES[mid]), fn[1], b.pick(WAR_NAMES.east)];
    const pos = [P(0, mx, H / 2), P(0, fx, fy + 495), { x: W / 2, y: H / 2 }, P(1, fx, fy + 495), P(1, mx, H / 2)];
    const points = pos.map((p, i) => ({ name: names[i], x: p.x, y: p.y }));
    for (const p of points) { b.keepout(p.x - 80, p.y - 80, 160, 160); b.label(p.name.toUpperCase(), p.x, p.y - 300, 38); }
    const n0 = mx + 400, nw = W - n0 * 2;
    b.scatter('tree', 90, 60, 60, mx - 200, H - 120); b.scatter('tree', 90, W - mx + 140, 60, mx - 200, H - 120);
    b.scatter('tree', 45, n0, 60, nw, 560); b.scatter('tree', 45, n0, H - 620, nw, 560);
    b.scatter('rock', 46, n0 - 200, 60, nw + 400, H - 120); b.scatter('crate', 26, n0, 200, nw, H - 400);
    for (let i = 0; i < 120; i++) b.prop('crater', b.r(n0, W - n0), b.r(60, H - 60), b.r(24, 66));
    b.decor(560);
    return { start: P(0, 300, H / 2), points, hq: [P(0, 450, H / 2), P(1, 450, H / 2)], depots, nests, layout: { flip, fwd, mid } };
  },

  // ---------------------------------------------------------------- setup
  setup(game) {
    const world = game.world, S = world.sites, mode = game.mode, t = game.time;
    const edge = 0.8 + 0.5 * Math.min(1.2, game.L || 0); // harder difficulties give the enemy more reinforcements
    const want = Progress.data.prefs.battle;
    const id = WAR_BATTLES[want] ? want : U.pick(WAR_BATTLE_ORDER.filter((k) => k !== game.lastBattle)); // Random never repeats the last one
    game.lastBattle = id;
    const B = WAR_BATTLES[id], F = War.force || {}, sky = WAR_SKIES.find((k) => k.name && k.name.toLowerCase() === (F.sky || B.sky)) || U.pick(WAR_SKIES);
    if (B.size) { // a small action: most of both armies sit this one out
      const kept = [0, 0];
      game.actors = game.actors.filter((a) => a.isPlayer || kept[a.team]++ < B.size - (a.team === game.player.team ? 1 : 0));
      game.brains = game.brains.filter((br) => game.actors.includes(br.bot));
    }
    const war = game.war = {
      id, battle: B, sky,
      points: S.points.map((p, i) => ({
        i, id: 'ABCDE'[i], name: p.name, x: p.x, y: p.y, n: [0, 0], r: 300,
        hx: i === 2 ? 430 : 320, hy: i === 2 ? 520 : i === 0 || i === 4 ? 800 : 600,
        owner: B.owners[i], cap: B.owners[i] === 0 ? 1 : B.owners[i] === 1 ? -1 : 0, // cap: +1 = fully the Coalition's, -1 = the Dominion's
        trench: [], last: B.owners[i], locked: !!(B.locked && B.locked[i]),
      })),
      tickets: [Math.round(mode.tickets * B.tickets[0]), Math.round(mode.tickets * edge * B.tickets[1])], bleed: 0, timeLeft: B.duration || mode.duration,
      cmd: WAR_SIDES.map((s, i) => ({ team: i, name: s.name + ' artillery', alive: false, isPlayer: false, kills: 0, lifesteal: 0, x: 0, y: 0 })),
      nades: [], shells: [], craters: [], artyAt: [t + U.rand(20, 28), t + U.rand(24, 32)], playerArty: t + 15,
      phase: B.brawl ? { kind: 'opening', team: -1, until: Infinity } : B.owners[2] < 0 ? { kind: 'opening', team: -1, until: t + 45 } : { kind: 'lull', team: -1, until: t + 14 },
      acc: 0, kitAt: 0,
      pushes: 0, lastTeam: -1, streak: 0, lastPushKind: '', lastEvent: '', eventAt: 0, log: [],
      smoke: [], planes: [], drop: null, fogUntil: 0, fogOn: false, fogK: 0,
      tankAt: [t + 40, t + 40], reserved: null, reservedAt: t + 4, captures: 0, pruneAt: 5, result: '',
    };
    if (B.score) war.tickets = [0, 0];
    war.start = B.score ? [B.score, B.score] : war.tickets.slice();
    for (const pt of war.points) pt.trench = world.trenches.filter((r) => this.inZone(pt, r.x + r.w / 2, r.y + r.h / 2));
    for (const n of S.nests) {
      const own = war.points[n.pi].owner, team = own >= 0 ? own : n.x < world.w / 2 ? 0 : 1, v = new Vehicle(n.x, n.y, WAR_VEHICLES.nest);
      v.team = team; v.pi = n.pi; v.angle = v.turret = team === 0 ? 0 : Math.PI; v.color = '#8a7a58';
      game.vehicles.push(v);
    }
    for (const team of [0, 1]) for (let i = 0; i < Math.min(2, B.tanks === undefined ? 2 : B.tanks); i++) this.spawnTank(game, team, false);
    for (const a of game.actors) {
      if (!a.isPlayer) { const side = WAR_SIDES[a.team]; a.skin = { color: side.color, accent: side.accent, hat: 'helmet' }; a.color = side.color; }
      this.place(game, a);
    }
    // 80 rifles in one field: everyone fires in looser bursts than in a royale, so open ground is deadly but not instant
    for (const br of game.brains) { br.saveRockets = true; br.pauseMult *= 1.7; br.wobbleMult *= 1.4; }
    const P = war.points;
    game.flashBanner(B.name.toUpperCase() + (sky.name ? ' · ' + sky.name.toUpperCase() : ''), true, 2.8);
    const orders = { front: 'Race for ' + P[2].name + ', then push east', assault: 'Break through at ' + P[4].name, defend: 'Hold ' + P[0].name + ' until the clock runs out', hill: 'Take ' + P[2].name + ' and keep it', raid: 'Quietly now: ' + P[2].name + ', then ' + P[3].name, armour: 'Armour forward: ' + P[2].name + ' first' };
    game.notify(game.player, orders[id]);
    game.notify(game.player, 'Kit: ' + game.player.kit.name + ' - [C] changes it');
  },

  // A kit for the player, a class for the bots. Runs at the start and on every respawn.
  loadout(game, a) {
    a.cover = 0; a.slow = 1; a.supplyAt = 0; a.objDest = null; a.nadeAt = 0;
    if (a.isPlayer) {
      if (game.warKit === undefined) { const k = Progress.data.prefs.kit; game.warKit = k >= 0 && k < WAR_KITS.length ? k : Math.floor(Math.random() * WAR_KITS.length); } // the kit you last chose (a random one the first time)
      const kit = a.kit = WAR_KITS[game.warKit % WAR_KITS.length], extra = game.P && game.P.startWeapon;
      a.weapons = [makeWeapon('pistol')].concat(kit.guns.map((k) => makeWeapon(k)));
      if (extra && a.weapons.length < 3 && !a.hasWeapon(extra)) a.weapons.push(makeWeapon(extra)); // the shop's starting weapon rides along if there is room
      a.grenades = kit.grenades || 2; a.meds = Math.max(a.meds, kit.meds || 2); a.wi = 1;
      a.shield = Math.max(a.shield, kit.shield || 40);
    } else {
      const c = U.weightedPick(WAR_CLASSES);
      a.cls = c.id; a.weapons = [makeWeapon('pistol')].concat(c.guns.map((k) => makeWeapon(k))); a.meds = 1; a.grenades = 1;
      a.roll = Math.random(); a.warRole = 'attack'; // attack or defend is decided by the phase of the battle (objectiveFor)
      a.wi = a.weapons.length - 1;
      a.shield = Math.max(a.shield, 40); // helmet and webbing: everyone on the field starts with a little armour
    }
    for (const w of a.weapons) { a.applyWeaponMods(w); w.ammo = w.mag; w.reserve = w.kind === 'rocket' ? (a.kit && a.kit.rockets) || 3 : w.ammoPickup * 3; }
  },
  // C: the next kit. It is issued on the spot inside a position your army holds, otherwise at the next respawn.
  changeKit(game) {
    const war = game.war, p = game.player;
    if (!war || game.time < (war.kitAt || 0)) return;
    game.warKit = (game.warKit + 1) % WAR_KITS.length;
    Progress.data.prefs.kit = game.warKit; Progress.save();
    const kit = WAR_KITS[game.warKit];
    const home = p.alive && !p.car && war.points.some((pt) => pt.owner === p.team && this.inZone(pt, p.x, p.y));
    war.kitAt = game.time + (home ? 6 : 0.25);
    if (home) { // a change of weapons, not a free refill of medkits and grenades
      const meds = p.meds, nades = p.grenades;
      p.meds = 0; this.loadout(game, p); game.applyMutator(p);
      p.meds = Math.min(meds, kit.meds || 2); p.grenades = Math.min(nades, kit.grenades || 2);
      game.notify(p, kit.name + ' - ' + kit.tip); Sound.pickup();
    }
    else game.notify(p, 'Next life: ' + kit.name + ' (' + kit.tip + ')');
  },

  // The foremost position an army holds (the end of its unbroken run from its own side), and the one after it,
  // which is the only one it may capture. -1 = none; locked positions can never be taken.
  defendIdx(war, team) {
    const P = war.points; let d = -1;
    if (team === 0) { for (let i = 0; i < P.length && P[i].owner === 0; i++) d = i; }
    else for (let i = P.length - 1; i >= 0 && P[i].owner === 1; i--) d = i;
    return d;
  },
  attackIdx(war, team) {
    const P = war.points, d = this.defendIdx(war, team);
    const a = d < 0 ? (team === 0 ? 0 : P.length - 1) : team === 0 ? d + 1 : d - 1;
    return a < 0 || a >= P.length || P[a].locked ? -1 : a;
  },
  // Reinforcements come up just behind the army's foremost position while it is secure; once the enemy is inside
  // it they arrive one position further back (or at headquarters), which is what lets an assault carry a position.
  spawnPoint(game, team) {
    const war = game.war, S = game.world.sites, d = this.defendIdx(war, team);
    let base = S.hq[team];
    if (d >= 0) {
      const pt = war.points[d], back = war.points[team === 0 ? d - 1 : d + 1];
      const pushed = war.phase.kind === 'push' && war.phase.team !== team; // under an offensive, help has further to come
      if (pt.owner === team && !pushed && !pt.n[1 - team] && Math.abs(pt.cap) > 0.999 && !(war.battle.brawl && !pt.locked)) base = pt; else if (back) base = back; // nobody is reinforced on the hill itself
    }
    const dir = team === 0 ? -1 : 1;
    if (base === S.hq[team]) return game.spotNear(base.x + dir * 170, base.y, 0, 300, 22) || base;
    for (let k = 0; k < 20; k++) { // spread along the rear edge of the sector
      const c = { x: base.x + dir * (base.hx + U.rand(20, 160)), y: base.y + U.rand(-base.hy, base.hy) * 0.8 };
      if (game.world.inBounds(c.x, c.y, 30) && !game.world.circleBlocked(c.x, c.y, 28)) return c;
    }
    return { x: base.x + dir * (base.hx + 80), y: base.y };
  },
  // Bots come back in waves, so reinforcements reach the front as a group; the player just waits five seconds.
  respawnAt(game, a) {
    const t = game.time, B = game.war.battle, per = B.wave ? B.wave[a.team] : 10;
    return a.isPlayer ? t + game.mode.respawnTime : Math.ceil((t + 3) / per) * per + U.rand(0, 0.6);
  },
  // Put a soldier on the field. A bot arriving while a new tank is waiting at the depot crews it.
  place(game, a) {
    const q = this.spawnPoint(game, a.team);
    a.x = q.x; a.y = q.y; a.angle = a.team === 0 ? 0 : Math.PI;
    if (a.isPlayer) return;
    const tk = game.vehicles.find((v) => v.alive && v.fresh && !v.driver && v.team === a.team);
    if (tk) { a.x = tk.x; a.y = tk.y; tk.fresh = false; game.enterVehicle(a, tk); a.roll = 0.2; }
  },
  spawnTank(game, team, reserved) {
    const def = WAR_VEHICLES.tank;
    let pos;
    if (reserved) { const q = this.spawnPoint(game, team); pos = game.spotNear(q.x, q.y, 60, 320, def.r + 10); }
    else pos = game.world.sites.depots[team].find((d) => game.vehicles.every((v) => !v.alive || U.dist(v.x, v.y, d.x, d.y) > 110));
    if (!pos) return null;
    const v = new Vehicle(pos.x, pos.y, def);
    v.team = team; v.angle = v.turret = team === 0 ? 0 : Math.PI; v.color = WAR_SIDES[team].hull; v.fresh = !reserved; v.reserved = !!reserved;
    game.vehicles.push(v);
    return v;
  },

  // ---------------------------------------------------------------- per-frame rules
  update(game, dt) {
    const war = game.war; if (!war) return;
    const world = game.world, t = game.time;
    for (const pt of war.points) { pt.n[0] = 0; pt.n[1] = 0; }
    for (const a of game.actors) {
      if (!a.alive) continue;
      if (a.car) { a.cover = 0; a.slow = 1; }
      else {
        a.cover = world.inTrench(a.x, a.y) ? 0.6 : 0; a.slow = world.inWire(a.x, a.y) ? 0.42 : 1;
        if (!a.cover) for (const c of war.smoke) if ((a.x - c.x) ** 2 + (a.y - c.y) ** 2 < c.r * c.r) { a.cover = 0.5; break; } // hard to hit what you cannot see
      }
      for (const pt of war.points) {
        if (!this.inZone(pt, a.x, a.y)) continue;
        pt.n[a.team]++;
        if (pt.owner === a.team && t >= (a.supplyAt || 0)) this.supply(game, a);
      }
    }
    const med = game.player; // a Medic patches up whoever is fighting beside them
    if (med.alive && med.kit && med.kit.heal && !med.car) for (const a of game.actors) {
      if (!a.alive || a === med || a.team !== med.team || a.hp >= a.maxHp || U.dist(a.x, a.y, med.x, med.y) > 190) continue;
      a.hp = Math.min(a.maxHp, a.hp + 7 * dt);
      if (Math.random() < dt * 3) game.particles.push(new Particle(a.x + U.rand(-10, 10), a.y - 14, 0, -40, 0.6, 'rgba(120,255,140,0.8)', 3));
    }
    this.updatePoints(game, dt);
    if (war.smoke.length) war.smoke = war.smoke.filter((c) => c.until > t);
    if (war.planes.length) war.planes = war.planes.filter((pl) => t < pl.t0 + pl.dur);
    if (war.drop && t > war.drop.until) war.drop = null;
    const fog = t < war.fogUntil; // fog: everyone sees about half as far until it lifts
    if (fog !== war.fogOn) { war.fogOn = fog; for (const br of game.brains) { if (fog) { br.clearView = br.viewRange; br.viewRange *= 0.55; } else if (br.clearView) br.viewRange = br.clearView; } if (!fog) game.notify(game.player, 'The fog is lifting'); }
    war.fogK = U.clamp(war.fogK + (fog ? dt : -dt) / 4, 0, 1);
    if (game.state !== 'playing') return;
    this.tickPhase(game);
    // holding fewer positions bleeds reinforcements
    const held = [0, 0]; for (const pt of war.points) if (pt.owner >= 0) held[pt.owner]++;
    if (war.battle.bleed && held[0] !== held[1]) {
      war.bleed += dt * Math.abs(held[0] - held[1]) / 6;
      while (war.bleed >= 1) { war.bleed--; const lose = held[0] > held[1] ? 1 : 0; war.tickets[lose] = Math.max(0, war.tickets[lose] - 1); }
    }
    war.timeLeft -= dt;
    const foe = WAR_SIDES[1].name;
    if (war.battle.score) { // the hill: a point for every second it is held
      const o = war.points[2].owner;
      if (o >= 0) { war.acc += dt; while (war.acc >= 1) { war.acc--; war.tickets[o]++; } }
      if (war.tickets[0] >= war.battle.score) return this.finish(game, true, war.points[2].name + ' is yours for good.');
      if (war.tickets[1] >= war.battle.score) return this.finish(game, false, 'The ' + foe + ' held ' + war.points[2].name + ' too long.');
    } else {
      if (war.tickets[1] <= 0) return this.finish(game, true, 'The ' + foe + ' has no one left to send.');
      if (war.tickets[0] <= 0) return this.finish(game, false, 'Your army ran out of reinforcements.');
    }
    if (war.timeLeft <= 0) {
      const how = war.battle.timeout;
      if (how === 'win') return this.finish(game, true, 'The line held. They have nothing left to throw at it.');
      if (how === 'lose') return this.finish(game, false, 'The offensive stalled short of ' + war.points[4].name + '.');
      return this.finish(game, war.tickets[0] >= war.tickets[1], war.battle.score ? 'Time. ' + (war.tickets[0] >= war.tickets[1] ? 'Your army' : 'The ' + foe) + ' held it longer.' : war.tickets[0] >= war.tickets[1] ? 'Ceasefire. Your army held more in reserve.' : 'Ceasefire. The ' + foe + ' held more in reserve.');
    }
    this.updateVehicles(game, dt);
    this.updateArty(game, dt);
    this.updateNades(game, dt);
    this.botNades(game, dt);
    if (t >= war.pruneAt) { // battlefield pickups do not lie around forever
      war.pruneAt = t + 5;
      for (const l of world.loot) if (l.alive && l.expires && t > l.expires) l.alive = false;
      world.pruneLoot();
    }
  },

  // Share of an army that goes forward: most of it during its own offensive, a few probes otherwise.
  share(war, team) { const ph = war.phase; return war.battle.brawl ? 0.85 : ph.kind === 'opening' ? 0.65 : ph.kind === 'lull' ? 0.08 : ph.team === team ? 0.9 : 0.06; },
  // Lulls and offensives of uneven length. Who attacks next, and how, is rolled each time (startPush), and a lull
  // may bring something from outside the battle (event).
  tickPhase(game) {
    const war = game.war, ph = war.phase, t = game.time, p = game.player, mid = war.points[2];
    if (war.eventAt && t >= war.eventAt) { war.eventAt = 0; this.event(game); }
    if (war.battle.brawl) { if (!war.eventAt) war.eventAt = t + U.rand(35, 60); return; } // no phases, just whatever the sky sends
    if (t < ph.until && !(ph.kind === 'opening' && mid.owner >= 0)) return;
    if (ph.kind !== 'lull') {
      war.phase = { kind: 'lull', team: -1, until: t + U.rand(12, 34) };
      if (ph.kind === 'push') game.notify(p, ph.team === p.team ? 'The offensive is spent - dig in' : 'Their offensive is spent');
      if (Math.random() < 0.65) war.eventAt = t + U.rand(3, 9);
    } else this.startPush(game);
    for (const a of game.actors) a.objDest = null;
  },
  // Who goes over the top. On an even front the army holding less attacks more often, and nobody attacks three
  // times running; in Breakthrough and Last Stand one army does nearly all of it.
  pushTeam(war) {
    let w0 = 0.5;
    if (war.id === 'assault') w0 = 0.85; else if (war.id === 'defend') w0 = 0.15;
    else {
      const held = [0, 0]; for (const pt of war.points) if (pt.owner >= 0) held[pt.owner]++;
      w0 = U.clamp(0.5 + 0.15 * (held[1] - held[0]), 0.25, 0.75);
    }
    let team = Math.random() < w0 ? 0 : 1;
    if (war.id === 'front' && war.streak >= 2 && war.lastTeam === team) team = 1 - team;
    war.streak = team === war.lastTeam ? war.streak + 1 : 1; war.lastTeam = team;
    return team;
  },
  startPush(game, force) {
    const war = game.war, t = game.time, p = game.player, team = force ? 0 : this.pushTeam(war), mine = team === p.team;
    const B = war.battle;
    const kind = force || U.weightedPick(WAR_PUSHES.filter((k) => (k.v.id !== war.lastPushKind || k.v.id === 'infantry') && !(B.tanks === 0 && k.v.id === 'armour') && !(B.arty === false && k.v.id === 'barrage'))).id;
    const K = WAR_PUSHES.find((k) => k.v.id === kind).v;
    war.lastPushKind = kind; war.pushes++; war.log.push(kind + team);
    war.phase = { kind: 'push', team, type: kind, until: t + U.rand(42, 62) };
    const pt = war.points[this.attackIdx(war, team)];
    if (pt) {
      if (B.arty === false) { /* a raid goes in without guns */ }
      else if (kind === 'barrage') this.barrage(game, war.cmd[team], team, pt.x, pt.y, 28, 0, 3, pt);
      else if (kind !== 'smoke') this.barrage(game, war.cmd[team], team, pt.x, pt.y, kind === 'armour' ? 8 : 14, 0, 3, pt);
      const all = war.battle.allOut === team;
      if (all && kind === 'smoke') this.barrage(game, war.cmd[team], team, pt.x, pt.y, 14, 0, 3, pt);
      if (all && kind !== 'armour') this.spawnTank(game, team, false);
      if (kind === 'smoke' || all) { // a wall of smoke on the near edge of the position and another inside it
        const dir = team === 0 ? -1 : 1;
        for (const k of [1.25, 0.35]) for (let i = 0; i < 7; i++) war.smoke.push({ x: pt.x + dir * pt.hx * k + U.rand(-70, 70), y: pt.y - pt.hy + (i + 0.5) / 7 * pt.hy * 2 + U.rand(-40, 40), r: 190, t0: t, until: t + U.rand(26, 34), seed: Math.random() * 9 });
      }
    }
    if (kind === 'armour' && B.tanks !== 0) { for (let i = 0; i < 2; i++) this.spawnTank(game, team, false); war.tankAt[team] = t + 35; }
    war.artyAt[team] = t + 18;
    game.flashBanner(war.battle.allOut === team ? (mine ? 'ALL-OUT ASSAULT' : 'ALL-OUT ATTACK') : mine ? K.mine : K.foe, mine, 2.6);
    if (pt) game.notify(p, mine ? 'All units: take ' + pt.name : 'They are coming - hold the line');
    Sound.tone(1900, 0.8, 0.1, 'sine', 2150); // the whistle
  },
  // Something from outside the battle: aircraft, a supply drop between the lines, or fog.
  event(game, force) {
    const war = game.war, t = game.time, p = game.player, world = game.world;
    const kind = force || U.pick(['air', 'supply', 'fog'].filter((k) => k !== war.lastEvent && !(k === 'air' && war.battle.arty === false) && !(k === 'fog' && game.mut && game.mut.fog)));
    if (!kind) return;
    war.lastEvent = kind; war.log.push(kind);
    if (kind === 'air') { // a strafing run along the enemy's foremost position
      const team = Math.random() < 0.5 ? 0 : 1, di = this.defendIdx(war, 1 - team), pt = war.points[di >= 0 ? di : this.attackIdx(war, team)];
      if (!pt) return;
      const x = pt.x + U.rand(-0.6, 0.6) * pt.hx, down = Math.random() < 0.5, ya = pt.y - pt.hy - 60, yb = pt.y + pt.hy + 60, n = 9;
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n, y = down ? U.lerp(ya, yb, k) : U.lerp(yb, ya, k);
        war.shells.push({ x: U.clamp(x + U.rand(-45, 45), 40, world.w - 40), y: U.clamp(y, 40, world.h - 40), t0: t, at: t + 2.4 + i * 0.2, owner: war.cmd[team], team });
      }
      war.planes.push({ x, y0: (down ? ya : yb) + (down ? -700 : 700), y1: (down ? yb : ya) + (down ? 900 : -900), t0: t + 0.8, dur: 4.2, team });
      game.notify(p, team === p.team ? 'Air support inbound' : 'Enemy aircraft - get down!');
      Sound.tone(150, 2.4, 0.07, 'sawtooth', 95);
    } else if (kind === 'supply') {
      const a = war.points[this.defendIdx(war, 0)], b = war.points[this.defendIdx(war, 1)];
      const cx = a && b ? (a.x + b.x) / 2 : world.w / 2, cy = a && b ? (a.y + b.y) / 2 : world.h / 2;
      const q = game.spotNear(cx + U.rand(-150, 150), cy + U.rand(-300, 300), 0, 220, 30) || { x: cx, y: cy };
      const drop = (kind2, key) => { const n = world.loot.length; game.dropLoot(q.x + U.rand(-55, 55), q.y + U.rand(-55, 55), kind2, key ? makeWeapon(key) : undefined); if (world.loot.length > n) world.loot[n].expires = t + 75; };
      drop('weapon', 'rocket'); drop('weapon', Math.random() < 0.5 ? 'sniper' : 'lmg'); drop('medkit'); drop('medkit'); drop('shield'); drop('shield'); drop('ammo');
      war.drop = { x: q.x, y: q.y, until: t + 75 };
      game.notify(p, 'Supply drop between the lines');
      Sound.pickup();
    } else {
      war.fogUntil = t + U.rand(35, 50);
      game.notify(p, 'Fog is rolling in');
    }
  },
  inZone(pt, x, y) { return Math.abs(x - pt.x) < pt.hx && Math.abs(y - pt.y) < pt.hy; },
  canCapture(war, team, i) { return war.points[i].owner === team || i === this.attackIdx(war, team); },
  updatePoints(game, dt) {
    const war = game.war;
    for (const pt of war.points) {
      const n0 = this.canCapture(war, 0, pt.i) ? pt.n[0] : 0, n1 = this.canCapture(war, 1, pt.i) ? pt.n[1] : 0;
      const up = war.battle.brawl ? 1.7 : 1; // on the hill, whoever is storming it counts for more than whoever is sitting on it
      const had = pt.owner >= 0 ? pt.owner : pt.last; // still counts against the last holder while the hill is nobody's
      const diff = U.clamp(n0 * (had === 1 ? up : 1) - n1 * (had === 0 ? up : 1), -6, 6);
      if (diff) pt.cap += diff * dt / (war.battle.brawl ? 40 : 60); // a hill changes hands much faster than a trench line // outnumbering them by six or more: ten seconds to clear it, ten more to take it
      else if (!pt.n[0] && !pt.n[1] && pt.owner >= 0) pt.cap += (pt.owner === 0 ? 1 : -1) * dt / 20; // an empty position settles back
      pt.cap = U.clamp(pt.cap, -1, 1);
      if (game.state !== 'playing') continue;
      if ((pt.owner === 0 && pt.cap <= 0) || (pt.owner === 1 && pt.cap >= 0)) {
        if (pt.owner === game.player.team) game.notify(game.player, pt.name + ' is falling - retake it');
        pt.owner = -1;
        for (const a of game.actors) a.objDest = null;
      }
      if (pt.owner !== 0 && pt.cap >= 1) this.flip(game, pt, 0);
      else if (pt.owner !== 1 && pt.cap <= -1) this.flip(game, pt, 1);
    }
  },
  flip(game, pt, team) {
    const war = game.war, p = game.player, mine = team === p.team;
    pt.owner = team; pt.last = team; pt.cap = team === 0 ? 1 : -1; war.flips = (war.flips || 0) + 1;
    game.killfeed.unshift({ text: WAR_SIDES[team].name + ' took ' + pt.id + ' · ' + pt.name, time: game.time, hl: !mine });
    if (game.killfeed.length > 6) game.killfeed.length = 6;
    game.flashBanner(pt.name.toUpperCase() + (mine ? ' TAKEN' : ' LOST'), mine, 2.2);
    Sound.wave();
    if (war.phase.kind === 'push' && war.phase.team === team) war.phase.until = Math.min(war.phase.until, game.time + 6); // the offensive has its prize: consolidate
    if (mine && p.alive && this.inZone(pt, p.x, p.y)) { war.captures++; game.ms.objectives++; game.notify(p, 'Position captured'); }
    for (const a of game.actors) a.objDest = null;
    if (war.battle.score) return;
    if (war.points.every((q) => q.locked || q.owner === 0)) this.finish(game, true, 'Every position on the line is yours.');
    else if (war.points.every((q) => q.locked || q.owner === 1)) this.finish(game, false, 'The line broke. Every position was lost.');
  },
  finish(game, win, why) {
    if (game.state !== 'playing') return;
    game.war.result = why;
    game.scoreboard = game.arenaRanking();
    game.placement = game.scoreboard.indexOf(game.player) + 1;
    game.endGame(win);
  },

  // Standing in a position your army holds: ammunition, grenades, a medkit, and repairs for the tank you sit in.
  supply(game, a) {
    a.supplyAt = game.time + 4;
    let got = false;
    for (const w of a.weapons) {
      const rocket = w.kind === 'rocket', cap = rocket ? (a.kit && a.kit.rockets) || 3 : w.ammoPickup * 3;
      if (w.reserve < cap && !w.infinite) { w.reserve = Math.min(cap, w.reserve + (rocket ? 1 : Math.ceil(w.ammoPickup * 0.75))); got = true; }
    }
    if (a.grenades < ((a.kit && a.kit.grenades) || 2)) { a.grenades++; got = true; }
    if (a.meds < (a.isPlayer ? (a.kit && a.kit.meds) || 2 : 1)) { a.meds++; got = true; }
    if (a.car && a.car.hp < a.car.maxHp) { a.car.hp = Math.min(a.car.maxHp, a.car.hp + a.car.maxHp * 0.08); got = true; }
    if (got) game.notify(a, a.car ? 'Repaired and resupplied' : 'Resupplied');
  },

  onDeath(game, victim) { const war = game.war; if (war && !war.battle.score && game.state === 'playing') war.tickets[victim.team] = Math.max(0, war.tickets[victim.team] - 1); },
  // The dead leave less behind than in a royale, and it does not stay long.
  drops(game, v) {
    const world = game.world, until = game.time + 45;
    const drop = (kind, w) => { const n = world.loot.length; game.dropLoot(v.x + U.rand(-30, 30), v.y + U.rand(-30, 30), kind, w); if (world.loot.length > n) world.loot[n].expires = until; };
    for (const w of v.weapons) if (w.key !== 'pistol' && Math.random() < (w.kind === 'rocket' ? 0.7 : 0.25)) drop('weapon', w);
    if (Math.random() < 0.3) drop('ammo');
    if (v.meds > 0 && Math.random() < 0.3) drop('medkit');
  },

  // ---------------------------------------------------------------- tanks and machine guns
  updateVehicles(game, dt) {
    const war = game.war, t = game.time, tanks = [0, 0];
    for (const v of game.vehicles) {
      if (!v.alive || !v.def.gun) continue;
      if (v.gunCd > 0) v.gunCd -= dt;
      if (v.mgCd > 0) v.mgCd -= dt;
      if (v.def.id !== 'tank') continue;
      if (!v.reserved && (v.team === 0 || v.team === 1)) tanks[v.team]++;
      if (Math.abs(v.speed) > 20) this.crushWire(game, v);
    }
    const B = war.battle, cap = B.tanks === undefined ? 2 : B.tanks;
    for (const team of [0, 1]) if (tanks[team] < cap && t >= war.tankAt[team]) { war.tankAt[team] = t + (this.spawnTank(game, team, false) ? B.tankEvery || 35 : 5); }
    if (!cap) return; // no armour in this battle, the player's included
    // the player's own tank is parked behind the front; a new one arrives a while after it is lost
    if (war.reserved && !war.reserved.alive) { war.reserved = null; war.reservedAt = t + (B.reservedEvery || 50); }
    if (!war.reserved && t >= war.reservedAt) {
      const v = this.spawnTank(game, game.player.team, true);
      if (v) { war.reserved = v; game.notify(game.player, 'A tank is waiting for you behind the line'); } else war.reservedAt = t + 3;
    }
  },
  crushWire(game, v) {
    const world = game.world, W = world.wire;
    for (let i = W.length - 1; i >= 0; i--) {
      const r = W[i], nx = U.clamp(v.x, r.x, r.x + r.w), ny = U.clamp(v.y, r.y, r.y + r.h);
      if ((v.x - nx) ** 2 + (v.y - ny) ** 2 > v.r * v.r) continue;
      W.splice(i, 1);
      world.dirty.push({ x: r.x - 12, y: r.y - 12, w: r.w + 24, h: r.h + 24 }); // wire is not an obstacle: no need to rebuild routes or the minimap
      game.sparks(nx, ny, '#9a9aa0', 6);
    }
  },
  // Whoever sits behind the gun pulls the trigger: the cannon and the machine gun each fire when they are ready.
  fireGun(game, v) {
    const g = v.def.gun, o = v.driver; if (!g || !o || !v.alive) return;
    const ca = Math.cos(v.turret), sa = Math.sin(v.turret), mx = v.x + ca * g.muzzle, my = v.y + sa * g.muzzle;
    const cam = game.renderer, vol = U.clamp(1 - U.dist(v.x, v.y, cam.camX, cam.camY) / 1500, 0, 1);
    if (g.cannon && v.gunCd <= 0) {
      v.gunCd = g.cannon;
      const b = new Bullet(o, mx, my, v.turret + U.rand(-0.012, 0.012), WAR_GUN); b.noSelf = true;
      game.bullets.push(b);
      game.particles.push(new Particle(mx, my, ca * 60, sa * 60, 0.16, '#fff3c4', 34));
      for (let i = 0; i < 9; i++) { const a = v.turret + U.rand(-0.5, 0.5), sp = U.rand(80, 380); game.particles.push(new Particle(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, U.rand(0.3, 0.8), i % 3 ? 'rgba(90,90,90,0.5)' : '#ffb347', U.rand(5, 12))); }
      if (v.def.max) v.speed -= 28;
      Sound.boom(vol * 0.55);
      if (o === game.player) cam.shake = Math.max(cam.shake || 0, 14);
    }
    if (g.mg && v.mgCd <= 0) {
      v.mgCd = g.mg;
      const ox = v.def.id === 'tank' ? -sa * 11 : 0, oy = v.def.id === 'tank' ? ca * 11 : 0;
      game.bullets.push(new Bullet(o, mx + ox - ca * 14, my + oy - sa * 14, v.turret + U.rand(-0.055, 0.055), WAR_MG));
      game.particles.push(new Particle(mx + ox, my + oy, ca * 90, sa * 90, 0.07, '#ffe9a8', 9));
      Sound.shot('rifle', o === game.player ? 0.6 : vol * 0.5);
      if (o === game.player) cam.shake = Math.max(cam.shake || 0, 2);
    }
  },
  // Defenders man an empty machine gun at a position their army holds.
  pickCar(game, br) {
    const b = br.bot, war = game.war;
    if (b.warRole !== 'defend') return null;
    for (const v of game.vehicles) {
      if (!v.alive || v.driver || v.def.id !== 'nest' || war.points[v.pi].owner !== b.team) continue;
      if (U.dist(b.x, b.y, v.x, v.y) < 420) { br.carGoal = v; return v; }
    }
    br.carGoal = null;
    return null;
  },

  // ---------------------------------------------------------------- artillery and grenades
  // n shells around (x, y), or scattered over a whole sector when zone is given.
  barrage(game, owner, team, x, y, n, spread, delay, zone) {
    const war = game.war, world = game.world, t = game.time;
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * spread;
      const sx = zone ? zone.x + U.rand(-zone.hx, zone.hx) : x + Math.cos(a) * d, sy = zone ? zone.y + U.rand(-zone.hy, zone.hy) : y + Math.sin(a) * d;
      war.shells.push({ x: U.clamp(sx, 40, world.w - 40), y: U.clamp(sy, 40, world.h - 40), t0: t, at: t + delay + i * 0.3 + U.rand(0, 0.25), owner, team });
    }
  },
  updateArty(game, dt) {
    const war = game.war, t = game.time, cam = game.renderer;
    for (const team of [0, 1]) {
      if (t < war.artyAt[team]) continue;
      war.artyAt[team] = t + U.rand(26, 40);
      const pt = war.points[this.attackIdx(war, team)];
      if (war.battle.arty !== false && pt && pt.n[1 - team] >= 2) this.barrage(game, war.cmd[team], team, pt.x + U.rand(-pt.hx, pt.hx) * 0.6, pt.y + U.rand(-pt.hy, pt.hy) * 0.7, 5, 230, 2.6);
    }
    let landed = false;
    for (const s of war.shells) {
      if (t < s.at) continue;
      s.done = true; landed = true;
      game.explode(s.x, s.y, 70, s.owner, null, 135, false, 'artillery');
      war.craters.push({ x: s.x, y: s.y, r: U.rand(34, 52) });
      if (war.craters.length > 70) war.craters.shift();
      if (U.dist(s.x, s.y, cam.camX, cam.camY) < 800) cam.shake = Math.max(cam.shake || 0, 13);
    }
    if (landed) war.shells = war.shells.filter((s) => !s.done);
  },
  callArtillery(game, x, y) {
    const war = game.war, p = game.player, t = game.time;
    if (!war || !p.alive) return;
    if (war.battle.arty === false) return game.notify(p, 'No guns behind you tonight');
    if (t < war.playerArty) return game.notify(p, 'Artillery reloading - ' + Math.ceil(war.playerArty - t) + 's');
    war.playerArty = t + 45;
    this.barrage(game, p, p.team, x, y, 6, 170, 2.2);
    game.notify(p, 'Fire mission on the way');
    Sound.tone(700, 0.5, 0.08, 'sine', 240);
  },
  // Lob a grenade toward a point (up to 540px). It sails over sandbags and into trenches; walls and trees stop it.
  throwGrenade(game, a, tx, ty) {
    const war = game.war;
    if (!war || !a.alive || a.car || !(a.grenades > 0) || a.healing > 0) return false;
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, 540 / d);
    a.grenades--;
    war.nades.push({ sx: a.x, sy: a.y, x: a.x, y: a.y, tx: a.x + dx * k, ty: a.y + dy * k, t: 0, dur: 0.45 + Math.min(d, 540) / 800, owner: a });
    if (a.isPlayer) Sound.tone(520, 0.08, 0.08, 'triangle', 300);
    return true;
  },
  tallAt(world, x, y) {
    let hit = false;
    world.cellsAround(x, y, 2, (o) => {
      if (hit || o.kind === 'sandbag' || o.kind === 'crate') return;
      if (o.type === 'rect') { if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) hit = true; }
      else if ((x - o.x) ** 2 + (y - o.y) ** 2 < o.r * o.r) hit = true;
    });
    return hit;
  },
  updateNades(game, dt) {
    const war = game.war; if (!war.nades.length) return;
    for (const g of war.nades) {
      g.t += dt;
      if (g.t < g.dur) {
        const k = g.t / g.dur, nx = U.lerp(g.sx, g.tx, k), ny = U.lerp(g.sy, g.ty, k);
        if (this.tallAt(game.world, nx, ny)) g.dur = g.t; else { g.x = nx; g.y = ny; }
      } else if (g.t >= g.dur + 0.3) { g.done = true; game.explode(g.x, g.y, 70, g.owner, null, 105, true, 'grenade'); }
    }
    war.nades = war.nades.filter((g) => !g.done);
  },
  // Bots throw at whoever they are fighting, mostly at people dug in.
  botNades(game, dt) {
    const t = game.time;
    for (const br of game.brains) {
      const b = br.bot, tg = br.target;
      if (!b.alive || b.car || !tg || !tg.alive || !(b.grenades > 0) || t < (b.nadeAt || 0)) continue;
      const d = U.dist(b.x, b.y, tg.x, tg.y);
      if (d < 230 || d > 520 || Math.random() > dt * (tg.cover ? 0.2 : tg.car ? 0.3 : 0.03)) continue;
      b.nadeAt = t + 7;
      this.throwGrenade(game, b, tg.x + U.rand(-40, 40), tg.y + U.rand(-40, 40));
    }
  },

  // ---------------------------------------------------------------- orders for the bots
  // Attackers press on to the position while shooting back ('push', or 'charge' during their army's offensive, when
  // even being hit does not stop them); once inside, and for defenders, it is 'hold'.
  objectiveFor(game, b) {
    const war = game.war; if (!war) return null;
    const role = b.car && !b.car.def.max ? 'defend' : (b.roll || 0) < this.share(war, b.team) ? 'attack' : 'defend';
    b.warRole = role;
    const ai = this.attackIdx(war, b.team), di = this.defendIdx(war, b.team);
    let pi = role === 'attack' ? ai : di;
    if (pi < 0) pi = role === 'attack' ? di : ai;
    // Hill Fight: only part of the army that holds the hill stays on it; the rest wait at their forward position
    if (war.battle.brawl && (war.points[2].owner === b.team || (war.points[2].owner < 0 && war.points[2].last === b.team)) && (b.roll || 0) > 0.4 && !b.isPlayer) pi = b.team === 0 ? 1 : 3;
    if (pi < 0) return null;
    const pt = war.points[pi];
    let o = b.objDest;
    if (!o || o.pi !== pi || game.time > o.until) {
      let p = null;
      const dug = role === 'defend' && !b.car && pt.trench.length && Math.random() < 0.8;
      for (let k = 0; dug && !p && k < 10; k++) { // a spot in a trench that is still inside the ring
        const tr = U.pick(pt.trench), c = { x: U.rand(tr.x + 14, tr.x + tr.w - 14), y: U.rand(tr.y + 14, tr.y + tr.h - 14) };
        if (this.inZone(pt, c.x, c.y)) p = c;
      }
      for (let k = 0; !p && k < 12; k++) {
        const c = { x: pt.x + U.rand(-pt.hx, pt.hx) * 0.85, y: pt.y + U.rand(-pt.hy, pt.hy) * 0.85 }, cr = b.car ? 46 : b.r + 6;
        if (b.car && !game.world.navFree(Math.floor(c.x / 40), Math.floor(c.y / 40), true)) continue; // somewhere a tank fits
        if (game.world.inBounds(c.x, c.y, cr + 6) && !game.world.circleBlocked(c.x, c.y, cr)) p = c;
      }
      p = p || { x: pt.x, y: pt.y };
      o = b.objDest = { x: p.x, y: p.y, pi, until: role === 'defend' ? Infinity : game.time + U.rand(9, 16) };
    }
    const inside = this.inZone(pt, b.x, b.y);
    const charge = war.battle.brawl || (war.phase.kind === 'push' && war.phase.team === b.team); // an offensive does not stop to trade shots
    return { x: o.x, y: o.y, r: 40, act: role === 'attack' && !inside ? (charge ? 'charge' : 'push') : 'hold' };
  },

  // ---------------------------------------------------------------- HUD
  hud(game) {
    const war = game.war, p = game.player, ai = this.attackIdx(war, p.team), di = this.defendIdx(war, p.team);
    const at = war.points[ai], df = war.points[di];
    const ph = war.phase;
    let s3 = at ? (ph.kind === 'lull' ? 'Lull · next: ' : 'Attack ') + at.id + ' · ' + at.name : 'Hold the line';
    if (ph.kind === 'push' && at && ph.team === p.team) s3 = 'OFFENSIVE · take ' + at.id + ' · ' + at.name;
    else if (df && (ph.kind === 'push' || df.cap < 0.999 || df.n[1 - p.team] > 0)) s3 = (ph.kind === 'push' ? 'ENEMY OFFENSIVE · hold ' : 'Defend ') + df.id + ' · ' + df.name;
    return {
      s1: (war.battle.score ? 'Seconds held ' : 'Reinforcements ') + '<span class="team">' + war.tickets[0] + '</span> vs <span>' + war.tickets[1] + '</span>' + (war.battle.score ? ' of ' + war.battle.score : ''),
      s2: '<span>' + p.kills + '</span> kills &middot; <span>' + war.captures + '</span> captured',
      s3: (war.battle.score ? (war.points[2].owner === p.team ? 'Hold ' : 'Take ') + war.points[2].name : s3) + ' · ' + U.fmtTime(war.timeLeft),
    };
  },
  barHtml(game) {
    const war = game.war, p = game.player, t = game.time;
    const army = (i) => '<div class="wt t' + i + '"><b>' + WAR_SIDES[i].name.toUpperCase() + (i === p.team ? ' (YOU)' : '') + '</b><i><u style="width:' + Math.round(100 * war.tickets[i] / war.start[i]) + '%"></u></i><span>' + war.tickets[i] + '</span></div>';
    let h = '<div class="row">' + army(0) + '<div class="wp">';
    for (const pt of war.points) {
      const k = Math.round(Math.abs(pt.cap) * 10) * 10, moving = Math.abs(pt.cap) < 0.999;
      h += '<em class="o' + (pt.owner < 0 ? 'n' : pt.owner) + (moving ? ' hot' : '') + (pt.locked ? ' lk' : '') + '"><b>' + pt.id + '</b><i class="c' + (pt.cap >= 0 ? 0 : 1) + '" style="width:' + k + '%"></i></em>';
    }
    h += '</div>' + army(1) + '</div>';
    const arty = t >= war.playerArty ? 'ready' : Math.ceil(war.playerArty - t) + 's';
    h += '<div class="sup"><span><b>C</b> ' + (p.kit ? p.kit.name : '') + '</span><span><b>G</b> grenade x' + (p.grenades || 0) + '</span>' + (war.battle.arty === false ? '' : '<span' + (arty === 'ready' ? ' class="rdy"' : '') + '><b>T</b> artillery ' + arty + '</span>') + (p.alive && p.cover ? '<span class="rdy">in cover</span>' : '') + '</div>';
    return h;
  },
  // Off-screen arrows: where to attack, and the position being lost.
  marks(game) {
    const war = game.war, p = game.player, out = [];
    const at = war.points[this.attackIdx(war, p.team)], df = war.points[this.defendIdx(war, p.team)];
    // one order at a time: a position in danger comes before the next one to take
    if (df && ((war.phase.kind === 'push' && war.phase.team !== p.team) || df.cap < 0.999 || df.n[1 - p.team] > 0)) out.push({ x: df.x, y: df.y, r: df.r, label: 'Defend ' + df.id, hot: true });
    else if (at) out.push({ x: at.x, y: at.y, r: at.r, label: 'Attack ' + at.id });
    if (war.drop && p.alive) out.push({ x: war.drop.x, y: war.drop.y, r: 60, label: 'Supplies' });
    const tk = war.reserved;
    if (tk && tk.alive && !tk.driver && p.alive && !p.car && U.dist(p.x, p.y, tk.x, tk.y) < 1500) out.push({ x: tk.x, y: tk.y, r: 50, label: 'Your tank' });
    return out;
  },
};

// ==================================================================== drawing
// Trenches and barbed wire are part of the static world (cached in tiles).
Renderer.prototype.drawWarGround = function (ctx, world, x0, y0, x1, y1) {
  const hit = (r, m) => r.x - m < x1 && r.x + r.w + m > x0 && r.y - m < y1 && r.y + r.h + m > y0;
  const T = world.trenches.filter((r) => hit(r, 16));
  if (T.length) {
    // spoil thrown up either side, the cut edge, then the floor, each in one pass so joints come out seamless
    ctx.fillStyle = '#8a7250'; for (const r of T) ctx.fillRect(r.x - 12, r.y - 12, r.w + 24, r.h + 24);
    ctx.fillStyle = '#57442e'; for (const r of T) ctx.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    ctx.fillStyle = '#33281b'; for (const r of T) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(160,128,84,0.4)'; ctx.lineWidth = 4; ctx.lineCap = 'butt'; ctx.beginPath(); // duckboards
    for (const r of T) {
      if (r.h >= r.w) for (let y = Math.ceil((r.y + 6) / 28) * 28; y < r.y + r.h - 4; y += 28) { ctx.moveTo(r.x + 14, y); ctx.lineTo(r.x + r.w - 14, y); }
      else for (let x = Math.ceil((r.x + 6) / 28) * 28; x < r.x + r.w - 4; x += 28) { ctx.moveTo(x, r.y + 14); ctx.lineTo(x, r.y + r.h - 14); }
    }
    ctx.stroke();
  }
  for (const r of world.wire) {
    if (!hit(r, 10)) continue;
    const vert = r.h >= r.w, len = vert ? r.h : r.w, wid = vert ? r.w : r.h;
    const pt = (along, across) => (vert ? [r.x + across, r.y + along] : [r.x + along, r.y + across]);
    ctx.strokeStyle = '#4a3a28'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.beginPath(); // stakes
    for (let a = 8; a <= len - 8; a += 38) { let p = pt(a - 7, 4), q = pt(a + 7, wid - 4); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); p = pt(a + 7, 4); q = pt(a - 7, wid - 4); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,30,34,0.85)'; ctx.lineWidth = 1.5; // two strands of coiled wire
    for (const ph of [0, 1]) {
      ctx.beginPath();
      for (let a = 0, i = ph; a <= len; a += 11, i++) { const p = pt(a, i % 2 ? wid - 3 : 3); if (a === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
      ctx.stroke();
    }
  }
};
Renderer.prototype.drawCrater = function (ctx, x, y, r) {
  ctx.fillStyle = 'rgba(96,74,48,0.5)'; ctx.beginPath(); ctx.ellipse(x, y, r * 1.18, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(38,28,18,0.55)'; ctx.beginPath(); ctx.ellipse(x + r * 0.05, y + r * 0.07, r * 0.85, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(15,10,6,0.35)'; ctx.beginPath(); ctx.ellipse(x + r * 0.12, y + r * 0.14, r * 0.5, r * 0.34, 0, 0, Math.PI * 2); ctx.fill();
};
// Under the soldiers: fresh craters and the five positions (ring, capture progress, flag).
Renderer.prototype.drawWar = function (ctx, game) {
  const war = game.war, t = game.time;
  for (const c of war.craters) this.drawCrater(ctx, c.x, c.y, c.r);
  for (const pt of war.points) {
    const col = pt.owner < 0 ? '230,230,230' : WAR_SIDES[pt.owner].rgb;
    ctx.fillStyle = 'rgba(' + col + ',0.06)'; ctx.strokeStyle = 'rgba(' + col + ',0.75)'; ctx.lineWidth = 4;
    ctx.setLineDash([18, 12]); ctx.lineDashOffset = -t * 14;
    this.rr(ctx, pt.x - pt.hx, pt.y - pt.hy, pt.hx * 2, pt.hy * 2, 40); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (Math.abs(pt.cap) < 0.999) {
      ctx.strokeStyle = 'rgba(' + WAR_SIDES[pt.cap >= 0 ? 0 : 1].rgb + ',0.95)'; ctx.lineWidth = 7; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 74, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.abs(pt.cap)); ctx.stroke();
    }
    // flagpole and flag
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(pt.x + 5, pt.y + 28, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#24252a'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pt.x, pt.y + 26); ctx.lineTo(pt.x, pt.y - 50); ctx.stroke();
    const wv = Math.sin(t * 3 + pt.i) * 4;
    ctx.fillStyle = pt.owner < 0 ? '#d8d8d8' : WAR_SIDES[pt.owner].color; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pt.x + 2, pt.y - 50); ctx.quadraticCurveTo(pt.x + 24, pt.y - 54 + wv, pt.x + 48, pt.y - 48 - wv);
    ctx.lineTo(pt.x + 48, pt.y - 22 - wv); ctx.quadraticCurveTo(pt.x + 24, pt.y - 28 + wv, pt.x + 2, pt.y - 24); ctx.closePath(); ctx.fill(); ctx.stroke();
    this.label(ctx, pt.id, pt.x + 25, pt.y - 31, 'bold 17px', '#fff');
    this.label(ctx, pt.name, pt.x, pt.y + 52, 'bold 13px', pt.owner < 0 ? '#eee' : WAR_SIDES[pt.owner].css);
  }
};
// Over the soldiers: where shells are about to land, grenades in the air, and the player's cover marker.
Renderer.prototype.drawWarTop = function (ctx, game) {
  const war = game.war, t = game.time, p = game.player;
  if (war.drop) {
    const d = war.drop, pulse = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.strokeStyle = 'rgba(255,214,90,0.9)'; ctx.fillStyle = 'rgba(255,214,90,' + (0.05 + 0.05 * pulse) + ')'; ctx.lineWidth = 3; ctx.setLineDash([12, 9]);
    ctx.beginPath(); ctx.arc(d.x, d.y, 82 + pulse * 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    this.label(ctx, 'Supplies', d.x, d.y - 94, 'bold 13px', '#ffd65a');
  }
  for (const c of war.smoke) {
    const a = Math.min(1, (c.until - t) / 5, (t - c.t0) / 1.6) * 0.42; if (a <= 0) continue;
    ctx.fillStyle = 'rgba(214,214,206,' + a + ')';
    for (let i = 0; i < 4; i++) { const an = c.seed + i * 1.7 + t * 0.12, d = c.r * 0.34; ctx.beginPath(); ctx.arc(c.x + Math.cos(an) * d, c.y + Math.sin(an * 1.3) * d, c.r * (0.62 + 0.08 * Math.sin(t * 0.7 + i + c.seed)), 0, Math.PI * 2); ctx.fill(); }
  }
  for (const s of war.shells) {
    const k = U.clamp((s.at - t) / (s.at - s.t0), 0, 1), col = s.team !== p.team ? '255,80,70' : '120,180,255';
    ctx.fillStyle = 'rgba(' + col + ',0.07)'; ctx.strokeStyle = 'rgba(' + col + ',0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, 135, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + col + ',0.95)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(s.x, s.y, 12 + 123 * k, 0, Math.PI * 2); ctx.stroke();
  }
  for (const g of war.nades) {
    const k = Math.min(1, g.t / g.dur), h = Math.sin(k * Math.PI) * 40;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(g.x, g.y + 3, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.t >= g.dur && Math.sin(t * 40) > 0 ? '#ff5a4a' : '#34432a'; ctx.strokeStyle = '#11150d'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(g.x, g.y - h, 5.5 + h * 0.04, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  for (const pl of war.planes) { // a strafing aircraft: shadow on the ground, the machine above it
    const k = (t - pl.t0) / pl.dur; if (k < 0 || k > 1) continue;
    const y = U.lerp(pl.y0, pl.y1, k), dirn = pl.y1 > pl.y0 ? 1 : -1;
    const shape = (ox, oy, col) => {
      ctx.save(); ctx.translate(pl.x + ox, y + oy); ctx.scale(1, dirn); ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 74, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-104, -2); ctx.lineTo(104, -2); ctx.lineTo(96, 26); ctx.lineTo(-96, 26); ctx.closePath(); ctx.fill();
      ctx.fillRect(-36, -70, 72, 15);
      ctx.restore();
    };
    shape(70, 90, 'rgba(0,0,0,0.3)');
    shape(0, 0, pl.team === p.team ? '#3f5f8f' : '#7d3b36');
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(pl.x, y + dirn * 30, 7, 0, Math.PI * 2); ctx.fill();
  }
  if (p.alive && p.cover && !p.car) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 11, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
};
// Tanks and MG nests from above: hull (or a ring of sandbags), then the turret turned to wherever the gunner aims.
Renderer.prototype.drawArmor = function (ctx, v, game) {
  const d = v.def, L = d.len, Wd = d.wid, dead = !v.alive, tank = d.id === 'tank';
  const team = v.driver ? v.driver.team : v.team, side = WAR_SIDES[team] || null;
  ctx.save(); ctx.translate(v.x, v.y);
  if (dead) ctx.globalAlpha = U.clamp(v.wreckT / 2, 0, 1);
  const hull = dead ? '#2b2b2e' : v.flash > 0 ? '#ffffff' : v.color;
  if (tank) {
    ctx.save(); ctx.translate(6, 9); ctx.rotate(v.angle); ctx.fillStyle = 'rgba(0,0,0,0.3)'; this.rr(ctx, -L / 2, -Wd / 2, L, Wd, 8); ctx.fill(); ctx.restore();
    ctx.save(); ctx.rotate(v.angle);
    ctx.fillStyle = '#18191c'; for (const s of [-1, 1]) { this.rr(ctx, -L / 2, s > 0 ? Wd / 2 - 14 : -Wd / 2, L, 14, 5); ctx.fill(); }
    const roll = ((v.x * Math.cos(v.angle) + v.y * Math.sin(v.angle)) % 12 + 12) % 12; // treads crawl as it moves
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = -L / 2 + 4 + roll; x < L / 2 - 2; x += 12) for (const s of [-1, 1]) { const y = s > 0 ? Wd / 2 - 14 : -Wd / 2; ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 12); }
    ctx.stroke();
    ctx.fillStyle = hull; this.rr(ctx, -L / 2 + 5, -Wd / 2 + 10, L - 10, Wd - 20, 6); ctx.fill();
    ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-L / 2 + 9, -Wd / 2 + 14, 20, Wd - 28); // engine deck
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let x = -L / 2 + 13; x < -L / 2 + 28; x += 5) { ctx.moveTo(x, -Wd / 2 + 16); ctx.lineTo(x, Wd / 2 - 16); } ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(L / 2 - 26, -Wd / 2 + 13, 16, Wd - 26); // glacis catching the light
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(5, 7, v.r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2218'; ctx.beginPath(); ctx.arc(0, 0, v.r - 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dead ? '#3a3630' : v.flash > 0 ? '#fff' : '#b39a6b'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; ctx.save(); ctx.rotate(a); this.rr(ctx, v.r - 13, -10, 14, 20, 6); ctx.fill(); ctx.stroke(); ctx.restore(); }
  }
  ctx.rotate(v.turret);
  if (tank) {
    ctx.fillStyle = '#1d1e22'; ctx.fillRect(14, -5, d.gun.muzzle - 14, 10); ctx.fillRect(d.gun.muzzle - 8, -7, 10, 14); ctx.fillRect(16, 9, 26, 4);
    ctx.fillStyle = hull; this.rr(ctx, -22, -19, 42, 38, 12); ctx.fill(); ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(-6, 0, 9, 0, Math.PI * 2); ctx.fill();
    if (side && !dead) { ctx.fillStyle = side.color; ctx.fillRect(-19, -15, 7, 30); }
  } else {
    ctx.fillStyle = '#1d1e22'; ctx.fillRect(4, -3, d.gun.muzzle - 4, 6); ctx.fillRect(-4, -8, 14, 16);
    if (v.driver && !dead) { ctx.fillStyle = v.driver.color; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-10, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
  if (dead) return;
  const p = game.player, mine = v.driver && v.driver.team === p.team, top = v.y - Math.max(L, Wd) / 2 - 8;
  if (mine && p.car !== v) { ctx.strokeStyle = 'rgba(127,245,122,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(v.x, v.y, v.r + 12, 0, Math.PI * 2); ctx.stroke(); }
  if (v.hp < v.maxHp && (v.driver || game.time - v.lastDamaged < 5)) {
    const bw = 64, bx = v.x - bw / 2, k = v.hp / v.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, top - 5, bw, 6);
    ctx.fillStyle = k > 0.4 ? '#e8c94a' : '#e05a4a'; ctx.fillRect(bx, top - 5, bw * k, 6);
  }
  if (v.driver && v.driver.isPlayer) this.label(ctx, 'You', v.x, top - 10, '12px');
  else if (!v.driver && p.alive && !p.car && U.dist(v.x, v.y, p.x, p.y) < 240) this.label(ctx, '[E] ' + v.name, v.x, top - 4, '12px', '#ffe08a');
  // cannon reload under the player's tank
  if (v.driver === p && d.gun.cannon && v.gunCd > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(v.x, v.y, v.r + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - v.gunCd / d.gun.cannon)); ctx.stroke(); }
};
Renderer.prototype.drawWarMinimap = function (c, game, k) {
  const war = game.war, p = game.player;
  for (const s of war.shells) { c.strokeStyle = s.team !== p.team ? '#ff5046' : '#78b4ff'; c.lineWidth = 1; c.beginPath(); c.arc(s.x * k, s.y * k, 4, 0, Math.PI * 2); c.stroke(); }
  for (const v of game.vehicles) {
    if (!v.alive || !v.driver || v.def.id !== 'tank' || v.driver === p) continue;
    c.fillStyle = v.driver.team === p.team ? '#7ff57a' : '#ff4a3a'; c.strokeStyle = '#000'; c.lineWidth = 1;
    c.fillRect(v.x * k - 3, v.y * k - 2.5, 6, 5); c.strokeRect(v.x * k - 3, v.y * k - 2.5, 6, 5);
  }
  if (war.drop) { c.fillStyle = '#ffd65a'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(war.drop.x * k, war.drop.y * k, 3.5 + Math.sin(game.time * 6), 0, Math.PI * 2); c.fill(); c.stroke(); }
  c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const pt of war.points) {
    c.fillStyle = pt.owner < 0 ? '#d8d8d8' : WAR_SIDES[pt.owner].color; c.strokeStyle = Math.abs(pt.cap) < 0.999 && Math.sin(game.time * 8) > 0 ? '#fff' : '#000'; c.lineWidth = 1.5;
    c.fillRect(pt.x * k - 6, pt.y * k - 6, 12, 12); c.strokeRect(pt.x * k - 6, pt.y * k - 6, 12, 12);
    c.fillStyle = pt.owner < 0 ? '#222' : '#fff'; c.fillText(pt.id, pt.x * k, pt.y * k + 0.5);
  }
};
