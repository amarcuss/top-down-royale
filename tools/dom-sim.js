// Runs the real Game class headless, with the DOM and canvas stubbed out. Unlike sim.js this exercises
// game.js and render.js too (modes, cars, HUD, drawing), so it catches runtime errors anywhere in a match.
//
//   node tools/dom-sim.js                      one Solo match with a bot driving the player
//   MODE=mega MAP=grass node tools/dom-sim.js  any mode / map
// Env: MODE, MAP, DIFF, MUT, MAXS (sim seconds, default 600), BOTPLAYER=0 (leave the player idle),
//      FULL=1 (keep simulating after the player's squad is out, until one team is left),
//      NOCARS=1 (same match without vehicles, for comparing pacing),
//      MISSION=n (with MODE=campaign: which mission, 1-based), CAMPTEST=1 (walk an invulnerable player through
//      every objective of the mission by teleporting; must end in a win),
//      SKIPTO=n (campaign: jump the squad to stage n, 0-based, and let a mortal bot player fight it out there;
//      a difficulty probe for fights like the lighthouse defence),
//      WARLOG=1 (War: who holds what, reinforcements and tanks every 30s),
//      STUCK=1 (every 4s, count bots and tanks that want to be somewhere else but have barely moved, and what they are next to),
//      ALIVELOG=1 (alive count every 30s), CARLOG=1 (car stats every 30s), DRAW=N (render every N frames, default 6)
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..');
const env = process.env;

// a canvas context that accepts anything
const gradient = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => gradient : k === 'measureText' ? () => ({ width: 10 }) : () => undefined),
  set: (t, k, v) => { t[k] = v; return true; },
});
const els = {};
const makeEl = (id) => ({
  id, width: 200, height: 200, style: {}, dataset: {}, innerHTML: '', textContent: '', tagName: 'DIV',
  classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
  addEventListener() {}, appendChild() {}, getContext: () => ctx2d, requestPointerLock() {},
});
const store = {};
const sandbox = {
  console, Math, performance, URLSearchParams, setTimeout,
  document: { getElementById: (id) => els[id] || (els[id] = makeEl(id)), createElement: () => makeEl('tmp'), addEventListener() {}, body: makeEl('body'), pointerLockElement: null, exitPointerLock() {} },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  requestAnimationFrame() {}, confirm: () => true, location: { search: '' },
  ErrorEvent: class { constructor(type, o) { Object.assign(this, o); } },
};
sandbox.window = { addEventListener() {}, innerWidth: 1600, innerHeight: 900, dispatchEvent(e) { throw new Error('game reported: ' + e.message); } };
vm.createContext(sandbox);
for (const f of ['utils', 'sound', 'weapons', 'progress', 'modes', 'world', 'entities', 'ai', 'campaign', 'input', 'render', 'war', 'tutorial', 'game', 'online']) {
  const code = fs.readFileSync(path.join(dir, 'js', f + '.js'), 'utf8').replace(/^'use strict';/, '');
  vm.runInContext(code.replace(/^const /gm, 'var ').replace(/^class (\w+)/gm, 'var $1 = class $1'), sandbox, { filename: f + '.js' });
}

const { Game, Progress, BotBrain, U } = sandbox;
const game = new Game();
const prefs = Progress.data.prefs;
prefs.mode = env.MODE || 'solo'; prefs.map = env.MAP || 'grass'; prefs.difficulty = env.DIFF || 'normal'; prefs.mutator = env.MUT || 'none';
if (env.NOCARS) sandbox.MODES[prefs.mode] = Object.assign({}, sandbox.MODES[prefs.mode], { cars: 0 });
if (env.FWD || env.MID) sandbox.War.force = { fwd: env.FWD, mid: env.MID }; // pin the terrain: FWD=farm|quarry|bunkers MID=village|fort|wood|crossroads
if (env.BATTLE) prefs.battle = env.BATTLE; // War: front, assault or defend (default: random)
if (env.MISSION) { prefs.mission = +env.MISSION - 1; Progress.data.campaign.unlocked = 9; }
game.buildPickers(); if (prefs.mode === 'campaign') game.showBriefing(); // exercise the menu and briefing code too
game.start();
if (env.BOTPLAYER !== '0' && !env.CAMPTEST) { // a bot plays the player's seat (controlPlayer would fight it for the aim, so it is stubbed)
  game.controlPlayer = () => {};
  game.brains.push(new BotBrain(game.player));
}

if (env.SKIPTO && game.camp) {
  const c = game.camp, p = game.player; c.i = +env.SKIPTO;
  const m = sandbox.Campaign.marks(game)[0] || p, br = game.brains[game.brains.length - 1];
  for (const a of game.actors) if (a.team === 0) { const q = game.spotNear(m.x, m.y, 30, 150, a.r) || m; a.x = q.x; a.y = q.y; }
  br.post = { x: m.x, y: m.y, r: 130 }; br.noCarUntil = Infinity; game.holdingE = true;
}

const dt = 1 / 60, maxS = +(env.MAXS || 600), drawEvery = +(env.DRAW || 6);
const st = { entered: 0, ramKills: 0, destroyed: 0, smashed: 0, topSpeed: 0, driverSeconds: 0, passengerSeconds: 0 };
const wrap = (name, fn) => { const o = game[name].bind(game); game[name] = (...a) => fn(o, ...a); };
wrap('enterVehicle', (o, a, v) => { const ok = o(a, v); if (ok) st.entered++; return ok; });
wrap('destroyVehicle', (o, v) => { if (v.alive) st.destroyed++; return o(v); });
wrap('onSmash', (o, v, c) => { st.smashed++; return o(v, c); });
const causes = {};
wrap('onDeath', (o, victim, killer) => { if (game.war) { const k = (victim.lastHitWeapon || 'none') + (victim.cover ? '+cover' : '') + (victim.isPlayer ? ' (player)' : ''); causes[k] = (causes[k] || 0) + 1; } if (env.DEATHLOG && victim.team === 0) console.log(game.time.toFixed(1) + 's ' + victim.name + ' killed by ' + (killer ? killer.name + ' team ' + killer.team + ' ' + (killer.weapon && killer.weapon.key) + ' at ' + Math.round(U.dist(killer.x, killer.y, victim.x, victim.y)) + 'px' : 'nobody') + ' lastHit ' + victim.lastHitWeapon); if (victim.lastHitWeapon === 'car' && game.time - victim.ramAt < 0.05) st.ramKills++; return o(victim, killer); });

if (env.FULL) wrap('endGame', (o, win) => { if (game.aliveTeams().size <= 1) o(win); });

// CAMPTEST: once a second, go wherever the current objective is and do it.
const stagesSeen = [];
function campStep() {
  const c = game.camp, p = game.player, st = c.stages[c.i]; if (!st) return;
  game.controlPlayer = () => {};
  p.invuln = 1; game.holdingE = true;
  if (!stagesSeen.includes(c.i + ':' + st.type)) stagesSeen.push(c.i + ':' + st.type);
  if (frames % 60 !== 0) return;
  const go = (q) => { if (p.car) { p.car.x = q.x; p.car.y = q.y; p.car.speed = 0; } p.x = q.x; p.y = q.y; };
  if (st.type === 'reach' || st.type === 'hold' || st.type === 'survive') go(st.at);
  else if (st.type === 'breach') go(st.fuse === undefined ? st.compound.gate.out : { x: st.compound.gate.out.x - 400, y: st.compound.gate.out.y + 400 });
  else if (st.type === 'kill' || st.type === 'clear') { const t = st.targets.find((a) => a.alive); if (t) t.takeDamage(99999, p, game, false); }
  else if (st.type === 'deliver') { if (!p.car) { go(st.car); game.enterVehicle(p, st.car); } else go(st.at); }
}

// STUCK: a bot with somewhere to be (not fighting, destination over 150px away) that moved under 25px in 4 seconds
const stuck = { samples: 0, stuck: 0, tankSamples: 0, tankStuck: 0, near: {} };
let stuckNext = 4;
function stuckStep() {
  stuckNext += 4;
  for (const br of game.brains) {
    const b = br.bot, was = br._was; br._was = null;
    if (!b.alive || !br.dest || br.state === 'fight' || br.state === 'nest' || br.state === 'ride') continue;
    const tank = b.car && b.car.driver === b, e = tank ? b.car : b;
    if (b.car && !tank) continue;
    if (U.dist(e.x, e.y, br.dest.x, br.dest.y) < 150 || (br.target && br.target.alive)) continue;
    br._was = { x: e.x, y: e.y, tank };
    if (!was || was.tank !== tank) continue;
    if (tank) stuck.tankSamples++; else stuck.samples++;
    if (U.dist(e.x, e.y, was.x, was.y) > 25) continue;
    if (tank) stuck.tankStuck++; else stuck.stuck++;
    let kind = 'open', bd = 90;
    game.world.cellsAround(e.x, e.y, 120, (o) => {
      const nx = o.type === 'rect' ? U.clamp(e.x, o.x, o.x + o.w) : o.x, ny = o.type === 'rect' ? U.clamp(e.y, o.y, o.y + o.h) : o.y;
      const d = U.dist(e.x, e.y, nx, ny) - (o.type === 'rect' ? 0 : o.r);
      if (d < bd) { bd = d; kind = o.kind; }
    });
    const k = (tank ? 'tank:' : '') + kind + ':' + br.state; stuck.near[k] = (stuck.near[k] || 0) + 1;
  }
}
let frames = 0, next = 30;
const t0 = Date.now();
while (game.time < maxS && game.state === 'playing') {
  if (env.CAMPTEST) campStep();
  if (env.STUCK && game.time >= stuckNext) stuckStep();
  game.dt = dt; game.update(dt);
  if (frames % drawEvery === 0) { game.renderer.draw(game); game.updateHud(); }
  game.input.endFrame();
  for (const v of game.vehicles) {
    if (!v.alive) continue;
    st.topSpeed = Math.max(st.topSpeed, Math.abs(v.speed));
    if (v.driver) st.driverSeconds += dt; st.passengerSeconds += v.passengers.length * dt;
    if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.speed)) throw new Error('car NaN');
    if (v.driver && v.driver.car !== v) throw new Error('driver not linked to car');
  }
  for (const a of game.actors) {
    if (!isFinite(a.x) || !isFinite(a.y)) throw new Error('actor NaN');
    if (a.car && (!a.alive || !a.car.alive)) throw new Error('dead actor or dead car still linked');
  }
  frames++;
  if (game.time >= next) {
    next += 30;
    if (env.WARLOG && game.war) console.log(Math.round(game.time) + 's ' + game.war.points.map((p) => (p.owner < 0 ? '-' : p.owner) + '(' + p.cap.toFixed(1) + ' ' + p.n.join('v') + ')').join(' ') + ' ' + game.war.phase.kind + (game.war.phase.team >= 0 ? game.war.phase.team : '') + ' tickets ' + game.war.tickets.join('-') + ' tanks ' + [0, 1].map((t) => game.vehicles.filter((v) => v.alive && v.def.id === 'tank' && v.driver && v.driver.team === t).length).join('-') + ' nests ' + game.vehicles.filter((v) => v.alive && v.def.id === 'nest' && v.driver).length + ' loot ' + game.world.loot.length + ' kills ' + game.player.kills + '/' + game.player.deaths);
    if (env.ALIVELOG) console.log(Math.round(game.time) + 's alive ' + game.aliveCount() + ' teams ' + game.aliveTeams().size + ' zoneR ' + Math.round(game.world.zone.r));
    if (env.CARLOG) console.log(Math.round(game.time) + 's cars ' + game.vehicles.filter((v) => v.alive).length + ' driven ' + game.vehicles.filter((v) => v.driver).length + ' ' + JSON.stringify(st, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
  }
}
if (game.state === 'over') { game.update(dt); game.showOverPanel(); }
console.log(JSON.stringify({
  mode: game.mode.id, map: game.map.id, simSeconds: Math.round(game.time), msPerFrame: +((Date.now() - t0) / frames).toFixed(2),
  state: game.state, win: game.win, placement: game.placement, alive: game.aliveCount(), playerKills: game.player.kills,
  obstacles: game.world.obstacles.length, loot: game.world.loot.length, roads: game.world.roads.length,
  campaign: game.camp ? { mission: game.camp.m.name, stage: game.camp.i + '/' + game.camp.stages.length, stagesSeen, fail: game.camp.fail, enemies: game.camp.enemies.length, unlocked: Progress.data.campaign.unlocked, title: els['over-title'] && els['over-title'].textContent, again: els['again-btn'] && els['again-btn'].textContent } : undefined,
  war: game.war ? { battle: game.war.id, layout: game.world.sites.layout, sky: game.war.sky.name, log: game.war.log.join(' '), causes: env.CAUSES ? JSON.stringify(causes) : undefined, flips: game.war.flips, playerKD: game.player.kills + '/' + game.player.deaths, result: game.war.result, tickets: game.war.tickets, owners: game.war.points.map((p) => p.owner), captures: game.war.captures, title: els['over-title'] && els['over-title'].textContent } : undefined,
  stuck: env.STUCK ? stuck : undefined,
  squadAlive: game.actors.filter((a) => a.alive && a.team === 0).length, playerHp: Math.round(game.player.hp),
  cars: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, Math.round(v)])), carsLeft: game.vehicles.filter((v) => v.alive).length,
}, null, 1));
