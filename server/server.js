// Top-Down Royale game server: online Deathmatch.
//
//   npm install && npm start          (PORT, default 8787)
//
// Each room runs the real game (the same js/ files the browser loads) in its own sandbox, with the screen stubbed
// out. Every fighter starts as a bot; a player who joins takes one over, and it goes back to being a bot when they
// leave. Clients send controls; the server sends the state of the match 20 times a second. See js/online.js.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = +(process.env.PORT || 8787);
const MAX_HUMANS = 8;          // real players per 12-fighter match; the rest are bots
const BOT_L = 0.3;             // bot lethality online (0.1 Easy, 0.45 Normal)
const TICK = 1 / 60, SNAP_EVERY = 3, INTERMISSION = 8, IDLE_KICK = 90;
const FILES = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/js\/\w+\.js/g).map((f) => f.slice(3, -3));
const SOURCES = FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8').replace(/^'use strict';/, '').replace(/^const /gm, 'var ').replace(/^class (\w+)/gm, 'var $1 = class $1')]);

// The game, with the page it expects stubbed out (as tools/dom-sim.js does).
function makeSandbox() {
  const gradient = { addColorStop() {} };
  const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => gradient : k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: (t, k, v) => { t[k] = v; return true; } });
  const els = {}, store = {};
  const makeEl = (id) => ({ id, width: 200, height: 200, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', tagName: 'DIV',
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    addEventListener() {}, appendChild() {}, getContext: () => ctx2d, requestPointerLock() {} });
  const sb = { console, Math, performance, URLSearchParams, setTimeout,
    document: { getElementById: (id) => els[id] || (els[id] = makeEl(id)), createElement: () => makeEl('tmp'), addEventListener() {}, body: makeEl('body'), pointerLockElement: null, exitPointerLock() {} },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    requestAnimationFrame() {}, confirm: () => true, location: { search: '' }, navigator: {}, ErrorEvent: class { constructor(type, o) { Object.assign(this, o); } } };
  sb.window = { addEventListener() {}, innerWidth: 1600, innerHeight: 900, dispatchEvent(e) { throw new Error('game reported: ' + e.message); } };
  vm.createContext(sb);
  for (const [f, code] of SOURCES) vm.runInContext(code, sb, { filename: f + '.js' });
  return sb;
}

const clean = (s, n) => String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, n);
let roomSeq = 0;

class Room {
  constructor() {
    this.id = ++roomSeq; this.sb = makeSandbox(); this.game = new this.sb.Game();
    this.clients = new Set(); this.humans = new Map(); this.waiting = new Set();
    this.acc = 0; this.steps = 0; this.emptyFor = 0; this.intermission = 0;
    this.startMatch();
  }
  get size() { return this.humans.size + this.waiting.size; }

  startMatch() {
    const sb = this.sb, g = this.game, P = sb.Progress;
    P.reset();
    Object.assign(P.data.prefs, { mode: 'deathmatch', map: 'random', difficulty: 'normal', mutator: 'none' });
    P.data.tutorialDone = true; P.data.stats.matches = 10; P.lethality = () => BOT_L;
    g.input.touch = false; g.net = null;
    g.netSeed = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
    this.seed = g.netSeed;
    g.start();
    g.netSeed = 0;
    if (process.env.MATCH_SECONDS) g.timeLeft = +process.env.MATCH_SECONDS; // short matches for testing
    g.controlPlayer = () => {};
    // the slot the single-player game calls "the player" is just another bot here
    const used = new Set(g.actors.map((a) => a.name)), spare = sb.BOT_NAMES.filter((n) => !used.has(n));
    g.player.name = spare[Math.floor(Math.random() * spare.length)] || 'Ace'; g.player.skin = null;
    const br = new sb.BotBrain(g.player); g.toughenBot(g.player, br); g.brains.push(br);
    for (const a of g.actors) a.human = false;

    this.events = []; this.lootSig = new Map(); this.humans.clear(); this.overSent = false; this.intermission = 0; this.steps = 0;
    this.lootInit = new Map();
    for (const l of g.world.loot) { this.lootSig.set(l.nid, this.sig(l)); this.lootInit.set(l.nid, this.sig(l)); }
    // record what clients need to draw: bullets, shots, deaths, drops, messages
    const ev = this.events, self = this;
    const spawnBullet = g.spawnBullet.bind(g), onShot = g.onShot.bind(g), onDeath = g.onDeath.bind(g), dropLoot = g.dropLoot.bind(g);
    g.spawnBullet = (o, x, y, ang, w) => { ev.push(['b', o.id, Math.round(x), Math.round(y), Math.round(ang * 1000), w.key]); return spawnBullet(o, x, y, ang, w); };
    g.onShot = (a, w, mx, my) => { ev.push(['s', a.id, w.key, Math.round(mx), Math.round(my)]); return onShot(a, w, mx, my); };
    g.onDeath = (v, killer) => {
      const before = new Map(g.actors.map((a) => [a, a.kills])), wk = v.lastHitWeapon || '';
      const r = onDeath(v, killer);
      const k = g.actors.find((a) => a.kills > before.get(a));
      ev.push(['k', v.id, k ? k.id : 0, wk, killer === v ? 1 : 0]);
      return r;
    };
    g.dropLoot = (x, y, kind, weapon) => {
      const n = g.world.loot.length, r = dropLoot(x, y, kind, weapon);
      if (g.world.loot.length > n) { const l = g.world.loot[g.world.loot.length - 1]; l.nid = g.world.nextLootId++; self.lootSig.set(l.nid, self.sig(l)); ev.push(['l'].concat(self.lootRow(l))); }
      return r;
    };
    g.notify = (actor, text) => { for (const [c, h] of self.humans) if (h.actor === actor) c.priv.push(['n', String(text)]); };
    for (const c of Array.from(this.waiting)) { this.waiting.delete(c); this.attach(c); }
  }

  sig(l) { return (l.alive ? '1' : '0') + l.kind + (l.weapon ? l.weapon.key : ''); }
  lootRow(l) { return [l.nid, l.alive ? 1 : 0, l.kind, l.weapon ? l.weapon.key : '', Math.round(l.x), Math.round(l.y), l.weapon ? l.weapon.ammo : 0, l.weapon ? l.weapon.reserve : 0]; }
  roster(list) { return list.map((a) => ({ id: a.id, name: a.name, color: a.color, skin: a.skinId || '', human: a.human ? 1 : 0, x: Math.round(a.x), y: Math.round(a.y) })); }

  // A player takes over the bot with the fewest kills.
  attach(c) {
    const g = this.game, sb = this.sb;
    if (g.state !== 'playing' || this.intermission > 0) { this.waiting.add(c); c.send({ t: 'wait', s: Math.max(1, this.intermission) }); return; }
    const bots = g.brains.filter((b) => b instanceof sb.BotBrain).sort((a, b) => a.bot.kills - b.bot.kills || a.bot.id - b.bot.id);
    if (!bots.length || this.humans.size >= MAX_HUMANS) { c.send({ t: 'err', msg: 'That match is full. Try again.' }); return; }
    const a = bots[0].bot; g.brains.splice(g.brains.indexOf(bots[0]), 1);
    const it = c.skin ? sb.Progress.item(c.skin) : null, skin = it && it.type === 'skin' ? it : null;
    a.name = c.name; a.human = true; a.kills = 0; a.deaths = 0; a.speed = 235; a.skin = skin ? skin.value : null; a.skinId = skin ? skin.id : ''; if (skin) a.color = skin.value.color;
    a.powers = null; a.homing = false; a.explosive = false; a.pierce = 0; a.lifesteal = 0; a.secondWind = 0; a.rateMult = 1; a.magMult = 1; // no bot perks for people
    const hb = { bot: a, human: true, state: 'human', target: null, dest: null, heard: null, hunter: false, obj: null,
      inp: { x: 0, y: 0, a: a.angle, f: 0, o: 0, w: -1 }, ack: 0,
      update(dt, game) {
        const i = this.inp, len = Math.hypot(i.x, i.y);
        if (len > 0.2) a.move(i.x / len, i.y / len, dt);
        a.angle = i.a;
        if (i.w >= 0 && i.w < a.weapons.length && i.w !== a.wi) a.switchTo(i.w);
        if (i.o & 1) a.reload();
        if (i.o & 2) a.useMed();
        i.o = 0;
        if (i.f) a.tryShoot(game);
      } };
    g.brains.push(hb);
    this.humans.set(c, { actor: a, hb }); c.room = this; c.priv = []; c.lastInput = Date.now();
    c.send({ t: 'init', you: a.id, seed: this.seed, map: g.map.id, time: +g.time.toFixed(2), timeLeft: +g.timeLeft.toFixed(2), actors: this.roster(g.actors),
      loot: g.world.loot.filter((l) => this.lootInit.get(l.nid) !== this.sig(l)).map((l) => this.lootRow(l)), snap: this.snapshot(c) });
    this.broadcast({ t: 'roster', actors: this.roster([a]) }, c);
    log('room', this.id, 'join', c.name, '(' + this.humans.size + ' players)');
  }
  // They left: the fighter is a bot again.
  detach(c) {
    this.waiting.delete(c); this.clients.delete(c);
    const h = this.humans.get(c); if (!h) return;
    this.humans.delete(c);
    const g = this.game, a = h.actor, i = g.brains.indexOf(h.hb);
    if (i >= 0) g.brains.splice(i, 1);
    a.human = false; a.skin = null; a.skinId = '';
    const br = new this.sb.BotBrain(a); g.toughenBot(a, br); g.brains.push(br);
    this.broadcast({ t: 'roster', actors: this.roster([a]) });
    log('room', this.id, 'leave', c.name, '(' + this.humans.size + ' players)');
  }
  input(c, m) {
    const h = this.humans.get(c); if (!h) return;
    const i = h.hb.inp, num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
    i.x = num(m.x, -1, 1); i.y = num(m.y, -1, 1); i.a = num(m.a, -4000, 4000) / 1000; i.f = m.f ? 1 : 0; i.o |= num(m.o, 0, 3) | 0; i.w = num(m.w, -1, 2) | 0;
    h.hb.ack = num(m.q, 0, 1e9) | 0; c.lastInput = Date.now();
  }
  broadcast(m, except) { const s = JSON.stringify(m); for (const c of this.humans.keys()) if (c !== except) c.sendRaw(s); }

  snapshot(c) {
    const g = this.game, h = this.humans.get(c);
    const a = g.actors.map((x) => [x.id, Math.round(x.x), Math.round(x.y), Math.round(x.angle * 100), Math.max(0, Math.ceil(x.hp)), Math.ceil(x.shield), x.alive ? 1 : 0, x.weapon ? x.weapon.key : '', x.kills, x.deaths,
      (x.healing > 0 ? 1 : 0) | (x.invuln > 0 ? 2 : 0) | (x.weapon && x.weapon.reloading ? 4 : 0)]);
    const m = { t: 's', tm: +g.time.toFixed(2), tl: +g.timeLeft.toFixed(2), a };
    if (h) { const p = h.actor; m.me = { ack: h.hb.ack, wi: p.wi, meds: p.meds, w: p.weapons.map((w) => [w.key, w.ammo, w.infinite ? 999 : w.reserve, w.reloading ? 1 : 0, +(w.reloadT || 0).toFixed(2), w.reloadTotal || w.reload]) }; }
    return m;
  }

  step(dt) {
    const g = this.game;
    if (!this.clients.size) { this.emptyFor += dt; return; }
    this.emptyFor = 0;
    if (this.intermission > 0) { this.intermission -= dt; if (this.intermission <= 0) this.startMatch(); return; }
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      g.dt = TICK; g.update(TICK); g.input.endFrame();
      if (g.state !== 'playing' && !this.overSent) return this.finish();
      if (++this.steps % SNAP_EVERY === 0) this.sendSnapshots();
    }
  }
  sendSnapshots() {
    const g = this.game, ev = this.events;
    for (const l of g.world.loot) { const s = this.sig(l); if (this.lootSig.get(l.nid) !== s) { this.lootSig.set(l.nid, s); ev.push(['l'].concat(this.lootRow(l))); } }
    const now = Date.now();
    for (const c of Array.from(this.humans.keys())) {
      if (now - c.lastInput > IDLE_KICK * 1000) { c.send({ t: 'err', msg: 'You were away too long.' }); c.close(); continue; }
      const m = this.snapshot(c); m.e = c.priv.length ? ev.concat(c.priv) : ev; c.priv = [];
      c.send(m);
    }
    ev.length = 0;
  }
  finish() {
    this.overSent = true; this.sendSnapshots();
    const rank = (this.game.scoreboard || this.game.arenaRanking()).map((a) => a.id);
    for (const c of Array.from(this.humans.keys())) { c.send({ t: 'over', rank }); }
    // everyone is asked to press PLAY AGAIN: fighters go back to the bots until they do
    for (const c of Array.from(this.humans.keys())) { this.humans.delete(c); }
    this.intermission = INTERMISSION;
    log('room', this.id, 'match over');
  }
}

// ---------------------------------------------------------------- connections
const rooms = new Set();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function roomFor() {
  for (const r of rooms) if (r.size < MAX_HUMANS) return r;
  const r = new Room(); rooms.add(r); log('room', r.id, 'opened'); return r;
}

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Top-Down Royale game server: ' + rooms.size + ' rooms, ' + Array.from(rooms).reduce((n, r) => n + r.humans.size, 0) + ' players\n'); });
const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  const c = { ws, name: 'Player', skin: '', room: null, priv: [], lastInput: Date.now(),
    sendRaw(s) { if (ws.readyState === 1 && ws.bufferedAmount < 262144) ws.send(s); }, send(m) { this.sendRaw(JSON.stringify(m)); }, close() { try { ws.close(); } catch (e) { /* gone */ } } };
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try {
      if (m.t === 'i') { if (c.room) c.room.input(c, m); }
      else if (m.t === 'join') {
        const proto = vm.runInContext('NET_PROTOCOL', (c.room || roomFor()).sb);
        if (m.v !== proto) { c.send({ t: 'err', msg: 'Update the game to play online.' }); return; }
        c.name = clean(m.name, 14) || 'Player'; c.skin = clean(m.skin, 24);
        if (!c.room || !c.room.clients.has(c)) { c.room = roomFor(); c.room.clients.add(c); }
        if (!c.room.humans.has(c)) c.room.attach(c);
      }
    } catch (e) { log('error', e && e.stack || e); }
  });
  ws.on('close', () => { if (c.room) c.room.detach(c); });
  ws.on('error', () => {});
});

let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const r of Array.from(rooms)) {
    try { r.step(dt); } catch (e) { log('room', r.id, 'crashed:', e && e.stack || e); for (const c of r.clients) { c.send({ t: 'err', msg: 'The match hit a problem. Please try again.' }); c.close(); } rooms.delete(r); continue; }
    if (r.emptyFor > 30) { rooms.delete(r); log('room', r.id, 'closed'); }
  }
}, 1000 / 120);
server.listen(PORT, () => log('listening on', PORT));
