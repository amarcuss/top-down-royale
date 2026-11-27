// Top-Down Royale game server.
//
//   npm install && npm start          (PORT, default 8787)
//
// Each room runs the real game (the same js/ files the browser loads) in its own sandbox, with the screen stubbed
// out. Every fighter starts as a bot; a player who joins takes one over, and it goes back to being a bot when they
// leave. Clients send controls; the server sends the state of the match 20 times a second. See js/online.js.
//
//   Deathmatch, Gun Game     join a running match at any time; matches follow one another in the same room
//   Solo, Duos, Squads, Mega a lobby collects players for a few seconds, then the match runs to the last squad;
//                            anyone who arrives after the start gets the next lobby
//
// Friends: each game keeps a secret id and its own list of friends; a friend code is a hash of the id, so it cannot be
// claimed by anyone else. The one thing kept on disk is the list of usernames (server/data/names.json: username and
// friend code), so a name belongs to one player and friends can be looked up by it. Two players see each other (online, in a match) only while both
// are connected and each has the other's code. A party is a group of friends the leader's DROP IN takes into the
// same match, and into the same squad when the mode has squads.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = +(process.env.PORT || 8787);
const NET_MODES = ['solo', 'duos', 'squads', 'mega', 'deathmatch', 'gungame'];
const BOT_L = 0.3;              // bot lethality online (0.1 Easy, 0.45 Normal)
const TICK = 1 / 60, SNAP_EVERY = 3, FULL_EVERY = 20, INTERMISSION = 8, IDLE_KICK = 90;
const LOBBY_WAIT = +(process.env.LOBBY_SECONDS || 10);
const NEAR = 1500;              // big matches: fighters this close to you are in every report
const FILES = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/js\/\w+\.js/g).map((f) => f.slice(3, -3));
const SOURCES = FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8').replace(/^'use strict';/, '').replace(/^const /gm, 'var ').replace(/^class (\w+)/gm, 'var $1 = class $1')]);
const PROTOCOL = +(/NET_PROTOCOL = (\d+)/.exec(fs.readFileSync(path.join(ROOT, 'js', 'online.js'), 'utf8')) || [0, 0])[1];
let PUSH = ''; try { PUSH = require('../tools/push-label')(); } catch (e) { /* no tools folder (Docker image): no label */ }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

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
const rooms = new Set();
let roomSeq = 0;

class Room {
  constructor(mode) {
    this.id = ++roomSeq; this.mode = mode; this.sb = makeSandbox(); this.game = new this.sb.Game();
    const def = this.sb.MODES[mode];
    this.royale = def.type === 'royale';
    this.max = this.royale ? Math.min(40, Math.floor(def.players / 2)) : 8; // real players per match; the rest are bots
    this.clients = new Set(); this.humans = new Map(); this.waiting = new Set();
    this.acc = 0; this.steps = 0; this.emptyFor = 0; this.intermission = 0; this.told = 0;
    this.phase = this.royale ? 'lobby' : 'playing'; this.lobbyT = LOBBY_WAIT;
    if (!this.royale) this.startMatch();
  }
  get size() { return this.humans.size + this.waiting.size; }
  get joinable() { return this.royale ? this.phase === 'lobby' && this.waiting.size < this.max : this.phase !== 'closed' && this.size < this.max; }

  startMatch() {
    const sb = this.sb, g = this.game, P = sb.Progress;
    P.reset();
    Object.assign(P.data.prefs, { mode: this.mode, map: 'random', difficulty: 'normal', mutator: 'none' });
    P.data.tutorialDone = true; P.data.stats.matches = 10; P.lethality = () => BOT_L;
    g.input.touch = false; g.net = null; g.hosting = true;
    g.netSeed = this.seed = (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
    g.start();
    g.netSeed = 0;
    if (process.env.MATCH_SECONDS && g.timeLeft) g.timeLeft = +process.env.MATCH_SECONDS; // short matches for testing
    g.vehicles.length = 0; // no cars online yet
    g.controlPlayer = () => {};
    // the slot the single-player game calls "the player" is just another bot here
    const used = new Set(g.actors.map((a) => a.name)), spare = sb.BOT_NAMES.filter((n) => !used.has(n));
    g.player.name = spare[Math.floor(Math.random() * spare.length)] || 'Ace'; g.player.skin = null;
    const br = new sb.BotBrain(g.player); g.toughenBot(g.player, br); br.likesCars = false; g.brains.push(br);
    for (const a of g.actors) a.human = false;

    this.phase = 'playing'; this.big = g.actors.length > 16;
    this.events = []; this.lootSig = new Map(); this.lootInit = new Map(); this.humans.clear(); this.overSent = false; this.intermission = 0; this.steps = 0;
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
    log('room', this.id, this.mode, 'match started on', g.map.id, 'with', this.humans.size, 'players');
  }

  sig(l) { return (l.alive ? '1' : '0') + l.kind + (l.weapon ? l.weapon.key : ''); }
  lootRow(l) { return [l.nid, l.alive ? 1 : 0, l.kind, l.weapon ? l.weapon.key : '', Math.round(l.x), Math.round(l.y), l.weapon ? l.weapon.ammo : 0, l.weapon ? l.weapon.reserve : 0]; }
  roster(list) { return list.map((a) => ({ id: a.id, name: a.name, color: a.color, team: a.team, skin: a.skinId || '', ch: a.char ? a.char.id : '', human: a.human ? 1 : 0, x: Math.round(a.x), y: Math.round(a.y) })); }

  // A player asks for a fighter. In a lobby, or between matches, they wait; otherwise they take over a bot now.
  attach(c) {
    const g = this.game, sb = this.sb;
    if (this.phase === 'lobby') { this.waiting.add(c); this.tellWaiting(); return; }
    if (g.state !== 'playing' || this.intermission > 0) { this.waiting.add(c); c.send({ t: 'wait', s: Math.max(1, this.intermission), n: this.waiting.size }); return; }
    // battle royale: the next free bot in order, so people who arrive together share a squad; arena: the bot doing worst
    const bots = g.brains.filter((b) => b instanceof sb.BotBrain).sort((a, b) => (this.royale ? 0 : a.bot.kills - b.bot.kills) || a.bot.id - b.bot.id);
    if (!bots.length || this.humans.size >= this.max) { c.send({ t: 'err', msg: 'That match is full. Try again.' }); return; }
    const pick = (this.royale && c.party && c.party.members.size > 1 && this.partyBot(c, bots)) || bots[0];
    const a = pick.bot; g.brains.splice(g.brains.indexOf(pick), 1);
    const it = c.skin ? sb.Progress.item(c.skin) : null, skin = it && it.type === 'skin' ? it : null;
    a.name = c.name; a.human = true; a.kills = 0; a.deaths = 0; a.speed = 235; a.skin = skin ? skin.value : null; a.skinId = skin ? skin.id : ''; if (skin) a.color = skin.value.color;
    a.powers = null; a.homing = false; a.explosive = false; a.pierce = 0; a.lifesteal = 0; a.secondWind = 0; a.rateMult = 1; // no bot power-ups for people
    // their character, at level 1 for everyone online: health, speed, signature weapon, ability
    const ch = sb.Chars.get(c.char) || sb.CHARACTERS[0], gg = this.mode === 'gungame';
    sb.Chars.apply(a, ch, 1, gg); a.spawnShield = 0; a.shield = 0;
    { const look = sb.Chars.look(ch, c.skin); a.skin = look; a.skinId = look.sid || ''; a.color = look.color; } // the character, in the skin they are wearing
    if (!gg) g.giveModeLoadout(a);
    g.applyMutator(a);
    const hb = { bot: a, human: true, state: 'human', target: null, dest: null, heard: null, hunter: false, obj: null,
      inp: { x: 0, y: 0, a: a.angle, f: 0, o: 0, w: -1 }, ack: 0,
      update(dt, game) {
        const i = this.inp, len = Math.hypot(i.x, i.y);
        if (len > 0.2) a.move(i.x / len, i.y / len, dt);
        a.angle = i.a;
        if (i.w >= 0 && i.w < a.weapons.length && i.w !== a.wi) a.switchTo(i.w);
        if (i.o & 1) a.reload();
        if (i.o & 2) a.useMed();
        if (i.o & 4) a.useAbility(game);
        if (i.o & 8) a.useSpecial(game);
        i.o = 0;
        if (i.f) a.tryShoot(game);
      } };
    g.brains.push(hb);
    this.humans.set(c, { actor: a, hb, out: false }); c.priv = []; c.lastInput = Date.now();
    c.send({ t: 'init', mode: this.mode, you: a.id, seed: this.seed, map: g.map.id, time: +g.time.toFixed(2), timeLeft: +g.timeLeft.toFixed(2), actors: this.roster(g.actors),
      loot: g.world.loot.filter((l) => this.lootInit.get(l.nid) !== this.sig(l)).map((l) => this.lootRow(l)), snap: this.snapshot(c, true) });
    this.broadcast({ t: 'roster', actors: this.roster([a]) }, c);
    log('room', this.id, 'join', c.name, '(' + this.humans.size + ' players)');
  }
  // A party member's fighter: beside a party mate if their squad has a free place, otherwise in a squad with room for the party.
  partyBot(c, bots) {
    const mates = [], members = Array.from(c.party.members);
    for (const m of members) { const h = this.humans.get(m); if (h) mates.push(h.actor.team); }
    for (const t of mates) { const b = bots.find((x) => x.bot.team === t); if (b) return b; }
    const free = new Map(); for (const b of bots) free.set(b.bot.team, (free.get(b.bot.team) || 0) + 1);
    const need = Math.min(this.sb.MODES[this.mode].teamSize || 1, members.filter((m) => m.room === this && !this.humans.has(m)).length);
    return bots.find((b) => free.get(b.bot.team) >= need);
  }
  tellWaiting() { for (const c of this.waiting) c.send({ t: 'wait', lobby: 1, s: Math.max(1, this.lobbyT), n: this.waiting.size }); }
  // They left: the fighter is a bot again.
  detach(c) {
    this.waiting.delete(c); this.clients.delete(c);
    const h = this.humans.get(c); if (!h) return;
    this.humans.delete(c);
    const g = this.game, a = h.actor, i = g.brains.indexOf(h.hb);
    if (i >= 0) g.brains.splice(i, 1);
    a.human = false; a.skin = null; a.skinId = ''; this.sb.Chars.clear(a);
    const br = new this.sb.BotBrain(a); g.toughenBot(a, br); br.likesCars = false; g.brains.push(br);
    this.broadcast({ t: 'roster', actors: this.roster([a]) });
    log('room', this.id, 'leave', c.name, '(' + this.humans.size + ' players)');
  }
  input(c, m) {
    const h = this.humans.get(c); if (!h) return;
    const i = h.hb.inp, num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
    i.x = num(m.x, -1, 1); i.y = num(m.y, -1, 1); i.a = num(m.a, -4000, 4000) / 1000; i.f = m.f ? 1 : 0; i.o |= num(m.o, 0, 15) | 0; i.w = num(m.w, -1, 2) | 0;
    h.hb.ack = num(m.q, 0, 1e9) | 0; c.lastInput = Date.now();
  }
  broadcast(m, except) { const s = JSON.stringify(m); for (const c of this.humans.keys()) if (c !== except) c.sendRaw(s); }

  row(x) { return [x.id, Math.round(x.x), Math.round(x.y), Math.round(x.angle * 100), Math.max(0, Math.ceil(x.hp)), Math.ceil(x.shield), x.alive ? 1 : 0, x.weapon ? x.weapon.key : '', x.kills, x.deaths,
    (x.healing > 0 ? 1 : 0) | (x.invuln > 0 ? 2 : 0) | (x.weapon && x.weapon.reloading ? 4 : 0) | (x.hideT > 0 ? 8 : 0) | (x.guardT > 0 ? 16 : 0) | (x.blastT > 0 ? 32 : 0) | (x.frenzyT > 0 ? 64 : 0), x.gunLevel || 0]; }
  snapshot(c, full) {
    const g = this.game, h = this.humans.get(c), p = h && h.actor;
    const near = this.big && !full && p && p.alive; // the dead watch someone else, so they get everyone
    const list = near ? g.actors.filter((x) => x === p || x.team === p.team || (Math.abs(x.x - p.x) < NEAR && Math.abs(x.y - p.y) < NEAR)) : g.actors;
    const m = { t: 's', tm: +g.time.toFixed(2), tl: +g.timeLeft.toFixed(2), a: list.map((x) => this.row(x)) };
    const z = g.world.zone;
    if (!z.fixed) m.z = [Math.round(z.cx), Math.round(z.cy), Math.round(z.r), Math.round(z.tx), Math.round(z.ty), Math.round(z.tr), z.phase, z.state, +z.timer.toFixed(1), z.done ? 1 : 0];
    if (p) m.me = { ack: h.hb.ack, wi: p.wi, meds: p.meds, mh: p.maxHp, ab: +(p.abCd || 0).toFixed(1), sp: +(p.spCharge || 0).toFixed(2), w: p.weapons.map((w) => [w.key, w.ammo, w.infinite ? 999 : w.reserve, w.reloading ? 1 : 0, +(w.reloadT || 0).toFixed(2), w.reloadTotal || w.reload]) };
    return m;
  }

  step(dt) {
    const g = this.game;
    if (!this.clients.size) { this.emptyFor += dt; return; }
    this.emptyFor = 0;
    if (this.phase === 'lobby') {
      if (!this.waiting.size) return;
      this.lobbyT -= dt; this.told += dt;
      if (this.lobbyT <= 0 || this.waiting.size >= this.max) this.startMatch();
      else if (this.told >= 1) { this.told = 0; this.tellWaiting(); }
      return;
    }
    if (this.phase === 'done') { this.emptyFor += dt; return; }
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
    const now = Date.now(), full = (this.steps / SNAP_EVERY) % FULL_EVERY === 0, teams = this.royale ? g.aliveTeams() : null;
    for (const [c, h] of Array.from(this.humans)) {
      if (now - c.lastInput > IDLE_KICK * 1000) { c.send({ t: 'err', msg: 'You were away too long.' }); c.close(); continue; }
      const m = this.snapshot(c, full), p = h.actor;
      let e = ev;
      if (this.big && p.alive) e = ev.filter((x) => (x[0] === 'b' ? Math.abs(x[2] - p.x) < NEAR + 300 && Math.abs(x[3] - p.y) < NEAR + 300 : x[0] === 's' ? Math.abs(x[3] - p.x) < NEAR + 300 && Math.abs(x[4] - p.y) < NEAR + 300 : true));
      m.e = c.priv.length ? e.concat(c.priv) : e; c.priv = [];
      c.send(m);
      if (teams && !h.out && !teams.has(p.team) && teams.size > 0) { h.out = true; c.send({ t: 'out', place: teams.size + 1 }); } // their squad is gone: here is where they finished
    }
    ev.length = 0;
  }
  finish() {
    const g = this.game;
    this.overSent = true; this.sendSnapshots();
    if (this.royale) {
      const win = Array.from(g.aliveTeams())[0];
      for (const c of this.humans.keys()) c.send({ t: 'over', win: win === undefined ? -1 : win });
      this.phase = 'done'; // the next battle royale gets a fresh room and lobby
    } else {
      const rank = (g.scoreboard || g.arenaRanking()).map((a) => a.id);
      for (const c of this.humans.keys()) c.send({ t: 'over', rank });
      this.intermission = INTERMISSION; // everyone is asked to press PLAY AGAIN; fighters go back to the bots until they do
    }
    this.humans.clear();
    log('room', this.id, this.mode, 'match over');
  }
}

// ---------------------------------------------------------------- connections
function roomFor(mode, n) {
  for (const r of rooms) if (r.mode === mode && r.joinable && r.size + (n || 1) <= r.max) return r;
  const r = new Room(mode); rooms.add(r); log('room', r.id, mode, 'opened'); return r;
}

// ---------------------------------------------------------------- usernames
// A username is a made-up callsign (two words from the game's lists and a number: nobody types a name). Each one
// belongs to one friend code. They are kept in a small file so they survive a restart and can be found while offline.
const DATA_DIR = process.env.TDR_DATA || path.join(__dirname, 'data'), NAMES_FILE = path.join(DATA_DIR, 'names.json');
const CALLSIGNS = (() => { try { return vm.runInNewContext(/const NET_CALLSIGNS = (\[\[[\s\S]*?\]\]);/.exec(fs.readFileSync(path.join(ROOT, 'js', 'online.js'), 'utf8'))[1]); } catch (e) { return [['Swift'], ['Otter']]; } })();
const names = new Map(), nameOf = new Map(); // lower-case username -> { code, name }; friend code -> username
try { for (const [code, name] of Object.entries(JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8')))) { names.set(String(name).toLowerCase(), { code, name }); nameOf.set(code, name); } } catch (e) { /* first run */ }
let saveT = null;
const saveNames = () => { if (saveT) return; saveT = setTimeout(() => { saveT = null; try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(NAMES_FILE + '.tmp', JSON.stringify(Object.fromEntries(nameOf))); fs.renameSync(NAMES_FILE + '.tmp', NAMES_FILE); } catch (e) { log('usernames not saved:', e.message); } }, 1000); };
const validName = (s) => { const m = /^([A-Z][a-z]+)([A-Z][a-z]+)(\d{2,4})$/.exec(String(s || '')); return !!m && CALLSIGNS[0].includes(m[1]) && CALLSIGNS[1].includes(m[2]); };
const pickOf = (l) => l[Math.floor(Math.random() * l.length)];
const randomName = (digits) => pickOf(CALLSIGNS[0]) + pickOf(CALLSIGNS[1]) + (digits > 2 ? 100 + Math.floor(Math.random() * 9900) : 10 + Math.floor(Math.random() * 90));
// The username for a friend code: the one asked for if it is a real callsign and free, otherwise the nearest free one.
function claimName(code, want) {
  const have = nameOf.get(code);
  if (have && (have === want || !validName(want))) return have;
  let name = validName(want) ? want : randomName(2);
  for (let i = 0; i < 400; i++) {
    const o = names.get(name.toLowerCase()); if (!o || o.code === code) break;
    name = validName(want) && i < 40 ? want.replace(/\d+$/, '') + (i < 15 ? 10 + Math.floor(Math.random() * 90) : 100 + Math.floor(Math.random() * 9900)) : randomName(i < 100 ? 2 : 4);
  }
  const o = names.get(name.toLowerCase()); if (o && o.code !== code) return have || name; // every try was taken (cannot really happen)
  if (have && have !== name) names.delete(have.toLowerCase());
  names.set(name.toLowerCase(), { code, name }); nameOf.set(code, name); saveNames();
  return name;
}

// ---------------------------------------------------------------- friends and parties
const online = new Map();        // friend code -> connection
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', MAX_FRIENDS = 50, PARTY_MAX = 4;
const codeOf = (pid) => { const h = crypto.createHash('sha256').update('tdr-friend:' + pid).digest(); let s = ''; for (let i = 0; i < 8; i++) s += CODE_ABC[h[i] & 31]; return s; };
const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const inMatch = (c) => !!(c.room && (c.room.humans.has(c) || c.room.waiting.has(c)));
// Still fighting: alive in a match that is under way (a party leader's next match goes ahead without them).
const fighting = (c) => { const h = c.room && c.room.humans.get(c); return !!(h && !h.out && (h.actor.alive || !c.room.royale)); };
// What a player may know about their friends: only those who are connected and have added them back.
function presence(c) {
  if (!c.code) return;
  const l = [];
  for (const code of c.friends) { const f = online.get(code); if (f && f.friends.has(c.code)) l.push([code, f.name, inMatch(f) ? 1 : 0, c.party && f.party === c.party ? 1 : 0]); }
  c.send({ t: 'fr', l });
}
function touch(c) { presence(c); for (const code of c.friends) { const f = online.get(code); if (f && f.friends.has(c.code)) presence(f); } }
function setFriends(c, list) {
  const next = new Set(), before = c.friends;
  if (Array.isArray(list)) for (const x of list.slice(0, MAX_FRIENDS)) { const k = cleanCode(x); if (k.length === 8 && k !== c.code) next.add(k); }
  c.friends = next;
  for (const k of next) if (!before.has(k)) { const f = online.get(k); if (f && !f.friends.has(c.code)) f.send({ t: 'req', code: c.code, name: c.name }); } // "X added you"
  for (const k of before) if (!next.has(k)) { const f = online.get(k); if (f) presence(f); if (f && c.party && f.party === c.party) leaveParty(c); }      // removed: no longer visible to each other
  touch(c);
}
function partyTell(p) {
  const m = Array.from(p.members).map((x) => [x.code, x.name]);
  for (const x of p.members) { x.send({ t: 'party', leader: p.leader.code, m }); presence(x); }
}
function leaveParty(c) {
  const p = c.party; if (!p) return;
  p.members.delete(c); c.party = null; c.send({ t: 'party', leader: '', m: [] }); presence(c);
  if (p.members.size <= 1) { for (const x of p.members) { x.party = null; x.send({ t: 'party', leader: '', m: [] }); presence(x); } p.members.clear(); p.invited.clear(); return; }
  if (p.leader === c) p.leader = p.members.values().next().value;
  partyTell(p);
}
// The leader's DROP IN: everyone in the party who is free goes to the same room.
function joinTogether(p, mode) {
  const leader = p.leader, list = Array.from(p.members).filter((m) => m === leader || !fighting(m));
  const stay = Array.from(p.members).filter((m) => !list.includes(m)).map((m) => m.name);
  if (stay.length) leader.send({ t: 'note', msg: stay.join(', ') + (stay.length > 1 ? ' are' : ' is') + ' still in a match and will sit this one out.' });
  let r = leader.room;
  if (!(r && rooms.has(r) && !r.royale && r.mode === mode && r.phase !== 'closed' && !r.humans.has(leader) && r.size + list.filter((m) => m.room !== r).length <= r.max)) r = roomFor(mode, list.length);
  for (const m of list) {
    if (m !== leader) m.send({ t: 'go', mode, by: leader.name });
    if (m.room !== r) { if (m.room) m.room.detach(m); m.room = r; }
    r.clients.add(m);
  }
  for (const m of list) if (!r.humans.has(m)) r.attach(m);
}
function friendMessage(c, m) {
  if (m.t === 'hello') {
    if (c.code || m.v !== PROTOCOL) { if (!c.code) c.send({ t: 'me', code: '', old: 1 }); return; }
    const pid = String(m.pid || ''); if (!/^[A-Za-z0-9]{16,64}$/.test(pid)) return;
    c.skin = clean(m.skin, 24);
    c.code = codeOf(pid); c.name = nameOf.get(c.code) || claimName(c.code, clean(m.name, 16)); // the name already held wins over whatever this copy of the game remembers
    const old = online.get(c.code); // the same game open twice: the newest connection is the one friends see
    if (old && old !== c) { leaveParty(old); old.code = ''; old.friends = new Set(); old.send({ t: 'me', code: '' }); }
    online.set(c.code, c); c.send({ t: 'me', code: c.code, name: c.name });
    setFriends(c, m.friends);
    for (const x of online.values()) if (x !== c && x.friends.has(c.code) && !c.friends.has(x.code)) c.send({ t: 'req', code: x.code, name: x.name });
    return;
  }
  if (!c.code) return;
  if (m.t === 'friends') setFriends(c, m.list);
  else if (m.t === 'invite') {
    const f = online.get(cleanCode(m.to)), now = Date.now();
    if (now - (c.invAt || 0) < 400) return; c.invAt = now;
    if (!f || f === c || !f.friends.has(c.code) || !c.friends.has(f.code)) { c.send({ t: 'note', msg: 'They are not online right now.' }); return; }
    if (c.party && f.party === c.party) return;
    if (c.party && c.party.members.size >= PARTY_MAX) { c.send({ t: 'note', msg: 'Your party is full.' }); return; }
    if (!c.party) c.party = { leader: c, members: new Set([c]), invited: new Set() };
    c.party.invited.add(f.code);
    f.send({ t: 'inv', code: c.code, name: c.name }); c.send({ t: 'note', msg: 'Invite sent to ' + f.name + '.' });
  } else if (m.t === 'accept') {
    const f = online.get(cleanCode(m.from)), p = f && f.party;
    if (!p || !p.invited.has(c.code)) { c.send({ t: 'note', msg: 'That invite has expired.' }); return; }
    if (p.members.size >= PARTY_MAX) { c.send({ t: 'note', msg: 'That party is full.' }); return; }
    if (c.party === p) return;
    leaveParty(c); p.invited.delete(c.code); p.members.add(c); c.party = p; partyTell(p);
  } else if (m.t === 'pleave') leaveParty(c);
  else if (m.t === 'find') { // look a player up by username (they need not be online)
    const now = Date.now(); if (now - (c.findAt || 0) < 700) return; c.findAt = now;
    const q = clean(m.name, 20).replace(/ /g, ''), hit = names.get(q.toLowerCase());
    c.send({ t: 'found', q, code: hit && hit.code !== c.code ? hit.code : '', name: hit ? hit.name : '', self: hit && hit.code === c.code ? 1 : 0 });
  } else if (m.t === 'rename') { // swap this player's username for another made-up one
    const now = Date.now(); if (now - (c.renAt || 0) < 2000) { c.send({ t: 'note', msg: 'Give it a moment before changing your name again.' }); return; } c.renAt = now;
    if (!validName(clean(m.name, 16))) return;
    c.name = claimName(c.code, clean(m.name, 16)); c.send({ t: 'me', code: c.code, name: c.name });
    touch(c); if (c.party) partyTell(c.party);
  }
}
setInterval(() => { for (const c of online.values()) { const s = inMatch(c); if (s !== c.busy) { c.busy = s; touch(c); } } }, 2000); // friends see "in a match" a moment after it changes

// The server also hands out the game itself, so one address is enough to play on a home network or a single host:
// open http://<this machine>:PORT/ and the page connects back to the server it came from. /status is a health check.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/status') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Top-Down Royale game server: ' + rooms.size + ' rooms, ' + Array.from(rooms).reduce((n, r) => n + r.humans.size, 0) + ' players\n'); return; }
  const rel = url === '/' ? 'index.html' : url.slice(1);
  if (!/^(index\.html|privacy\.html|style\.css|manifest\.webmanifest|js\/\w+\.js|icons\/[\w-]+\.png)$/.test(rel)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    if (rel === 'index.html') data = String(data).replace('<!--push-->', PUSH); // Options shows which GitHub push is being served
    if (rel === 'js/online.js') data = String(data).replace("const ONLINE_URL = '';", "const ONLINE_URL = 'same';");
    res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  const c = { ws, name: 'Player', skin: '', char: '', room: null, priv: [], lastInput: Date.now(), code: '', friends: new Set(), party: null, busy: false,
    sendRaw(s) { if (ws.readyState === 1 && ws.bufferedAmount < 262144) ws.send(s); }, send(m) { this.sendRaw(JSON.stringify(m)); }, close() { try { ws.close(); } catch (e) { /* gone */ } } };
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    try {
      if (m.t === 'i') { if (c.room) c.room.input(c, m); }
      else if (m.t === 'join') {
        if (m.v !== PROTOCOL) { c.send({ t: 'err', msg: 'Update the game to play online.' }); return; }
        const mode = NET_MODES.includes(m.mode) ? m.mode : 'deathmatch';
        if (!c.code) c.name = clean(m.name, 14) || 'Player'; // a player with a username keeps it
        c.skin = clean(m.skin, 24); c.char = clean(m.char, 12);
        const p = c.party;
        if (p && p.members.size > 1) { if (p.leader === c) joinTogether(p, mode); else c.send({ t: 'err', msg: 'Only the party leader can start a match.' }); return; }
        const r = c.room;
        // same arena room between matches: wait there for the next one. Anything else: leave it and find a room for this mode.
        if (r && rooms.has(r) && !r.royale && r.mode === mode && r.clients.has(c) && !r.humans.has(c)) { r.attach(c); return; }
        if (r) r.detach(c);
        c.room = roomFor(mode); c.room.clients.add(c); c.room.attach(c);
      } else if (m.t === 'leave') { if (c.room) { c.room.detach(c); c.room = null; } } // back to the menu; the connection stays for friends
      else friendMessage(c, m);
    } catch (e) { log('error', e && e.stack || e); }
  });
  ws.on('close', () => {
    if (c.room) c.room.detach(c);
    c.room = null; leaveParty(c);
    if (c.code && online.get(c.code) === c) { online.delete(c.code); const fr = c.friends; c.friends = new Set(); for (const k of fr) { const f = online.get(k); if (f) presence(f); } }
  });
  ws.alive = true; ws.on('pong', () => { ws.alive = true; });
  ws.on('error', () => {});
});

// connections sit idle in the menu: ping them so proxies keep them open, and drop the ones that have gone
setInterval(() => { for (const ws of wss.clients) { if (ws.alive === false) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) { /* closing */ } } }, 25000);

let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const r of Array.from(rooms)) {
    try { r.step(dt); } catch (e) { log('room', r.id, 'crashed:', e && e.stack || e); for (const c of r.clients) { c.send({ t: 'err', msg: 'The match hit a problem. Please try again.' }); c.close(); } rooms.delete(r); continue; }
    if (r.emptyFor > 30) { r.phase = 'closed'; rooms.delete(r); log('room', r.id, 'closed'); }
  }
}, 1000 / 120);
server.listen(PORT, () => {
  log('listening on', PORT, 'protocol', PROTOCOL);
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) log('play on this network at  http://' + n.address + ':' + PORT + '/');
});
