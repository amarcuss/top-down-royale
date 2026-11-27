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
//
// Friends: the same connection stays open in the menus. Friends are found by username (each side adds the other), shown
// with whether they are online, and can be invited to a party; the party leader's DROP IN takes everyone to one match.
const NET_PROTOCOL = 5;
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
  // friends (see the FRIENDS sheet): my code, who is online, who added or invited me, and my party
  me: '', on: new Map(), requests: new Map(), invites: new Map(), party: null, note: '', retry: 0, timer: 0,
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
  // This game's secret id. The friend code other people type is worked out from it by the server, so nobody can claim yours.
  pid() {
    const p = Progress.data.prefs;
    if (!p.pid) {
      const b = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
      p.pid = Array.from(b, (x) => (x < 16 ? '0' : '') + x.toString(16)).join(''); Progress.save();
    }
    return p.pid;
  },
  friends() { const d = Progress.data; if (!Array.isArray(d.friends)) d.friends = []; return d.friends; },
  ignored() { const d = Progress.data; if (!Array.isArray(d.ignored)) d.ignored = []; return d.ignored; },
  // The message box: text, and whether to offer the same mode against bots on this device.
  panel(text, offline) {
    const el = document.getElementById('net-panel'); if (!el) return;
    document.getElementById('net-text').textContent = text || '';
    document.getElementById('net-offline').classList.toggle('hidden', !offline);
    el.classList.toggle('hidden', !text);
  },
  // One connection for as long as the game is open: it carries matches, and tells friends you are online.
  connect() {
    if (this.ws || !this.url()) return;
    clearTimeout(this.timer);
    let ws;
    try { ws = new WebSocket(this.url()); } catch (e) { this.down(); return; }
    this.ws = ws;
    setTimeout(() => { if (ws.readyState === 0) { try { ws.close(); } catch (e) { /* closing anyway */ } } }, 8000);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.send({ t: 'hello', v: NET_PROTOCOL, pid: this.pid(), name: this.callsign(), skin: Progress.data.equipped.skin || '', friends: this.friends().map((f) => f.code) });
      if (this.wantJoin) this.join();
      this.renderFriends();
    };
    ws.onmessage = (e) => { if (this.ws !== ws) return; let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.onMessage(m); };
    ws.onerror = () => { /* a close always follows */ };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.down(); } };
  },
  // The connection is gone (or never opened): say so if it mattered, forget who was online, and try again shortly.
  down() {
    const g = this.game;
    if (g && g.net && g.state !== 'over' && g.state !== 'menu') { g.net = null; this.wantJoin = false; g.toMenu(); this.panel('The connection to the match was lost.', true); }
    else if (this.wantJoin && !(g && g.net)) { this.wantJoin = false; this.panel('Could not reach the game server.', true); }
    this.on.clear(); this.invites.clear(); this.party = null;
    this.renderFriends();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), Math.min(30000, 3000 * Math.pow(2, this.retry++)));
  },
  // DROP IN on an online mode.
  play(game, mode) {
    this.game = game; this.mode = mode;
    if (this.party && this.party.leader !== this.me) { const l = this.party.m.find((x) => x[0] === this.party.leader); this.panel('You are in a party. ' + (l ? l[1] : 'The leader') + ' starts the match for everyone.'); return; }
    this.wantJoin = true;
    if (this.ws && this.ws.readyState === 1) { this.join(); return; }
    this.panel('Connecting...');
    this.connect();
  },
  join() {
    this.panel('Finding a match...');
    this.send({ t: 'join', v: NET_PROTOCOL, mode: this.mode, name: this.callsign(), skin: Progress.data.equipped.skin || '', char: Chars.current().id });
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  // Leave the match or the queue (MENU, QUIT or CLOSE). The connection stays, so friends still see you online.
  leave() {
    this.wantJoin = false;
    this.send({ t: 'leave' });
    this.panel('');
  },
  onMessage(m) {
    const g = this.game; if (!g) return;
    if (m.t === 'init') { if (!this.wantJoin) { this.send({ t: 'leave' }); return; } this.panel(''); g.startOnline(m); }
    else if (m.t === 'wait') { if (this.wantJoin) this.panel((m.lobby ? 'Match starts in ' : 'Next match starts in ') + Math.max(1, Math.ceil(m.s)) + 's' + (m.n > 1 ? ' · ' + m.n + ' players waiting' : '')); }
    else if (m.t === 'err') { this.wantJoin = false; this.panel(m.msg || 'The server refused the connection.', true); }
    else if (m.t === 'me' || m.t === 'found' || m.t === 'fr' || m.t === 'req' || m.t === 'inv' || m.t === 'party' || m.t === 'note' || m.t === 'go') this.onFriendMessage(m, g);
    else if (!g.net) return;
    else if (m.t === 's') g.netSnapshot(m);
    else if (m.t === 'roster') g.netRoster(m.actors);
    else if (m.t === 'out') g.netOut(m);
    else if (m.t === 'over') g.netOver(m);
  },

  // ------------------------------------------------------------------ friends
  onFriendMessage(m, g) {
    const tidy = (s) => String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 16), tidy16 = tidy;
    if (m.t === 'me') { // my friend code, and the username the server holds for it (it may differ from the one asked for, if that was taken)
      this.me = m.code || ''; if (m.old) this.note = 'Update the game to use friends.';
      if (m.name && m.name !== Progress.data.prefs.callsign) { Progress.data.prefs.callsign = tidy16(m.name); Progress.save(); if (g.state === 'menu') g.buildPickers(); }
    } else if (m.t === 'found') { // the answer to a username search
      if (m.self) this.note = 'That is your own name.';
      else if (m.code) { this.addFriend(m.code, tidy16(m.name)); return; }
      else if (/^[A-Z2-9]{8}$/.test(String(m.q || '').toUpperCase())) { this.addFriend(m.q); return; } // not a username: perhaps a friend code
      else this.note = 'Nobody is called ' + tidy16(m.q) + '. Names look like SwiftOtter42: check the spelling.';
    }
    else if (m.t === 'fr') { // friends who are online and have added me back: [code, name, in a match, in my party]
      this.on = new Map();
      let changed = false;
      for (const r of m.l || []) {
        this.on.set(r[0], { name: tidy(r[1]), busy: !!r[2], party: !!r[3] });
        const f = this.friends().find((x) => x.code === r[0]);
        if (f && (f.name !== tidy(r[1]) || !f.ok)) { f.name = tidy(r[1]); f.ok = 1; changed = true; }
        this.requests.delete(r[0]);
      }
      for (const code of Array.from(this.invites.keys())) if (!this.on.has(code)) this.invites.delete(code);
      if (changed) Progress.save();
    } else if (m.t === 'req') { if (!this.ignored().includes(m.code) && !this.friends().some((f) => f.code === m.code)) this.requests.set(m.code, tidy(m.name)); }
    else if (m.t === 'inv') {
      this.invites.set(m.code, tidy(m.name));
      Sound.tone(660, 0.09, 0.06, 'square', 990);
      if (g.state === 'playing') g.notify(g.player, tidy(m.name) + ' invited you to a party');
    } else if (m.t === 'party') {
      this.party = m.m && m.m.length > 1 ? { leader: m.leader, m: m.m.map((x) => [x[0], tidy(x[1])]) } : null;
      if (this.party) for (const x of this.party.m) this.invites.delete(x[0]);
    } else if (m.t === 'note') this.note = String(m.msg || '').slice(0, 120);
    else if (m.t === 'go') { // the party leader pressed DROP IN: this game follows, unless it is busy with a match of its own
      if (g.state === 'menu' || g.state === 'over') { this.mode = m.mode; this.wantJoin = true; this.panel('Joining ' + tidy(m.by) + "'s match..."); }
      else this.send({ t: 'leave' });
    }
    this.renderFriends();
  },
  code4(c) { return c ? c.slice(0, 4) + '-' + c.slice(4) : ''; },
  addFriend(raw, name) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), list = this.friends();
    if (code.length !== 8) this.note = 'Type your friend\'s username, like SwiftOtter42.';
    else if (code === this.me) this.note = 'That is you. Ask your friend for their name.';
    else if (list.some((f) => f.code === code)) this.note = 'They are already on your list.';
    else if (list.length >= 50) this.note = 'Your list is full (50 friends).';
    else {
      list.push({ code, name: name || this.requests.get(code) || '', ok: 0 });
      const ig = this.ignored(), i = ig.indexOf(code); if (i >= 0) ig.splice(i, 1);
      this.requests.delete(code); Progress.save();
      this.send({ t: 'friends', list: list.map((f) => f.code) });
      this.note = 'Added' + (name ? ' ' + name : '') + '. You will see each other online once they add you back.';
      this.renderFriends(); return true;
    }
    this.renderFriends(); return false;
  },
  removeFriend(code) {
    const list = this.friends(), i = list.findIndex((f) => f.code === code); if (i < 0) return;
    list.splice(i, 1); Progress.save(); this.on.delete(code); this.invites.delete(code);
    this.send({ t: 'friends', list: list.map((f) => f.code) });
    this.note = ''; this.renderFriends();
  },
  // The FRIENDS button on the hub and the sheet behind it.
  renderFriends() {
    const $ = (id) => (typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null);
    const btn = $('friends-btn'), list = $('fr-list'); if (!btn || !list) return;
    btn.classList.remove('hidden');
    const sheet = $('fr-me') && $('fr-me').parentNode;
    if (sheet && sheet.classList) sheet.classList.toggle('nolink', !this.url());
    if (!this.url()) { // this copy of the game has no online server to reach: say so instead of hiding the button
      $('friends-n').textContent = 'OFFLINE'; btn.classList.remove('ready');
      $('fr-code').textContent = this.callsign(); $('fr-status').textContent = ''; // your name is yours already; it is checked against everyone else's the first time you go online
      const h = '<p class="fr-offline"><b>You are not online.</b>Your name is ready for when you are. Friends needs the online game server, and this copy of the game is not connected to one, so you cannot add friends or play together yet. Every mode still works against bots.</p>';
      if (h !== this.lastFriendsHtml) { list.innerHTML = h; this.lastFriendsHtml = h; }
      return;
    }
    const live = !!(this.ws && this.ws.readyState === 1 && this.me), nInv = this.invites.size + this.requests.size;
    btn.classList.toggle('ready', nInv > 0);
    $('friends-n').textContent = nInv ? nInv + ' NEW' : this.party ? 'PARTY OF ' + this.party.m.length : live ? this.on.size + ' ONLINE' : 'OFFLINE';
    $('fr-code').textContent = this.me ? this.callsign() : '----';
    $('fr-status').textContent = live ? '' : 'Not connected. Trying again...';
    $('fr-msg').textContent = this.note;
    const row = (cls, name, text, buttons) => '<div class="fr-row ' + cls + '"><i></i><b>' + name + '</b><span>' + text + '</span>' + buttons + '</div>';
    let h = '';
    if (this.party) {
      const lead = this.party.leader === this.me;
      h += '<div class="fr-party"><b>PARTY</b><span>' + this.party.m.map((x) => (x[0] === this.me ? 'You' : x[1]) + (x[0] === this.party.leader ? ' (leader)' : '')).join(', ') + '</span><button class="mini" data-pleave="1">Leave party</button>'
        + '<em>' + (lead ? 'Your DROP IN takes the whole party into the same match.' : 'The leader starts the match for everyone.') + '</em></div>';
    }
    for (const [code, name] of this.invites) h += row('new', name, 'invited you to a party', '<button class="mini go" data-accept="' + code + '">Join</button><button class="mini x" data-dismiss="' + code + '" aria-label="Dismiss">&times;</button>');
    for (const [code, name] of this.requests) h += row('new', name || this.code4(code), 'added you as a friend', '<button class="mini go" data-add="' + code + '">Add back</button><button class="mini x" data-ignore="' + code + '" aria-label="Ignore">&times;</button>');
    const fl = this.friends().slice().sort((a, b) => (this.on.has(b.code) ? 1 : 0) - (this.on.has(a.code) ? 1 : 0));
    const full = this.party && this.party.m.length >= 4, canInvite = !this.party || true;
    for (const f of fl) {
      const o = this.on.get(f.code), name = (o && o.name) || f.name || this.code4(f.code);
      const text = o ? (o.party ? 'In your party' : o.busy ? 'In a match' : 'Online') : f.ok ? 'Offline' : 'Waiting for them to add you back';
      h += row(o ? 'on' : 'off', name, text, (o && !o.party && !full && canInvite ? '<button class="mini go" data-invite="' + f.code + '">Invite</button>' : '') + '<button class="mini x" data-remove="' + f.code + '" aria-label="Remove">&times;</button>');
    }
    if (!fl.length && !this.invites.size && !this.requests.size) h += '<p class="picker-desc fr-empty">No friends yet. Tell a friend your name and type in theirs: once you have each added the other, you can see when they are online and invite them to your match.</p>';
    if (h !== this.lastFriendsHtml) { list.innerHTML = h; this.lastFriendsHtml = h; }
  },
  // Wire the hub button and the sheet. Called once the page and the game exist.
  init(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id), start = $('start-panel');
    if (!$('friends-btn') || !start || !start.classList) return;
    $('friends-btn').addEventListener('click', () => { this.note = ''; start.classList.add('friends'); this.connect(); this.renderFriends(); });
    $('friends-close').addEventListener('click', () => start.classList.remove('friends'));
    $('fr-add').addEventListener('click', () => {
      const box = $('fr-input'), v = String(box.value || '').replace(/[^A-Za-z0-9]/g, '');
      if (!v) { this.note = 'Type your friend\'s username, like SwiftOtter42.'; this.renderFriends(); return; }
      if (!(this.ws && this.ws.readyState === 1 && this.me)) { this.note = 'Not connected yet. Try again in a moment.'; this.renderFriends(); return; }
      this.note = 'Looking for ' + v + '...'; this.send({ t: 'find', name: v }); box.value = ''; this.renderFriends();
    });
    $('fr-rename').addEventListener('click', () => {
      if (!(this.ws && this.ws.readyState === 1 && this.me)) return;
      this.send({ t: 'rename', name: U.pick(NET_CALLSIGNS[0]) + U.pick(NET_CALLSIGNS[1]) + (10 + Math.floor(Math.random() * 90)) });
      this.note = 'New name. Friends who already added you keep you on their list.'; this.renderFriends();
    });
    $('fr-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('fr-add').click(); } e.stopPropagation(); });
    $('fr-copy').addEventListener('click', () => {
      const mine = this.callsign(), done = (ok) => { this.note = ok ? 'Name copied. Send it to a friend.' : 'Your name is ' + mine + '.'; this.renderFriends(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(mine).then(() => done(true), () => done(false)); else done(false);
    });
    $('fr-list').addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button') : null; if (!b) return;
      const d = b.dataset;
      if (d.invite) this.send({ t: 'invite', to: d.invite });
      else if (d.accept) { this.send({ t: 'accept', from: d.accept }); this.invites.delete(d.accept); }
      else if (d.dismiss) this.invites.delete(d.dismiss);
      else if (d.add) { this.addFriend(d.add); return; }
      else if (d.ignore) { this.requests.delete(d.ignore); this.ignored().push(d.ignore); if (this.ignored().length > 200) this.ignored().shift(); Progress.save(); }
      else if (d.pleave) this.send({ t: 'pleave' });
      else if (d.remove) { const f = this.friends().find((x) => x.code === d.remove); if (typeof confirm !== 'function' || confirm('Remove ' + ((f && f.name) || this.code4(d.remove)) + ' from your friends?')) this.removeFriend(d.remove); return; }
      this.renderFriends();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.ws) { this.retry = 0; this.connect(); } });
    this.renderFriends();
    this.connect();
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
      const ch = r.ch ? Chars.get(r.ch) : null; // a person's character: its look shows unless they wear a skin
      a.name = r.name; a.team = r.team; a.human = !!r.human; a.char = ch; a.skin = it && it.type === 'skin' ? it.value : ch ? ch.look : null; a.color = a.skin ? a.skin.color : r.color;
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
      a.hideT = flags & 8 ? 0.3 : 0; a.guardT = flags & 16 ? 0.3 : 0; a.blastT = flags & 32 ? 2 : 0; a.frenzyT = flags & 64 ? 2.5 : 0; // abilities in use
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
      if (me.mh) p.maxHp = me.mh; p.abCd = me.ab || 0; p.spCharge = me.sp || 0;
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
        if (k === this.player) { Sound.kill(); this.notify(k, 'Eliminated ' + v.name); const wk = e[3] || 'pistol'; this.ms.weaponKills[wk] = (this.ms.weaponKills[wk] || 0) + 1; }
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
    if (inp.justPressed('f')) { once |= 2; this.ms.medsUsed++; }
    if (inp.justPressed('q') || inp.justPressed(' ')) once |= 4; // the character's ability
    if (inp.justPressed('x')) once |= 8;                              // the special attack
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
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('DOMContentLoaded', () => { if (window.game) Net.init(window.game); });
}
