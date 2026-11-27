'use strict';
// Online play. This file is loaded by the browser and by the game server (server/server.js runs the same game code),
// so the two always agree on the protocol and on how a map is built from a seed.
//
// The server is in charge of everything that matters (positions, bullets, damage, loot, the zone, score). A client
// sends its controls about 30 times a second and draws what the server reports 20 times a second: other fighters are
// smoothed between reports, your own movement is predicted locally and corrected.
//
// Online modes: Solo, Duos, Squads, Mega (a lobby fills for a few seconds, then the match runs to the last squad) and
// Deathmatch, Gun Game (join a running match at any time). Bots fill every slot a person has not taken.
const NET_PROTOCOL = 2;
const ONLINE_URL = ''; // the game server's wss:// address, once it is hosted. Empty = every mode is played on the device.
                       // ('same' = the server this page came from: the game server sets that when it serves the game itself.)

function seededRandom(seed) {
  let s = seed >>> 0;
  return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// A World built from a seed: the server and every client generate the identical map and loot from it.
function seededWorld(seed, map, opts) {
  const r = Math.random; Math.random = seededRandom(seed);
  try {
    const w = new World(map, opts);
    let id = 1; for (const l of w.loot) l.nid = id++;
    w.nextLootId = id;
    return w;
  } finally { Math.random = r; }
}
const NET_CALLSIGNS = [['Swift', 'Lucky', 'Quiet', 'Rusty', 'Bold', 'Sly', 'Grim', 'Jolly', 'Iron', 'Wild', 'Brave', 'Lone'], ['Otter', 'Badger', 'Heron', 'Lynx', 'Moth', 'Raven', 'Viper', 'Bison', 'Gecko', 'Marlin', 'Stoat', 'Wren']];

const Net = {
  ws: null, game: null, mode: '', wantJoin: false,
  url() {
    try { const q = new URLSearchParams(location.search).get('server'); if (q) return q; const s = localStorage.getItem('tdr_server'); if (s) return s; } catch (e) { /* no storage */ }
    if (ONLINE_URL === 'same') return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    return ONLINE_URL;
  },
  // No free-text names online: a callsign is made up once and kept.
  callsign() {
    const p = Progress.data.prefs;
    if (!p.callsign) { p.callsign = U.pick(NET_CALLSIGNS[0]) + U.pick(NET_CALLSIGNS[1]) + (10 + Math.floor(Math.random() * 90)); Progress.save(); }
    return p.callsign;
  },
  // The message box: text, and whether to offer the same mode against bots on this device.
  panel(text, offline) {
    const el = document.getElementById('net-panel'); if (!el) return;
    document.getElementById('net-text').textContent = text || '';
    document.getElementById('net-offline').classList.toggle('hidden', !offline);
    el.classList.toggle('hidden', !text);
  },
  // DROP IN on an online mode.
  play(game, mode) {
    this.game = game; this.mode = mode; this.wantJoin = true;
    if (this.ws && this.ws.readyState === 1) { this.join(); return; }
    this.panel('Connecting...');
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e) { this.panel('Could not reach the game server.', true); return; }
    this.ws = ws;
    const failed = () => { if (this.ws === ws) this.ws = null; if (this.wantJoin && !game.net) this.panel('Could not reach the game server.', true); };
    ws.onopen = () => { if (this.ws === ws && this.wantJoin) this.join(); };
    ws.onmessage = (e) => { if (this.ws !== ws) return; let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.onMessage(m); };
    ws.onerror = failed;
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (game.net && game.state !== 'over' && game.state !== 'menu') { this.ws = null; game.net = null; this.wantJoin = false; game.toMenu(); this.panel('The connection to the match was lost.', true); }
      else failed();
    };
  },
  join() {
    this.panel('Finding a match...');
    this.send({ t: 'join', v: NET_PROTOCOL, mode: this.mode, name: this.callsign(), skin: Progress.data.equipped.skin || '' });
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  // Leave online play (MENU, QUIT or CLOSE).
  leave() {
    this.wantJoin = false;
    const ws = this.ws; this.ws = null;
    if (ws) { try { ws.close(); } catch (e) { /* already closed */ } }
    this.panel('');
  },
  onMessage(m) {
    const g = this.game; if (!g) return;
    if (m.t === 'init') { if (!this.wantJoin) return; this.panel(''); g.startOnline(m); }
    else if (m.t === 'wait') { if (this.wantJoin) this.panel((m.lobby ? 'Match starts in ' : 'Next match starts in ') + Math.max(1, Math.ceil(m.s)) + 's' + (m.n > 1 ? ' · ' + m.n + ' players waiting' : '')); }
    else if (m.t === 'err') { this.wantJoin = false; this.panel(m.msg || 'The server refused the connection.', true); }
    else if (!g.net) return;
    else if (m.t === 's') g.netSnapshot(m);
    else if (m.t === 'roster') g.netRoster(m.actors);
    else if (m.t === 'out') g.netOut(m);
    else if (m.t === 'over') g.netOver(m);
  },
};

if (typeof Game !== 'undefined') {
  // ------------------------------------------------------------------ joining a match
  Game.prototype.startOnline = function (init) {
    const prefs = Progress.data.prefs, keep = { mode: prefs.mode, map: prefs.map, mutator: prefs.mutator }, done = Progress.data.tutorialDone;
    prefs.mode = init.mode; prefs.map = init.map; prefs.mutator = 'none'; Progress.data.tutorialDone = true;
    this.netSeed = init.seed; this.net = null;
    try { this.start(); } finally { prefs.mode = keep.mode; prefs.map = keep.map; prefs.mutator = keep.mutator; Progress.data.tutorialDone = done; this.netSeed = 0; }
    const n = this.net = { you: init.you, actors: new Map(), loot: new Map(), inputs: [], seq: 0, sentAt: 0, weapons: {}, lastSnap: performance.now(), done: false };
    for (const l of this.world.loot) n.loot.set(l.nid, l);
    for (const row of init.loot || []) this.netLoot(row);
    this.brains = []; this.vehicles = []; this.nearCar = null; this.bullets = []; this.particles = []; this.killfeed = []; this.notices = []; this.actors = [];
    this.netRoster(init.actors);
    this.player = n.actors.get(init.you); this.player.isPlayer = true;
    this.time = init.time; this.timeLeft = init.timeLeft; this.warmup = false; this.Lnom = this.L = 0.45;
    this.renderer.zoom = 1; this.renderer.camX = this.player.x; this.renderer.camY = this.player.y;
    this.ui.diffLine.textContent = 'Online'; this.ui.powers.innerHTML = '';
    this.ui.banner.classList.add('hidden');
    this.netSnapshot(init.snap);
  };
  // Who is in the match. Sent on joining and whenever someone takes over (or hands back) a fighter.
  Game.prototype.netRoster = function (rows) {
    const n = this.net;
    for (const r of rows) {
      let a = n.actors.get(r.id);
      if (!a) {
        a = new Actor(r.x || 0, r.y || 0, r.name, r.color, false);
        a.id = r.id; a.weapons = []; a.takeDamage = () => 0; // nothing is decided on the phone
        n.actors.set(r.id, a); this.actors.push(a);
      }
      const it = r.skin ? Progress.item(r.skin) : null;
      a.name = r.name; a.team = r.team; a.human = !!r.human; a.skin = it && it.type === 'skin' ? it.value : null; a.color = a.skin ? a.skin.color : r.color;
    }
  };
  // One loot item's state: [id, alive, kind, weapon key, x, y, ammo, reserve]. Unknown ids are drops made during the match.
  Game.prototype.netLoot = function (row) {
    const n = this.net, [id, alive, kind, wkey, x, y, ammo, reserve] = row;
    let l = n.loot.get(id);
    if (!l) { if (x === undefined) return; l = this.world.addLoot(new Loot(x, y, kind, null)); l.nid = id; l.dropped = true; n.loot.set(id, l); }
    l.alive = !!alive; l.kind = kind;
    if (kind === 'weapon' && wkey && (!l.weapon || l.weapon.key !== wkey)) l.weapon = makeWeapon(wkey);
    if (l.weapon && ammo !== undefined) { l.weapon.ammo = ammo; l.weapon.reserve = reserve; }
  };

  // ------------------------------------------------------------------ what the server reports, 20 times a second
  // In a big match only the fighters near you are in every report; everyone is in one report a second.
  Game.prototype.netSnapshot = function (m) {
    const n = this.net, now = performance.now(), p = this.player;
    if (!n || !m) return;
    n.lastSnap = now; this.time = m.tm; this.timeLeft = m.tl;
    if (m.z) { const z = this.world.zone, v = m.z; z.cx = v[0]; z.cy = v[1]; z.r = v[2]; z.tx = v[3]; z.ty = v[4]; z.tr = v[5]; z.phase = v[6]; z.state = v[7]; z.timer = v[8]; z.done = !!v[9]; }
    for (const row of m.a) {
      const [id, x, y, ang, hp, sh, alive, wkey, kills, deaths, flags, gun] = row, a = n.actors.get(id);
      if (!a) continue;
      const wasAlive = a.alive, angle = ang / 100;
      a.hp = hp; a.shield = sh; a.kills = kills; a.deaths = deaths; a.alive = !!alive; a.gunLevel = gun || 0;
      a.healing = flags & 1 ? Math.max(a.healing, 0.2) : 0; a.invuln = flags & 2 ? 0.2 : 0;
      if (a !== p) {
        if (!a.weapons[0] || a.weapons[0].key !== wkey) { a.weapons = wkey ? [makeWeapon(wkey)] : []; a.wi = 0; }
        if (a.weapons[0]) a.weapons[0].reloading = !!(flags & 4);
        const b = a.nb;
        if (!b || (!wasAlive && a.alive) || Math.hypot(x - b.x1, y - b.y1) > 400) { a.nb = { x0: x, y0: y, a0: angle, t0: now - 50, x1: x, y1: y, a1: angle, t1: now }; a.x = x; a.y = y; a.angle = angle; }
        else { b.x0 = a.x; b.y0 = a.y; b.a0 = a.angle; b.t0 = now; b.x1 = x; b.y1 = y; b.a1 = angle; b.t1 = now + 50; }
      } else {
        if (!a.alive || !wasAlive) { a.x = x; a.y = y; n.inputs.length = 0; }
        else this.netReconcile(x, y, m.me ? m.me.ack : 0);
        if (wasAlive && !a.alive && this.state === 'playing') { // down: back in three seconds, or watching your squad
          const squad = !this.mode.respawn && this.mode.teamSize > 1;
          this.ui.banner.textContent = (squad ? 'DOWN' : 'ELIMINATED') + (n.killedBy ? (squad ? ' - ' : ' by ') + n.killedBy : '') + (squad ? ' - your squad fights on' : '');
          this.ui.banner.classList.remove('win'); this.ui.banner.classList.remove('hidden');
        }
        if (!wasAlive && a.alive && this.state === 'playing') this.ui.banner.classList.add('hidden');
      }
    }
    if (m.me) { // your own inventory, for the HUD
      const me = m.me;
      me.w.forEach((r, i) => {
        let w = p.weapons[i];
        if (!w || w.key !== r[0]) w = p.weapons[i] = makeWeapon(r[0]);
        w.ammo = r[1]; w.reserve = r[2]; w.reloading = !!r[3]; w.reloadT = r[4]; w.reloadTotal = r[5]; w.infinite = r[2] >= 999;
      });
      p.weapons.length = me.w.length; p.wi = Math.min(me.wi, Math.max(0, me.w.length - 1)); p.meds = me.meds;
    }
    for (const e of m.e || []) this.netEvent(e);
  };
  // Your own position: start from where the server has you, re-apply the moves it has not seen yet, and ease toward that.
  Game.prototype.netReconcile = function (sx, sy, ack) {
    const n = this.net, p = this.player, s = { x: sx, y: sy, r: p.r };
    while (n.inputs.length && n.inputs[0].q <= ack) n.inputs.shift();
    for (const i of n.inputs) { s.x += i.x * i.v * i.dt; s.y += i.y * i.v * i.dt; this.world.resolveCircle(s); }
    const ex = s.x - p.x, ey = s.y - p.y, d = Math.hypot(ex, ey);
    if (d > 140) { p.x = s.x; p.y = s.y; } else if (d > 0.5) { p.x += ex * 0.2; p.y += ey * 0.2; }
  };
  Game.prototype.netEvent = function (e) {
    const n = this.net, A = (id) => n.actors.get(id), W = (k) => n.weapons[k] || (n.weapons[k] = makeWeapon(k));
    switch (e[0]) {
      case 'b': { const o = A(e[1]); if (o) this.bullets.push(new Bullet(o, e[2], e[3], e[4] / 1000, W(e[5]))); break; }   // a bullet was fired
      case 's': { const o = A(e[1]); if (o) this.onShot(o, W(e[2]), e[3], e[4]); break; }                                // muzzle flash and sound, once per trigger pull
      case 'k': {                                                                                                          // someone died
        const v = A(e[1]), k = A(e[2]); if (!v) break;
        if (!this.mode.respawn) v.alive = false;
        if (v === this.player) { n.killedBy = k ? k.name : ''; v.lastAttacker = k || null; }
        for (let i = 0; i < 18; i++) this.particles.push(new Particle(v.x, v.y, U.rand(-220, 220), U.rand(-220, 220), U.rand(0.3, 0.8), i % 3 === 0 ? v.color : '#b71c1c', U.rand(2, 5)));
        const who = k ? (k === this.player ? 'You' : k.name) : 'The zone', whom = v === this.player ? 'You' : v.name;
        this.killfeed.unshift({ text: e[4] ? whom + ' blew ' + (v === this.player ? 'yourself' : 'themselves') + ' up' : who + ' eliminated ' + whom, time: this.time, hl: v === this.player || k === this.player || (this.mode.teamSize > 1 && v.team === this.player.team) });
        if (this.killfeed.length > 6) this.killfeed.length = 6;
        if (k === this.player) { Sound.kill(); const wk = e[3] || 'pistol'; this.ms.weaponKills[wk] = (this.ms.weaponKills[wk] || 0) + 1; }
        break;
      }
      case 'l': this.netLoot(e.slice(1)); break;                                                                          // loot picked up, respawned or dropped
      case 'n': this.notify(this.player, e[1]); if (/^(Picked|Swapped|\+|Medkit)/.test(e[1])) { Sound.pickup(); this.ms.pickups++; } break;
    }
  };

  // ------------------------------------------------------------------ every frame
  Game.prototype.netUpdate = function (dt) {
    const n = this.net, p = this.player, now = performance.now();
    for (const a of this.actors) { a.vx = 0; a.vy = 0; if (a.flash > 0) a.flash -= dt; if (a.healing > 0) a.healing -= dt; }
    if (this.state === 'playing') this.netControl(dt); else this.netIdle(now);
    for (const a of this.actors) { // everyone else: glide from the last reported position to the newest one
      const b = a.nb; if (!b || a === p) continue;
      const k = U.clamp((now - b.t0) / Math.max(1, b.t1 - b.t0), 0, 1.4);
      a.x = b.x0 + (b.x1 - b.x0) * k; a.y = b.y0 + (b.y1 - b.y0) * k; a.angle = U.lerpAngle(b.a0, b.a1, Math.min(1, k));
      a.vx = (b.x1 - b.x0) * 20; a.vy = (b.y1 - b.y0) * 20;
    }
    for (const b of this.bullets) b.update(dt, this); // for show: they cannot hurt anyone here
    this.bullets = this.bullets.filter((b) => b.alive);
    for (const q of this.particles) q.update(dt);
    this.particles = this.particles.filter((q) => q.life > 0);
    this.time += dt; if (this.mode.duration) this.timeLeft = Math.max(0, this.timeLeft - dt);
    const z = this.world.zone; if (!z.fixed && !z.done && z.state === 'wait') z.timer = Math.max(0, z.timer - dt);
    this.notices = this.notices.filter((x) => this.time - x.time < 2.2);
    this.killfeed = this.killfeed.filter((x) => this.time - x.time < 8);
    if (this.state === 'over') { this.overTimer += dt; if (this.overTimer > 1.5 && !this.panelShown) this.showOverPanel(); }
    else if (now - n.lastSnap > 6000 && Net.ws) { try { Net.ws.close(); } catch (e) { /* closing anyway */ } } // the server has gone quiet
  };
  // Read the controls, move at once on this screen, and tell the server.
  Game.prototype.netControl = function (dt) {
    const n = this.net, p = this.player, inp = this.input, now = performance.now();
    let mx = 0, my = 0;
    if (inp.down('w') || inp.down('arrowup')) my -= 1;
    if (inp.down('s') || inp.down('arrowdown')) my += 1;
    if (inp.down('a') || inp.down('arrowleft')) mx -= 1;
    if (inp.down('d') || inp.down('arrowright')) mx += 1;
    if (inp.touch && Math.hypot(inp.stick.dx, inp.stick.dy) > 0.2) { mx += inp.stick.dx; my += inp.stick.dy; }
    const len = Math.hypot(mx, my), nx = len > 0 ? mx / len : 0, ny = len > 0 ? my / len : 0;
    if (p.alive && len > 0) { p.move(nx, ny, dt); this.world.resolveCircle(p); }
    if (p.alive) {
      if (inp.touch) this.touchAim(nx, ny); else this.aimAssist();
      const m = this.renderer.toWorld(inp.mouse.x, inp.mouse.y);
      p.angle = U.angle(p.x, p.y, m.x, m.y);
    }
    let want = -1, once = 0;
    for (let i = 1; i <= 3; i++) if (inp.justPressed(String(i))) { if (inp.touch && p.wi === i - 1) once |= 1; else want = i - 1; }
    if (inp.wheel && p.weapons.length > 1) want = (p.wi + Math.sign(inp.wheel) + p.weapons.length) % p.weapons.length;
    if (inp.justPressed('r')) once |= 1;
    if (inp.justPressed('f') || inp.justPressed('q')) { once |= 2; this.ms.medsUsed++; }
    if (want >= 0 && want < p.weapons.length) { p.wi = want; n.want = want; n.wantUntil = now + 600; }
    const fire = p.alive && (inp.mouse.down || inp.mouse.clicked) ? 1 : 0;
    const q = ++n.seq;
    n.inputs.push({ q, x: p.alive ? nx : 0, y: p.alive ? ny : 0, dt, v: p.speed * (p.healing > 0 ? 0.55 : 1) * p.slow });
    if (n.inputs.length > 90) n.inputs.shift();
    n.once = (n.once || 0) | once;
    if (now - n.sentAt >= 30 || once || fire !== n.fire) {
      n.sentAt = now; n.fire = fire;
      Net.send({ t: 'i', q, x: +nx.toFixed(3), y: +ny.toFixed(3), a: Math.round(p.angle * 1000), f: fire, o: n.once, w: now < (n.wantUntil || 0) ? n.want : -1 });
      n.once = 0;
    }
  };
  // Paused, or looking at the result: stand still.
  Game.prototype.netIdle = function (now) {
    const n = this.net;
    if (now - n.sentAt < 250) return;
    n.sentAt = now; n.inputs.length = 0;
    Net.send({ t: 'i', q: ++n.seq, x: 0, y: 0, a: Math.round(this.player.angle * 1000), f: 0, o: 0, w: -1 });
  };
  // Battle royale: your squad is out. The match goes on without you; this is your result.
  Game.prototype.netOut = function (m) {
    if (this.net.done || this.state === 'over') return;
    this.net.done = true;
    if (this.state === 'paused') this.resume();
    this.placement = m.place; this.endGame(false);
  };
  // The match is over: the server's final table (arena modes) or the winning squad (battle royale).
  Game.prototype.netOver = function (m) {
    const n = this.net;
    if (n.done || this.state === 'over') return;
    n.done = true;
    if (this.state === 'paused') this.resume();
    if (m.rank) { this.scoreboard = m.rank.map((id) => n.actors.get(id)).filter(Boolean); this.placement = this.scoreboard.indexOf(this.player) + 1; this.endGame(this.placement === 1); }
    else { const win = m.win === this.player.team; this.placement = win ? 1 : 2; this.endGame(win); }
  };
}
