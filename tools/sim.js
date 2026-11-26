// Headless simulation of the game logic (no DOM/canvas). Run: node sim.js <projectDir>
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = process.argv[2] || path.join(__dirname, '..');
const ctx = { console, Math, performance, window: { addEventListener() {}, AudioContext: null }, requestAnimationFrame() {} };
ctx.window.Sound = undefined;
ctx.MAP_NAME = process.env.MAP || 'grass';
vm.createContext(ctx);
for (const f of ['utils', 'sound', 'weapons', 'modes', 'world', 'entities', 'ai']) {
  const code = fs.readFileSync(path.join(dir, 'js', f + '.js'), 'utf8').replace(/^'use strict';/, '');
  // hoist top-level const/class into the context by turning them into globals
  vm.runInContext(code.replace(/^const /gm, 'var ').replace(/^class (\w+)/gm, 'var $1 = class $1'), ctx, { filename: f + '.js' });
}
vm.runInContext('Sound.init = function(){}; for (const k of ["shot","tone","pickup","hitmarker","hurt","kill","zone","reload","boom"]) Sound[k] = function(){};', ctx);

const game = vm.runInContext(`(function(){
  const game = {
    time: 0, dt: 0, world: new World(MAPS[MAP_NAME] || MAPS.grass), actors: [], bullets: [], particles: [], brains: [], loot: [],
    renderer: { camX: 0, camY: 0 }, deaths: 0, shots: 0, pickups: 0, zoneDeaths: 0,
    spawnBullet(o, x, y, a, w) { this.bullets.push(new Bullet(o, x, y, a, w)); },
    onShot() { this.shots++; }, onHit(v, b, dealt) { this.bulletDmg = (this.bulletDmg || 0) + dealt; }, sparks() {}, onPickup() { this.pickups++; }, notify() {}, onSecondWind() {},
    explode(x, y, dmg, owner, direct, r = 75, hurtOwner = false) {
      this.explosions = (this.explosions || 0) + 1;
      for (const a of this.actors) {
        if (!a.alive || (a === owner && !hurtOwner)) continue;
        const d = U.dist(a.x, a.y, x, y); if (d > r + a.r) continue;
        const dealt = a.takeDamage(dmg * (a === direct ? 0.35 : a === owner ? 0.5 : 1) * (1 - 0.6 * U.clamp((d - a.r) / r, 0, 1)), owner, this, false);
        this.splashDmg = (this.splashDmg || 0) + dealt;
      }
    },
    dropLoot(x, y, kind, weapon) { this.world.loot.push(new Loot(U.clamp(x, 30, this.world.w - 30), U.clamp(y, 30, this.world.h - 30), kind, weapon)); },
    onDeath(v, killer) {
      this.deaths++; if (!killer) this.zoneDeaths++;
      (this.deathTimes = this.deathTimes || []).push(Math.round(this.time));
      if (killer) killer.kills++;
      for (const w of v.weapons) this.dropLoot(v.x, v.y, 'weapon', w);
      v.weapons = [];
    },
  };
  for (let i = 0; i < 32; i++) {
    const p = game.world.freeSpot(30, 150);
    const a = new Actor(p.x, p.y, 'Bot' + i, '#fff', false);
    game.actors.push(a); game.brains.push(new BotBrain(a));
  }
  game.player = game.actors[0];
  return game;
})()`, ctx);

const U = ctx.U;
const dt = 1 / 60;
let frames = 0;
const t0 = Date.now();
while (game.time < 400 && game.actors.filter(a => a.alive).length > 1) {
  game.time += dt; game.dt = dt;
  game.world.zone.update(dt);
  for (const a of game.actors) if (a.alive) { a.vx = 0; a.vy = 0; }
  for (const br of game.brains) if (br.bot.alive) br.update(dt, game);
  for (const a of game.actors) {
    if (!a.alive) continue;
    a.update(dt, game); game.world.resolveCircle(a);
    if (!game.world.zone.contains(a.x, a.y)) a.takeDamage(game.world.zone.dps * dt, null, game, true);
    if (!a.alive) continue;
    for (const l of game.world.loot) if (l.alive && U.dist(a.x, a.y, l.x, l.y) < a.r + l.r) a.pickup(l, game, false);
    if (game.world.circleBlocked(a.x, a.y, a.r - 2)) throw new Error('actor inside obstacle at ' + a.x + ',' + a.y);
    if (!isFinite(a.x) || !isFinite(a.y)) throw new Error('NaN position');
  }
  for (const b of game.bullets) b.update(dt, game);
  game.bullets = game.bullets.filter(b => b.alive);
  frames++;
}
const alive = game.actors.filter(a => a.alive);
console.log(JSON.stringify({
  simSeconds: Math.round(game.time), frames, realMs: Date.now() - t0,
  obstacles: game.world.obstacles.length, lootSpawned: game.world.loot.length,
  alive: alive.length, deaths: game.deaths, zoneDeaths: game.zoneDeaths, shots: game.shots, pickups: game.pickups,
  zonePhase: game.world.zone.phase, zoneState: game.world.zone.state, zoneR: Math.round(game.world.zone.r),
  topKills: Math.max(...game.actors.map(a => a.kills)), explosions: game.explosions || 0,
  bulletDmg: Math.round(game.bulletDmg || 0), splashDmg: Math.round(game.splashDmg || 0),
  deathsPer30s: (game.deathTimes || []).reduce((b, t) => { b[Math.floor(t / 30)] = (b[Math.floor(t / 30)] || 0) + 1; return b; }, []),
  weaponsHeld: alive.map(a => a.weapons.map(w => w.key + ':' + w.ammo + '/' + w.reserve)),
}, null, 1));
