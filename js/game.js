'use strict';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas, document.getElementById('minimap'));
    this.input = new Input(this.canvas);
    this.state = 'menu'; this.time = 0; this.dt = 0; this.last = performance.now();
    this.world = null; this.actors = []; this.bullets = []; this.particles = []; this.brains = []; this.vehicles = [];
    this.killfeed = []; this.notices = []; this.nearLoot = null; this.nearCar = null;
    this.mode = MODES.solo; this.map = MAPS.grass;
    this.$ = (id) => document.getElementById(id);
    this.ui = {
      hud: this.$('hud'), overlay: this.$('overlay'), start: this.$('start-panel'), over: this.$('over-panel'),
      stat1: this.$('stat1'), stat2: this.$('stat2'), zoneStatus: this.$('zone-status'), zoneWarn: this.$('zone-warn'),
      killfeed: this.$('killfeed'), notices: this.$('notices'), prompt: this.$('prompt'), spectate: this.$('spectate'),
      hpFill: this.$('health-fill'), hpText: this.$('health-text'), shFill: this.$('shield-fill'), shText: this.$('shield-text'),
      weapons: this.$('weapons'), meds: this.$('med-count'), banner: this.$('banner'), powers: this.$('powers'), diffLine: this.$('diff-line'),
      overTitle: this.$('over-title'), warbar: this.$('warbar'), overSub: this.$('over-sub'), overStats: this.$('over-stats'), scoreboard: this.$('scoreboard'), pause: this.$('pause-panel'),
    };
    this.lastWeaponsHtml = '';
    this.$('play-btn').addEventListener('click', () => this.play());
    this.$('again-btn').addEventListener('click', () => { if (this.camp && !this.win) this.start(); else this.play(); }); // a retry skips the briefing
    this.$('deploy-btn').addEventListener('click', () => this.start());
    this.$('brief-back').addEventListener('click', () => this.toMenu());
    this.$('menu-btn').addEventListener('click', () => this.toMenu());
    this.$('resume-btn').addEventListener('click', () => this.resume());
    this.$('quit-btn').addEventListener('click', () => this.toMenu());
    window.addEventListener('mousedown', (e) => { if (this.state === 'paused' && !(e.target && e.target.tagName === 'BUTTON')) this.resume(); });
    window.addEventListener('touchend', (e) => { if (this.state === 'paused' && e.target && e.target.closest && e.target.closest('#overlay') && e.target.tagName !== 'BUTTON') this.resume(); }); // phones do not send mousedown for a tap on bare background
    this.input.onLockLost = () => { if (this.state === 'playing' && this.player.alive && !this.input.touch) this.pause(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); }); // phone locked or app switched: do not fight on unseen
    this.ui.touch = this.$('touch'); this.ui.tMed = this.$('t-med-count');
    // On a phone in landscape DROP IN and SHOP live in the left column, always on screen, while the options scroll.
    const dock = () => {
      try {
        const acts = this.$('play-btn').parentNode, left = this.$('profile-start').parentNode, right = this.$('battle-row').parentNode;
        const phone = window.innerHeight < 500 && window.innerWidth >= 560;
        if (phone && acts.parentNode !== left) left.insertBefore(acts, this.$('challenges'));
        else if (!phone && acts.parentNode !== right) right.insertBefore(acts, right.querySelector('.keys'));
      } catch (e) { /* no real DOM (headless tests) */ }
    };
    dock(); window.addEventListener('resize', dock);
    // progression / shop
    Progress.load();
    this.$('profile-start').innerHTML = Progress.summaryHtml();
    this.$('shop-btn').addEventListener('click', () => this.openShop(this.ui.start));
    this.$('shop-btn2').addEventListener('click', () => this.openShop(this.ui.over));
    this.$('shop-close').addEventListener('click', () => this.closeShop());
    this.$('shop-list').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.buy) Progress.buy(b.dataset.buy);
      else if (b.dataset.equip) Progress.equip(b.dataset.equip);
      this.renderShop();
    });
    // mode / map pickers
    this.$('mode-picker').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !b.dataset.mode) return;
      Progress.data.prefs.mode = b.dataset.mode; Progress.save(); this.buildPickers();
    });
    this.$('map-picker').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.mission !== undefined) { Progress.data.prefs.mission = +b.dataset.mission; Progress.save(); this.buildPickers(); return; }
      if (!b.dataset.map) return;
      Progress.data.prefs.map = b.dataset.map; Progress.save(); this.buildPickers();
    });
    this.$('battle-picker').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !b.dataset.battle) return;
      Progress.data.prefs.battle = b.dataset.battle; Progress.save(); this.buildPickers();
    });
    this.$('mut-picker').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !b.dataset.mut) return;
      Progress.data.prefs.mutator = b.dataset.mut; Progress.save(); this.buildPickers();
    });
    for (const id of ['profile-start', 'profile-over']) this.$(id).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !b.dataset.prestige) return;
      const ok = typeof confirm === 'function' ? confirm('Prestige ' + (Progress.data.prestige + 1) + '? Your XP and shop unlocks reset. You keep your stats and level, and gain a power-up slot, +10% XP and the Prestige skin.') : true;
      if (ok && Progress.doPrestige()) { this.refreshProfiles(); this.buildPickers(); }
    });
    this.$('assist-btn').addEventListener('click', () => { Progress.data.prefs.aimAssist = !Progress.data.prefs.aimAssist; Progress.save(); this.buildPickers(); });
    this.$('reset-link').addEventListener('click', (e) => {
      e.preventDefault();
      const ok = typeof confirm === 'function' ? confirm('Reset ALL progress? XP, unlocks, prestige and stats are wiped.') : true;
      if (ok) { Progress.reset(); this.refreshProfiles(); this.buildPickers(); }
    });
    this.$('diff-picker').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !b.dataset.diff) return;
      Progress.data.prefs.difficulty = b.dataset.diff; Progress.save(); this.buildPickers();
    });
    this.buildPickers();
    this.menuScene = this.makeMenuScene();
    requestAnimationFrame((t) => this.frame(t));
  }

  // A quiet map drifting behind the menu. Rebuilt with a random map each time the menu opens.
  makeMenuScene() {
    try {
      const world = new World(MAPS[U.pick(MAP_ORDER)], { loot: false, roads: true });
      world.zone.makeFixed();
      const focus = { x: world.w / 2, y: world.h / 2, isPlayer: true, color: '#fff', angle: 0 };
      return { menu: true, world, mode: { type: 'menu' }, actors: [], vehicles: [], bullets: [], particles: [], time: 0, dt: 0, state: 'menu', mut: null, sites: null, round: null,
        player: { alive: false, flash: 0, x: focus.x, y: focus.y, team: 0 }, focus, cameraTarget() { return this.focus; }, t0: performance.now() };
    } catch (e) { return null; }
  }
  refreshProfiles() { this.$('profile-start').innerHTML = Progress.summaryHtml(); this.$('profile-over').innerHTML = Progress.summaryHtml(); }

  buildPickers() {
    const prefs = Progress.data.prefs;
    this.$('challenges').innerHTML = Progress.challengesHtml();
    if (!MUTATORS[prefs.mutator]) prefs.mutator = 'none';
    this.$('mut-picker').innerHTML = MUT_ORDER.map((id) => '<button data-mut="' + id + '"' + (prefs.mutator === id ? ' class="sel"' : '') + '>' + MUTATORS[id].name + '</button>').join('');
    const mu = MUTATORS[prefs.mutator];
    this.$('mut-desc').textContent = mu.desc + (mu.xpBonus ? ' +' + Math.round(mu.xpBonus * 100) + '% XP.' : '') + (prefs.mode === 'gungame' && mu.weapon ? ' (Gun Game ignores weapon mutators.)' : '') + (prefs.mode === 'campaign' && mu.id !== 'none' ? ' (Campaign ignores mutators.)' : '');
    if (!MODES[prefs.mode]) prefs.mode = 'solo';
    const short = { solo: '32 players', duos: '16 x 2', campaign: CAMPAIGN.length + ' missions', squads: '8 x 4', mega: '100 · cars', deathmatch: '12 · 4 min', gungame: '12 · ladder', zombies: '4 co-op', bomb: '5 v 5', war: '6 battles' };
    this.$('mode-picker').innerHTML = MODE_ORDER.map((id) => '<button data-mode="' + id + '"' + (prefs.mode === id ? ' class="sel"' : '') + '><canvas width="72" height="72" data-icon="' + id + '"></canvas><b>' + MODES[id].name + '</b><small>' + (short[id] || '') + '</small></button>').join('');
    const camp = prefs.mode === 'campaign', cp = Progress.data.campaign;
    this.$('map-label').textContent = camp ? 'MISSION' : 'MAP';
    this.$('map-picker').className = camp ? 'picker missions' : 'picker maps';
    if (camp) {
      prefs.mission = U.clamp(prefs.mission | 0, 0, Math.min(cp.unlocked, CAMPAIGN.length - 1));
      this.$('map-picker').innerHTML = CAMPAIGN.map((m, i) => '<button data-mission="' + i + '" class="' + (i === prefs.mission ? 'sel ' : '') + (i > cp.unlocked ? 'locked' : cp.done.includes(m.id) ? 'done' : '') + '"' + (i > cp.unlocked ? ' disabled' : '') + '><i>' + (i > cp.unlocked ? 'LOCKED' : cp.done.includes(m.id) ? 'CLEARED' : 'MISSION ' + (i + 1)) + '</i><b>' + m.name + '</b><small>' + m.kind + '</small></button>').join('');
    } else this.$('map-picker').innerHTML = ['random'].concat(MAP_ORDER).map((id) => '<button data-map="' + id + '"' + (prefs.map === id ? ' class="sel"' : '') + '><canvas width="192" height="116" data-thumb="' + id + '"></canvas><span>' + (id === 'random' ? 'Random' : MAPS[id].name) + '</span></button>').join('');
    // War: which kind of battle (Random picks one, never the same twice running)
    const isWar = prefs.mode === 'war', bt = WAR_BATTLES[prefs.battle] ? prefs.battle : 'random';
    this.$('battle-row').classList.toggle('hidden', !isWar);
    this.$('battle-picker').innerHTML = ['random'].concat(WAR_BATTLE_ORDER).map((id) => '<button data-battle="' + id + '"' + (bt === id ? ' class="sel"' : '') + '>' + (id === 'random' ? 'Random' : WAR_BATTLES[id].name) + '</button>').join('');
    this.$('battle-desc').textContent = bt === 'random' ? 'A different battle every time: the type, the lie of the land, the weather and how the offensives go in.' : WAR_BATTLES[bt].desc;
    const mp = this.$('mode-picker'), mk = this.$('map-picker');
    if (mp.querySelectorAll) for (const c of mp.querySelectorAll('canvas[data-icon]')) this.renderer.drawModeIcon(c, c.dataset.icon);
    if (mk.querySelectorAll) for (const c of mk.querySelectorAll('canvas[data-thumb]')) this.renderer.drawMapThumb(c, c.dataset.thumb === 'random' ? null : MAPS[c.dataset.thumb]);
    if (!DIFFICULTIES[prefs.difficulty]) prefs.difficulty = 'adaptive';
    this.$('diff-picker').innerHTML = DIFF_ORDER.map((id) => '<button data-diff="' + id + '"' + (prefs.difficulty === id ? ' class="sel"' : '') + '>' + DIFFICULTIES[id].name + '</button>').join('');
    const dd = DIFFICULTIES[prefs.difficulty];
    this.$('diff-desc').textContent = dd.desc + (dd.L === null ? ' Currently ' + Progress.lethalityName() + '.' : '');
    const m = MAPS[prefs.map], threat = Progress.threat();
    this.$('tagline').textContent = MODES[prefs.mode].tagline || '';
    const ab = this.$('assist-btn'); ab.textContent = 'Aim assist: ' + (prefs.aimAssist ? 'On' : 'Off'); ab.classList.toggle('on', !!prefs.aimAssist);
    if (camp) { const cm = CAMPAIGN[prefs.mission]; this.$('mode-desc').textContent = 'Mission ' + (prefs.mission + 1) + ' \u00b7 ' + cm.name + ' \u00b7 ' + MAPS[cm.theme].name + (cm.allies ? ' \u00b7 squad of ' + (cm.allies + 1) : ' \u00b7 solo') + '.  ' + cm.brief; }
    else this.$('mode-desc').textContent = MODES[prefs.mode].desc + (threat > 1 ? ' Your power-ups raise the ' + (prefs.mode === 'zombies' ? 'horde' : 'lobby') + ' to x' + threat + '.' : '') + (m ? '  |  ' + m.name + ': ' + m.desc : '');
  }

  openShop(fromPanel) {
    this.shopReturn = fromPanel;
    fromPanel.classList.add('hidden');
    this.$('shop-panel').classList.remove('hidden');
    this.renderShop();
  }
  closeShop() {
    this.$('shop-panel').classList.add('hidden');
    if (this.shopReturn) this.shopReturn.classList.remove('hidden');
    this.$('profile-start').innerHTML = Progress.summaryHtml();
    this.$('profile-over').innerHTML = Progress.summaryHtml();
  }
  renderShop() {
    this.$('shop-balance').textContent = Progress.data.xp.toLocaleString() + ' XP available';
    const list = this.$('shop-list');
    list.innerHTML = Progress.shopHtml(this.shopOnly);
    if (list.querySelectorAll) for (const c of list.querySelectorAll('canvas.skin-preview')) { const it = Progress.item(c.dataset.skin); if (it) this.renderer.drawSkinPreview(c, it.value); }
  }

  // ---------------------------------------------------------------- match setup
  play() { if (Progress.data.prefs.mode === 'campaign') this.showBriefing(); else this.start(); }
  // Campaign: the story so far, the objectives and a picture of the mission's map, before dropping in.
  showBriefing() {
    if (this.state !== 'menu') this.toMenu();
    const prefs = Progress.data.prefs, idx = U.clamp(prefs.mission | 0, 0, Math.min(Progress.data.campaign.unlocked, CAMPAIGN.length - 1)), m = CAMPAIGN[idx];
    prefs.mission = idx;
    this.$('brief-chapter').textContent = m.chapter + ' \u00b7 ' + m.kind;
    this.$('brief-title').textContent = m.name;
    this.$('brief-place').textContent = m.place + ' \u00b7 ' + (m.allies ? 'squad of ' + (m.allies + 1) : 'solo');
    this.$('brief-story').innerHTML = m.story.map((t) => '<p>' + t + '</p>').join('');
    this.$('brief-obj').innerHTML = m.objectives.map((t) => '<li>' + t + '</li>').join('');
    this.$('brief-map-cap').textContent = MAPS[m.theme].name + ' \u00b7 you start at the white marker';
    this.renderer.drawBriefMap(this.$('brief-map'), Campaign.world(idx, false));
    this.ui.start.classList.add('hidden'); this.ui.over.classList.add('hidden');
    this.$('brief-panel').classList.remove('hidden'); this.ui.overlay.classList.remove('hidden');
  }
  start() {
    Sound.init();
    const prefs = Progress.data.prefs;
    let mode = this.mode = MODES[prefs.mode] || MODES.solo;
    this.pruneAt = 10; this.camp = null; this.war = null; this.lastWarHtml = null; this.holdingE = false;
    const mission = mode.type === 'campaign' ? CAMPAIGN[U.clamp(prefs.mission | 0, 0, CAMPAIGN.length - 1)] : null;
    if (mission) mode = this.mode = Object.assign({}, mode, { size: mission.size, cars: mission.cars || 0, roads: !!mission.roads, teamSize: mission.allies + 1, players: mission.allies + 1 });
    const mapId = mission ? mission.theme : !prefs.map || prefs.map === 'random' ? U.pick(MAP_ORDER.filter((id) => id !== this.lastMapId || MAP_ORDER.length < 2)) : prefs.map;
    this.lastMapId = mapId;
    this.map = MAPS[mapId] || MAPS.grass;
    let mut = MUTATORS[prefs.mutator] || MUTATORS.none;
    if (mut.id === 'random') mut = MUTATORS[U.pick(MUT_ORDER.filter((id) => id !== 'none' && id !== 'random' && id !== this.lastMutId))];
    this.lastMutId = mut.id;
    if ((mode.type === 'gungame' && mut.weapon) || mission) mut = MUTATORS.none;
    this.mut = mut;
    this.ms = { weaponKills: {}, medsUsed: 0, pickups: 0, objectives: 0 }; // per-match stats for challenges
    this.round = null; this.sites = null; this.score = [0, 0]; this.hazards = [];
    this.world = mission ? Campaign.world(CAMPAIGN.indexOf(mission), true)
      : mode.type === 'war' ? War.world(this.map, mode)
      : new World(this.map, { size: mode.size || (mode.arena ? 2000 : MAP_W), loot: mode.type !== 'gungame', fixedZone: !!mode.arena || !!mode.noZone, roads: !!mode.roads, zoneScale: mode.zoneScale || 1 });
    this.vehicles = []; this.nearCar = null;
    if (mode.cars) this.spawnVehicles(mode.cars);
    if (mut.weapon) for (const l of this.world.loot) if (l.kind === 'weapon') { l.kind = 'ammo'; l.weapon = null; }
    if (mut.noShield) for (const l of this.world.loot) if (l.kind === 'shield') { l.kind = 'medkit'; }
    this.actors = []; this.bullets = []; this.particles = []; this.brains = [];
    this.killfeed = []; this.notices = []; this.time = 0; this.overTimer = 0; this.panelShown = false;
    this.timeLeft = mode.duration || 0; this.scoreboard = null; this.placement = 0;
    // Zombies: waves alternate between a break (countdown) and a wave that ends when the horde is dead
    this.wave = 0; this.waveState = 'break'; this.waveTimer = mode.firstWave || 0; this.toSpawn = 0; this.wavesCleared = 0; this.zombiesKilled = 0; this.bannerUntil = 0;
    Actor.nextId = 1;
    this.P = Progress.perks(); this.L = mission && prefs.difficulty === 'adaptive' ? 0.45 : Progress.lethality(); // Adaptive plays the campaign at Normal

    const w = this.world;
    // spread teams over a shuffled grid of cells so nobody drops next to anyone
    const teamsN = Math.ceil(mode.players / mode.teamSize), cellsPer = Math.ceil(Math.sqrt(teamsN + 1)), cs = w.w / cellsPer;
    const cells = U.shuffle([...Array(cellsPer * cellsPer).keys()]).map((i) => ({ x: (i % cellsPer) * cs, y: Math.floor(i / cellsPer) * cs }));
    const cellSpot = () => {
      while (cells.length) {
        const c = cells.pop();
        for (let t = 0; t < 30; t++) { const x = c.x + U.rand(cs * 0.15, cs * 0.85), y = c.y + U.rand(cs * 0.15, cs * 0.85); if (w.inBounds(x, y, 60) && !w.circleBlocked(x, y, 30)) return { x, y }; }
      }
      return null;
    };
    const pp = cellSpot() || w.freeSpot(30, 150) || { x: w.w / 2, y: w.h / 2 };
    const p = this.player = new Actor(pp.x, pp.y, 'You', '#f2f2f2', true);
    p.team = 0;
    this.applyLoadout(p);
    this.giveModeLoadout(p);
    this.applyMutator(p);
    this.actors.push(p);

    // bots, grouped into teams; teammates spawn together
    const names = U.shuffle(BOT_NAMES);
    const anchors = { 0: pp };
    const botSkins = SHOP_ITEMS.filter((i) => i.type === 'skin' && !i.prestige), teamSkins = {};
    for (let i = 0; i < mode.players - 1; i++) {
      const idx = i + 1, team = Math.floor(idx / mode.teamSize);
      let pos = null;
      if (anchors[team]) {
        for (let t = 0; t < 40 && !pos; t++) {
          const a = U.rand(0, Math.PI * 2), d = U.rand(90, 220);
          const c = { x: anchors[team].x + Math.cos(a) * d, y: anchors[team].y + Math.sin(a) * d };
          if (w.inBounds(c.x, c.y, 40) && !w.circleBlocked(c.x, c.y, 30)) pos = c;
        }
      }
      if (!pos && !anchors[team]) pos = cellSpot();
      const minPlayer = mode.arena ? 300 : 900, minOther = mode.arena ? 250 : 650;
      for (let t = 0; t < 40 && !pos; t++) {
        const c = w.freeSpot(30, 150);
        if (c && U.dist(c.x, c.y, p.x, p.y) > minPlayer && Object.values(anchors).every((o) => U.dist(o.x, o.y, c.x, c.y) > minOther)) pos = c;
      }
      if (!pos) pos = w.freeSpot(30, 100) || { x: w.w / 2, y: w.h / 2 };
      if (!anchors[team]) anchors[team] = pos;
      const color = team === 0 ? '#7fe07a' : 'hsl(' + ((team * 53 + 20) % 360) + ',65%,55%)';
      const bot = new Actor(pos.x, pos.y, names[i % names.length] + (i >= names.length ? i : ''), color, false);
      bot.team = team;
      if (team === 0) { // your squad wears your skin
        if (this.P.skin) { bot.skin = this.P.skin; bot.color = this.P.skin.color; }
      } else {
        if (mode.teamSize > 1 && !teamSkins[team]) teamSkins[team] = Math.random() < 0.7 ? U.pick(botSkins) : null;
        const sk = mode.teamSize > 1 ? teamSkins[team] : (Math.random() < 0.7 ? U.pick(botSkins) : null);
        if (sk) { bot.skin = sk.value; bot.color = sk.value.color; }
      }
      const brain = new BotBrain(bot);
      if (mode.type === 'war' && team === 0) { const L = this.L; this.L = 0.45; this.toughenBot(bot, brain); this.L = L; } // your own army is always Normal; difficulty is the enemy's
      else if (team !== 0 || mode.type !== 'zombies') this.toughenBot(bot, brain);
      if (mut.fog) brain.viewRange *= 0.45;
      else if (mode.type === 'zombies' && this.L < 0.15) { brain.skill = Math.min(1, brain.skill + 0.2); } // easy zombies: better squadmates
      this.giveModeLoadout(bot);
      this.applyMutator(bot);
      this.actors.push(bot);
      this.brains.push(brain);
    }

    this.renderer.zoom = this.P.zoom;
    this.renderer.camX = p.x; this.renderer.camY = p.y;
    this.ui.powers.innerHTML = SHOP_ITEMS.filter((i) => i.type === 'power' && Progress.isEquipped(i)).map((i) => '<span title="' + (i.down || '') + '">' + i.name + '</span>').join('');
    this.ui.powers.classList.remove('faded');
    if (prefs.map === 'random' || prefs.mutator === 'random') this.notify(p, this.map.name + (mut.id !== 'none' ? ' · ' + mut.name : ''));
    this.ui.diffLine.textContent = Progress.lethalityName(this.L) + (this.threat > 1 ? ' \u00b7 ' + (mode.type === 'zombies' ? 'Horde' : 'Lobby') + ' x' + this.threat : '') + (mut.id !== 'none' ? ' \u00b7 ' + mut.name : '');
    this.state = 'playing';
    // start() runs from a button click, so we may grab the mouse right away
    this.input.mouse.x = window.innerWidth / 2; this.input.mouse.y = window.innerHeight / 2; this.input.mouse.down = false;
    this.input.wantLock = true; this.input.lock();
    this.ui.overlay.classList.add('hidden'); this.ui.hud.classList.remove('hidden');
    this.ui.spectate.classList.add('hidden'); this.ui.over.classList.add('hidden'); this.ui.start.classList.add('hidden');
    this.ui.banner.classList.add('hidden');
    this.lastWeaponsHtml = ''; this.lastKillfeedHtml = null; this.lastNoticesHtml = null; this.lastS1 = this.lastS2 = this.lastS3 = null;
    this.ui.killfeed.innerHTML = ''; this.ui.notices.innerHTML = ''; this.ui.prompt.textContent = '';
    this.$('radio').classList.add('hidden'); this.$('brief-panel').classList.add('hidden');
    if (mission) Campaign.setup(this, CAMPAIGN.indexOf(mission));
    if (mode.type === 'bomb') this.setupBomb();
    if (mode.type === 'war') War.setup(this);
  }

  // The lobby keeps pace with the player's shop: at threat > 1 bots aim and react better and some carry
  // power-ups and perks of their own. Zombies mode scales the horde instead (see waveSize / spawnZombie).
  toughenBot(bot, brain) {
    const x = this.threat - 1, L = this.L;
    if (L < 0.15) { // Easy: slow, wobbly, hesitant
      brain.skill *= 0.7; brain.viewRange = 560 + brain.skill * 260; brain.reactionMult = 1.6; brain.wobbleMult = 1.5; brain.pauseMult = 1.6;
    }
    brain.lethal = L;
    brain.skill = U.clamp(brain.skill + x * 0.3 + Math.max(0, L - 0.3) * 0.8, 0, 1); brain.viewRange = 560 + brain.skill * 260;
    brain.aggro = Math.min(1, brain.aggro + x * 0.25 + Math.max(0, L - 0.3) * 0.8);
    if (L >= 0.3) { brain.reactionMult = Math.max(0.08, 1 - (L - 0.3) * 1.2); brain.wobbleMult = Math.max(0.1, 1 - (L - 0.3) * 1.2); brain.pauseMult = Math.max(0.1, 1 - (L - 0.3) * 1.2); }
    brain.hunter = L >= 0.5;
    if (L >= 0.5) brain.viewRange += 150 * (L - 0.5) * 2;
    bot.shield = Math.min(100, Math.round(35 * Math.max(0, x) + 80 * Math.max(0, L - 0.5))); // everyone shows up with some armour
    bot.spawnShield = bot.shield; // and again every time they respawn
    if (x <= 0 && L < 0.5) return;
    const n = Math.random() < Math.min(1, Math.max(0, x) * 0.7 + Math.max(0, L - 0.5) * 0.9) ? (Math.random() < Math.max(0, x) * 0.5 + Math.max(0, L - 0.5) ? 2 : 1) : 0;
    const pool = U.shuffle(['homing', 'explosive', 'pierce', 'mags', 'rapid', 'vampire', 'secondwind', 'hp', 'shield', 'speed']).slice(0, n);
    bot.powers = pool;
    for (const k of pool) {
      if (k === 'homing') bot.homing = true;
      else if (k === 'explosive') bot.explosive = true;
      else if (k === 'pierce') bot.pierce = 1;
      else if (k === 'mags') { bot.magMult = 1.5; for (const w of bot.weapons) { bot.applyWeaponMods(w); w.ammo = w.mag; } }
      else if (k === 'rapid') bot.rateMult = 0.8;
      else if (k === 'vampire') bot.lifesteal = 0.2;
      else if (k === 'secondwind') bot.secondWind = 1;
      else if (k === 'hp') { bot.maxHp = 125; bot.hp = 125; }
      else if (k === 'shield') { bot.shield = 50; bot.spawnShield = 50; }
      else if (k === 'speed') bot.speed *= 1.1;
    }
  }

  // Mutator effects on one actor (also on respawn).
  applyMutator(a) {
    const m = this.mut; if (!m || m.id === 'none') return;
    if (m.weapon) {
      const w = makeWeapon(m.weapon); a.applyWeaponMods(w); w.ammo = w.mag; w.reserve = w.ammoPickup * (m.weapon === 'rocket' ? 6 : 5);
      a.weapons = [w]; a.wi = 0;
    }
    if (m.hpMult) { if (!a.mutHp) { a.mutHp = true; a.maxHp = Math.round(a.maxHp * m.hpMult); } a.hp = Math.min(a.hp, a.maxHp); } // once per actor, not once per respawn
    if (m.noShield) { a.shield = 0; a.maxShield = 0.0001; }
    if (m.speedMult && !a.mutSpeed) { a.mutSpeed = true; a.speed *= m.speedMult; }
  }

  // Purchased perks and loadout for the player.
  applyLoadout(p) {
    const P = this.P;
    p.color = P.color; p.skin = P.skin; p.maxHp = 100 + P.hpBonus; p.hp = p.maxHp; p.shield = P.startShield;
    p.speed = 235 * P.speedMult; p.reloadMult = P.reloadMult; p.ammoMult = P.ammoMult; p.meds = P.meds;
    p.magMult = P.magMult; p.rateMult = P.rateMult; p.homing = P.homing; p.explosive = P.explosive; p.pierce = P.pierce;
    p.lifesteal = P.lifesteal; p.secondWind = P.secondWind; p.zoneResist = P.zoneResist;
    p.dmgMult = P.dmgMult; p.spreadMult = P.spreadMult; p.shotCost = P.shotCost;
    p.weapons = [makeWeapon('pistol')]; p.wi = 0;
    if (P.startWeapon) { p.weapons.push(makeWeapon(P.startWeapon)); p.wi = 1; }
    for (const w of p.weapons) { p.applyWeaponMods(w); w.ammo = w.mag; }
  }

  // Mode-specific starting kit (applies to bots and player alike).
  giveModeLoadout(a) {
    const mode = this.mode;
    if (mode.type === 'gungame') { a.weapons = [this.gunFor(a)]; a.wi = 0; a.meds = 0; }
    else if (mode.type === 'dm' || mode.type === 'zombies' || mode.type === 'bomb' || mode.type === 'campaign') {
      if (a.weapons.length < 2) { const w = makeWeapon(U.pick(['smg', 'shotgun', 'rifle'])); a.applyWeaponMods(w); w.ammo = w.mag; a.weapons.push(w); }
      for (const w of a.weapons) w.reserve = w.ammoPickup * 3;
      a.wi = a.weapons.length - 1;
    } else if (mode.type === 'war') War.loadout(this, a);
  }
  gunFor(a) {
    const ladder = this.mode.ladder;
    const w = makeWeapon(ladder[Math.min(a.gunLevel, ladder.length - 1)]);
    a.applyWeaponMods(w); w.ammo = w.mag; w.reserve = 999; w.infinite = true;
    return w;
  }

  respawn(a) {
    const w = this.world, enemies = this.actors.filter((o) => o.alive && o.team !== a.team);
    let pos = null;
    for (let t = 0; t < 30 && !pos; t++) {
      const c = w.freeSpot(30, 100);
      if (c && enemies.every((e) => U.dist(e.x, e.y, c.x, c.y) > 350)) pos = c;
    }
    if (!pos) pos = w.freeSpot(30, 100) || { x: w.w / 2, y: w.h / 2 };
    if (a.car) this.leaveVehicle(a, true);
    a.x = pos.x; a.y = pos.y; a.alive = true; a.respawnAt = 0;
    a.hp = a.maxHp; a.shield = a.isPlayer ? this.P.startShield : a.spawnShield || 0; a.lastHitWeapon = null; a.healing = 0; a.flash = 0; a.invuln = 1.5;
    a.meds = a.isPlayer ? this.P.meds : 0; a.lastAttacker = null;
    if (this.mode.type === 'gungame') { a.weapons = [this.gunFor(a)]; a.wi = 0; }
    else {
      a.weapons = [makeWeapon('pistol')]; a.wi = 0;
      if (a.isPlayer && this.P.startWeapon) a.weapons.push(makeWeapon(this.P.startWeapon));
      for (const wp of a.weapons) { a.applyWeaponMods(wp); wp.ammo = wp.mag; }
      this.giveModeLoadout(a);
    }
    this.applyMutator(a);
    if (this.war) War.place(this, a); // reinforcements come up behind the front
    const br = this.brains.find((b) => b.bot === a);
    if (br) { br.target = null; br.dest = null; br.state = 'roam'; }
    if (a.isPlayer) { this.ui.banner.classList.add('hidden'); this.ui.spectate.classList.add('hidden'); }
  }

  // ---------------------------------------------------------------- pause and menu
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused'; this.input.keys.clear(); this.input.mouse.down = false;
    this.ui.overlay.classList.remove('hidden'); this.ui.pause.classList.remove('hidden');
    this.ui.start.classList.add('hidden'); this.ui.over.classList.add('hidden'); this.$('shop-panel').classList.add('hidden');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.overlay.classList.add('hidden'); this.ui.pause.classList.add('hidden');
    this.input.wantLock = true; this.input.lock();
    this.last = performance.now(); // no catch-up step after a long pause
  }
  // Back to the start screen (from the result panel or the pause menu). An abandoned match pays nothing.
  toMenu() {
    this.state = 'menu'; this.menuScene = this.makeMenuScene();
    this.input.unlock();
    this.ui.hud.classList.add('hidden'); this.ui.banner.classList.add('hidden');
    this.ui.pause.classList.add('hidden'); this.ui.over.classList.add('hidden'); this.$('shop-panel').classList.add('hidden');
    this.$('radio').classList.add('hidden'); this.$('brief-panel').classList.add('hidden');
    this.refreshProfiles();
    this.buildPickers();
    this.ui.overlay.classList.remove('hidden'); this.ui.start.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- loop
  frame(now) {
    // The loop must never die: one bad frame is reported on screen and skipped.
    try { this.step(now); }
    catch (err) {
      this.errors = (this.errors || 0) + 1;
      window.dispatchEvent(new ErrorEvent('error', { message: String(err && err.message || err) + ' (frame ' + this.frames + ')', filename: '', lineno: 0 }));
      if (this.errors > 50) return; // give up if it is broken every frame
    }
    if (this.frameScheduled) return;
    this.frameScheduled = true;
    requestAnimationFrame((t) => { this.frameScheduled = false; this.frame(t); });
  }

  step(now) {
    let dt = (now - this.last) / 1000; this.last = now;
    dt = U.clamp(dt, 0, 0.05); this.dt = dt;
    if (this.input.justPressed('p') || this.input.justPressed('escape') && this.state === 'paused') { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); }
    if (this.war && this.state === 'playing' && !this.player.alive && this.input.justPressed('c')) War.changeKit(this); // pick a kit while waiting to respawn
    if (this.input.justPressed('m') && this.state !== 'menu') { Sound.muted = !Sound.muted; this.notify(this.player, Sound.muted ? 'Muted' : 'Sound on'); }
    if (this.state === 'playing' || this.state === 'over') this.update(dt);
    const ride = this.state === 'playing' && this.player && this.player.alive ? this.player.car : null;
    Sound.engine(!!ride && ride.def.max > 0, ride && ride.def.max ? Math.abs(ride.speed) / ride.def.max : 0);
    if (this.state === 'menu' && this.menuScene) this.renderer.drawMenu(this.menuScene, now); else this.renderer.draw(this);
    if (this.world) this.updateHud();
    this.frames = (this.frames || 0) + 1;
    if (this.debugBox) {
      const w = this.player && this.player.weapon;
      this.debugBox.textContent = 'frames ' + this.frames + '  dt ' + dt.toFixed(4) + '  t ' + this.time.toFixed(2) + '  ' + this.mode.id + '/' + this.map.id
        + '\nstate ' + this.state + '  shots ' + (this.shots || 0) + '  bullets ' + this.bullets.length
        + '\nmouse ' + Math.round(this.input.mouse.x) + ',' + Math.round(this.input.mouse.y) + ' down=' + this.input.mouse.down + ' clicked=' + this.input.mouse.clicked + ' locked=' + this.input.locked
        + (w ? '\nweapon ' + w.key + ' ammo ' + w.ammo + ' cd ' + w.cooldown.toFixed(3) + ' reloading ' + w.reloading : '')
        + '\nerrors ' + (this.errors || 0) + '  particles ' + this.particles.length;
    }
    this.input.endFrame();
  }

  update(dt) {
    this.time += dt;
    const world = this.world, zone = world.zone, mode = this.mode;
    const zc = zone.update(dt);
    if (zc && this.player.alive) Sound.zone();

    if (mode.respawn) for (const a of this.actors) if (!a.alive && a.respawnAt && this.time >= a.respawnAt) this.respawn(a);
    if (mode.respawn || mode.lootRespawn) for (const l of world.loot) if (!l.alive && l.respawnAt && this.time >= l.respawnAt) { l.alive = true; l.respawnAt = 0; if (l.kind === 'weapon') l.weapon = makeWeapon(l.weapon.key); }

    for (const a of this.actors) if (a.alive) { a.vx = 0; a.vy = 0; }
    if (this.player.alive && this.state === 'playing') this.controlPlayer(dt);
    for (const p of this.actors) {
      const sk = p.skin;
      if (!sk || !sk.trail || !p.alive || !(p.vx || p.vy)) continue;
      if (Math.random() > (p.isPlayer ? 0.7 : 0.35) || U.dist(p.x, p.y, this.renderer.camX, this.renderer.camY) > 1000) continue;
      this.particles.push(new Particle(p.x - p.vx * 0.05 + U.rand(-5, 5), p.y - p.vy * 0.05 + U.rand(-5, 5), U.rand(-25, 25), U.rand(-25, 25), U.rand(0.3, 0.6), sk.trail, U.rand(2.5, 4.5)));
    }
    for (const br of this.brains) if (br.bot.alive) br.update(dt, this);
    this.updateVehicles(dt);

    for (const a of this.actors) {
      if (!a.alive) continue;
      a.update(dt, this);
      if (!a.car) world.resolveCircle(a);
      if (!zone.contains(a.x, a.y)) a.takeDamage(zone.dps * dt, null, this, true);
      if (!a.alive || a.zombie) continue;
      world.lootNear(a.x, a.y, a.r + 16, (l) => { if (l.alive && U.dist(a.x, a.y, l.x, l.y) < a.r + l.r) a.pickup(l, this, false); });
    }
    // separate overlapping actors a little
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i]; if (!a.alive || a.car) continue;
      for (let j = i + 1; j < this.actors.length; j++) {
        const b = this.actors[j]; if (!b.alive || b.car) continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
        if (dx > min || dx < -min || dy > min || dy < -min) continue;
        const d = Math.hypot(dx, dy);
        if (d < min && d > 0) { const p = (min - d) / 2 / d; a.x -= dx * p; a.y -= dy * p; b.x += dx * p; b.y += dy * p; }
      }
    }

    if (this.hazards.length) {
      this.hazards = this.hazards.filter((h) => h.until > this.time);
      for (const h of this.hazards) for (const a of this.actors) {
        if (!a.alive || a.zombie || U.dist(a.x, a.y, h.x, h.y) > h.r + a.r * 0.5) continue;
        if (a.poison <= 0 && a.isPlayer) this.notify(a, 'POISONED - use a medkit');
        a.poison = Math.max(a.poison, 2); a.poisonDps = 4; a.poisonSrc = h.src;
      }
    }
    for (const a of this.actors) if (a.alive && a.poison > 0 && Math.random() < 0.25) this.particles.push(new Particle(a.x + U.rand(-10, 10), a.y + U.rand(-10, 10), U.rand(-15, 15), -U.rand(20, 50), U.rand(0.4, 0.8), 'rgba(140,255,60,0.7)', U.rand(2, 4)));
    for (const b of this.bullets) b.update(dt, this);
    this.bullets = this.bullets.filter((b) => b.alive);
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => p.life > 0);
    this.notices = this.notices.filter((n) => this.time - n.time < 2.2);
    this.killfeed = this.killfeed.filter((k) => this.time - k.time < 8);
    if (this.time >= this.pruneAt && !this.war) { this.pruneAt = this.time + 10; world.pruneLoot(); } // forget loot that is gone for good

    if (this.state === 'playing') {
      if (mode.type === 'royale') {
        const teams = this.aliveTeams();
        if ((teams.size === 1 && teams.has(this.player.team)) || teams.size === 0) this.endGame(true); // everyone left died at once: the last squad standing was yours
        else if (!teams.has(this.player.team)) { this.placement = teams.size + 1; this.endGame(false); }
      } else if (mode.type === 'dm') {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.finishArena(null); }
      } else if (mode.type === 'zombies') this.updateWaves(dt);
      else if (mode.type === 'bomb') this.updateBomb(dt);
      else if (mode.type === 'campaign') Campaign.update(this, dt);
      else if (mode.type === 'war') War.update(this, dt);
    }
    if (this.bannerTemp && this.bannerUntil && this.time > this.bannerUntil && this.state === 'playing') { this.bannerTemp = false; this.bannerUntil = 0; this.ui.banner.classList.add('hidden'); }
    if (this.zombieDied) { // drop dead zombies from the actor list so long matches stay fast
      this.zombieDied = false;
      this.actors = this.actors.filter((a) => a.alive || !a.zombie);
      this.brains = this.brains.filter((b) => b.bot.alive || !b.bot.zombie);
    }
    if (this.state === 'over') {
      this.overTimer += dt;
      if (this.overTimer > 1.5 && !this.panelShown) this.showOverPanel();
    }
  }

  aliveCount() { let n = 0; for (const a of this.actors) if (a.alive) n++; return n; }
  aliveTeams() { const s = new Set(); for (const a of this.actors) if (a.alive) s.add(a.team); return s; }
  // Who a bot should stick with in team modes: the player if on their team, else the first living teammate.
  teamLeader(b) {
    if (this.mode.teamSize <= 1 || this.mode.type === 'bomb' || this.mode.type === 'war') return null; // an army follows orders, not a leader
    if (this.mode.type === 'campaign' && b.team !== this.player.team) return null; // enemy soldiers keep to their own posts
    if (b.team === this.player.team && this.player.alive) return this.player;
    for (const a of this.actors) if (a.alive && a.team === b.team) return a === b ? null : a;
    return null;
  }
  arenaRanking() {
    const gg = this.mode.type === 'gungame';
    const score = (a) => (gg ? a.gunLevel * 1000 : 0) + a.kills;
    return this.actors.slice().sort((a, b) => score(b) - score(a) || a.deaths - b.deaths);
  }

  // ---------------------------------------------------------------- Zombies mode
  humansAlive() { return this.actors.filter((a) => a.alive && !a.zombie); }
  zombiesAlive() { let n = 0; for (const a of this.actors) if (a.alive && a.zombie) n++; return n; }
  waveSize(w) { return Math.round((6 + w * 3) * Math.pow(this.threat, 0.5) * (0.85 + 0.5 * (this.L || 0))); }
  get threat() { return (this.P && this.P.threat) || 1; }
  get hordeCap() { return Math.min(64, Math.round(36 * Math.pow(this.threat, 0.5))); }

  updateWaves(dt) {
    if (this.humansAlive().length === 0) { this.endGame(false); return; }
    if (this.bannerUntil && this.time > this.bannerUntil) {
      this.bannerUntil = 0;
      if (this.ui.banner.textContent.startsWith('WAVE')) this.ui.banner.classList.add('hidden');
    }
    if (this.waveState === 'break') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.startWave();
      return;
    }
    const alive = this.zombiesAlive();
    if (this.toSpawn > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && alive < this.hordeCap) {
        this.spawnT = 0.45;
        const n = Math.min(this.toSpawn, this.threat > 1.5 ? 3 : 2);
        for (let i = 0; i < n; i++) this.spawnZombie(this.pickZombieType(this.wave), this.wave);
        this.toSpawn -= n;
      }
    } else if (alive === 0) this.endWave();
  }

  startWave() {
    this.wave++; this.waveState = 'wave'; this.toSpawn = this.waveSize(this.wave); this.spawnT = 0;
    // downed humans rejoin next to a living squadmate
    const anchor = this.humansAlive()[0];
    for (const a of this.actors) {
      if (a.alive || a.zombie) continue;
      this.respawn(a);
      if (anchor) { const c = this.spotNear(anchor.x, anchor.y, 80, 200, a.r); if (c) { a.x = c.x; a.y = c.y; } }
    }
    this.ui.banner.textContent = 'WAVE ' + this.wave; this.ui.banner.classList.remove('win'); this.ui.banner.classList.remove('hidden');
    this.bannerUntil = this.time + 1.6;
    Sound.wave();
  }

  endWave() {
    this.waveState = 'break'; this.wavesCleared = this.wave;
    if (this.wave >= this.mode.waves) { this.endGame(true); return; }
    this.waveTimer = this.mode.intermission;
    // survivors patch up a little and a supply drop lands beside the squad
    for (const a of this.humansAlive()) a.hp = Math.min(a.maxHp, a.hp + 30);
    const h = this.player.alive ? this.player : this.humansAlive()[0];
    if (h) for (const kind of ['ammo', 'ammo', 'medkit', 'shield']) this.dropLoot(h.x + U.rand(-110, 110), h.y + U.rand(-110, 110), kind);
    this.notify(this.player, 'Wave ' + this.wave + ' cleared - supplies dropped');
    Sound.kill();
  }

  pickZombieType(wave) {
    const table = [];
    for (const t of Object.values(ZOMBIE_TYPES)) {
      if (wave < t.minWave) continue;
      table.push({ t, w: t.id === 'brute' ? (t.weight + (wave - t.minWave) * 0.35) * Math.sqrt(this.threat) : t.weight });
    }
    let total = 0; for (const e of table) total += e.w;
    let r = Math.random() * total;
    for (const e of table) { r -= e.w; if (r <= 0) return e.t; }
    return table[0].t;
  }

  spotNear(x, y, dmin, dmax, r) {
    for (let t = 0; t < 30; t++) {
      const a = U.rand(0, Math.PI * 2), d = U.rand(dmin, dmax);
      const c = { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
      if (this.world.inBounds(c.x, c.y, r + 10) && !this.world.circleBlocked(c.x, c.y, r + 6)) return c;
    }
    return null;
  }

  spawnZombie(type, wave) {
    const w = this.world, humans = this.humansAlive();
    let pos = null;
    for (const far of [560, 380, 0]) {
      for (let t = 0; t < 30 && !pos; t++) {
        const c = w.freeSpot(type.r, 40);
        if (c && humans.every((h) => U.dist(h.x, h.y, c.x, c.y) > far)) pos = c;
      }
      if (pos) break;
    }
    if (!pos) pos = { x: w.w / 2, y: w.h / 2 };
    const z = new Actor(pos.x, pos.y, type.name, type.color, false);
    z.team = 1; z.zombie = type; z.r = type.r;
    z.maxHp = z.hp = Math.round(type.hp * (1 + 0.07 * (wave - 1)) * Math.pow(this.threat, 0.25));
    z.speed = U.rand(type.speed[0], type.speed[1]) * (type.id === 'walker' && wave >= 6 ? 1.15 : 1); // late walkers shamble faster
    z.weapons = []; z.wi = 0; z.meds = 0; z.attackCd = U.rand(0.2, 0.6);
    if (this.mut && this.mut.speedMult) z.speed *= this.mut.speedMult;
    this.actors.push(z); this.brains.push(new ZombieBrain(z));
    return z;
  }

  zombieAttack(z, t) {
    z.lunge = 0.18;
    const dealt = t.takeDamage(z.zombie.dmg, z, this, false);
    if (z.zombie.poison && t.alive) { if (t.poison <= 0 && t.isPlayer) this.notify(t, 'POISONED - use a medkit'); t.poison = Math.max(t.poison, z.zombie.poison.time); t.poisonDps = z.zombie.poison.dps; t.poisonSrc = z; }
    for (let i = 0; i < 6; i++) this.particles.push(new Particle(t.x, t.y, U.rand(-140, 140), U.rand(-140, 140), U.rand(0.2, 0.4), dealt > 0 && t.shield > 0 ? '#7fc4ff' : '#c62828', U.rand(2, 4)));
    if (t.isPlayer) { Sound.hurt(); this.renderer.kick({ key: z.zombie.id === 'brute' ? 'shotgun' : 'pistol' }); }
  }

  // ---------------------------------------------------------------- Bomb mode
  setupBomb() {
    const w = this.world, W = w.w, H = w.h;
    const site = (name, x, y) => { const c = this.spotNear(x, y, 0, 160, 90) || { x, y }; return { name, x: c.x, y: c.y, r: 110 }; };
    this.sites = [site('A', W * 0.74, H * 0.26), site('B', W * 0.74, H * 0.74)];
    this.spawns = { attack: { x: W * 0.1, y: H * 0.5 }, defend: { x: W * 0.92, y: H * 0.5 } };
    this.roundN = 0; this.score = [0, 0];
    this.startRound();
  }
  startRound() {
    const mode = this.mode;
    this.roundN++;
    this.attackers = this.roundN % 2 === 1 ? 0 : 1; // you attack on odd rounds
    this.attackSite = U.pick(this.sites);
    const rd = this.round = { n: this.roundN, state: 'live', timer: mode.roundTime, bomb: { x: 0, y: 0, carrier: null, planted: false, site: null, fuse: mode.fuse }, planting: null, defusing: null, breakT: 0 };
    for (const a of this.actors) {
      this.respawn(a);
      const sp = a.team === this.attackers ? this.spawns.attack : this.spawns.defend;
      const c = this.spotNear(sp.x, sp.y, 0, 220, a.r) || sp;
      a.x = c.x; a.y = c.y; a.invuln = 0; a.actionProgress = 0; a.objDest = null;
      const br = this.brains.find((b) => b.bot === a); if (br) { br.obj = null; br.heard = null; }
    }
    const att = this.actors.filter((a) => a.team === this.attackers);
    rd.bomb.carrier = att.find((a) => a.isPlayer) || U.pick(att);
    rd.bomb.x = rd.bomb.carrier.x; rd.bomb.y = rd.bomb.carrier.y;
    const mine = this.attackers === 0;
    this.flashBanner('ROUND ' + rd.n + ' - ' + (mine ? 'ATTACK' : 'DEFEND'), mine, 1.8);
    this.notify(this.player, mine ? 'Plant the bomb at A or B' : 'Stop them planting, or defuse');
    this.ui.spectate.classList.add('hidden');
    Sound.wave();
  }
  flashBanner(text, good, secs) {
    this.ui.banner.textContent = text; this.ui.banner.classList.toggle('win', !!good); this.ui.banner.classList.remove('hidden');
    this.bannerUntil = this.time + secs; this.bannerTemp = true;
  }
  siteAt(x, y) { return this.sites ? this.sites.find((s) => U.dist(x, y, s.x, s.y) < s.r) : null; }
  // Holding E (or a bot standing on its objective): plant, defuse or pick up. Progress resets when released.
  holdAction(a, dt) {
    const rd = this.round, mode = this.mode; if (!rd || rd.state === 'over' || !a.alive) return false;
    const b = rd.bomb;
    if (rd.state === 'live' && a.team === this.attackers) {
      if (!b.carrier && U.dist(a.x, a.y, b.x, b.y) < 40) { b.carrier = a; if (a.isPlayer) this.notify(a, 'You have the bomb'); return true; }
      if (b.carrier !== a) return false;
      const site = this.siteAt(a.x, a.y); if (!site) return false;
      if (!rd.planting || rd.planting.actor !== a) rd.planting = { actor: a, t: 0 };
      rd.planting.t += dt; rd.planting.heldAt = this.time; a.actionProgress = rd.planting.t / mode.plantTime;
      if (rd.planting.t >= mode.plantTime) this.plantBomb(a, site);
      return true;
    }
    if (rd.state === 'planted' && a.team !== this.attackers && U.dist(a.x, a.y, b.x, b.y) < 90) {
      if (rd.defusing && rd.defusing.actor !== a && this.time - rd.defusing.heldAt < 0.1) return false; // someone else is already on it
      if (!rd.defusing || rd.defusing.actor !== a) rd.defusing = { actor: a, t: 0 };
      rd.defusing.t += dt; rd.defusing.heldAt = this.time; a.actionProgress = rd.defusing.t / mode.defuseTime;
      if (rd.defusing.t >= mode.defuseTime) { if (a.isPlayer) this.ms.objectives++; this.endRound(1 - this.attackers, (a.isPlayer ? 'You' : a.name) + ' defused the bomb'); }
      return true;
    }
    return false;
  }
  plantBomb(a, site) {
    const rd = this.round, b = rd.bomb;
    b.planted = true; b.site = site; b.carrier = null; b.x = a.x; b.y = a.y; b.fuse = this.mode.fuse; rd.state = 'planted'; rd.planting = null; a.actionProgress = 0;
    if (a.isPlayer) this.ms.objectives++;
    this.killfeed.unshift({ text: (a.isPlayer ? 'You' : a.name) + ' planted the bomb at ' + site.name, time: this.time, hl: true });
    this.flashBanner('BOMB PLANTED - ' + site.name, a.team === 0, 1.5);
    for (const br of this.brains) br.obj = null;
    Sound.zone();
  }
  endRound(winner, reason) {
    const rd = this.round; if (rd.state === 'over') return;
    rd.state = 'over'; rd.breakT = 3.2; rd.planting = null; rd.defusing = null;
    for (const a of this.actors) a.actionProgress = 0;
    this.score[winner]++;
    const mine = winner === 0;
    this.killfeed.unshift({ text: reason, time: this.time, hl: true }); if (this.killfeed.length > 6) this.killfeed.length = 6;
    this.flashBanner((mine ? 'ROUND WON ' : 'ROUND LOST ') + this.score[0] + ' - ' + this.score[1], mine, 3);
    if (mine) Sound.kill(); else Sound.hurt();
  }
  updateBomb(dt) {
    const rd = this.round, mode = this.mode; if (!rd) return;
    if (rd.state === 'over') {
      rd.breakT -= dt;
      if (rd.breakT <= 0) { if (this.score[0] >= mode.rounds || this.score[1] >= mode.rounds) this.endGame(this.score[0] > this.score[1]); else this.startRound(); }
      return;
    }
    const b = rd.bomb;
    const aliveA = this.actors.some((a) => a.alive && a.team === this.attackers), aliveD = this.actors.some((a) => a.alive && a.team !== this.attackers);
    if (rd.planting && this.time - rd.planting.heldAt > 0.1) { rd.planting.actor.actionProgress = 0; rd.planting = null; }
    if (rd.defusing && this.time - rd.defusing.heldAt > 0.1) { rd.defusing.actor.actionProgress = 0; rd.defusing = null; }
    if (rd.state === 'live') {
      rd.timer -= dt;
      if (b.carrier) { if (b.carrier.alive) { b.x = b.carrier.x; b.y = b.carrier.y; } else b.carrier = null; }
      if (!aliveD) return this.endRound(this.attackers, 'Defenders eliminated');
      if (!aliveA) return this.endRound(1 - this.attackers, 'Attackers eliminated');
      if (rd.timer <= 0) return this.endRound(1 - this.attackers, 'Time ran out');
    } else {
      b.fuse -= dt;
      if (b.fuse <= 0) { this.detonate(); return this.endRound(this.attackers, 'The bomb went off at ' + b.site.name); }
      if (!aliveD) return this.endRound(this.attackers, 'Defenders eliminated');
      if (Math.floor(b.fuse * (b.fuse < 8 ? 4 : 1)) !== Math.floor((b.fuse + dt) * (b.fuse < 8 ? 4 : 1))) Sound.tone(1200, 0.05, 0.12, 'square');
    }
  }
  detonate() {
    const b = this.round.bomb;
    this.bombBlast = true;
    this.explode(b.x, b.y, 400, null, null, 360);
    this.bombBlast = false;
    this.renderer.shake = 20;
  }
  // Where a bot should be and what to do there. Attackers escort the carrier to the chosen site; defenders split
  // between sites, then converge on a planted bomb with the nearest bot defusing.
  objectiveFor(b) {
    if (this.war) return War.objectiveFor(this, b);
    if (this.mode.type !== 'bomb' || !this.round || this.round.state === 'over') return null;
    const rd = this.round, bomb = rd.bomb, att = b.team === this.attackers;
    const around = (x, y, r, act) => {
      if (!b.objDest || this.time - b.objDest.t > 5 || U.dist(b.objDest.cx, b.objDest.cy, x, y) > 1) {
        const p = this.spotNear(x, y, r * 0.3, r, b.r) || { x, y };
        b.objDest = { x: p.x, y: p.y, cx: x, cy: y, t: this.time };
      }
      return { x: b.objDest.x, y: b.objDest.y, r: 40, act };
    };
    if (rd.state === 'live') {
      if (att) {
        if (bomb.carrier === b) return { x: this.attackSite.x, y: this.attackSite.y, r: this.attackSite.r * 0.7, act: 'plant' };
        if (!bomb.carrier) return { x: bomb.x, y: bomb.y, r: 38, act: 'pickup' };
        return around(this.attackSite.x, this.attackSite.y, 230, 'hold');
      }
      const site = this.sites[b.id % 2];
      return around(site.x, site.y, 210, 'hold');
    }
    if (att) return around(bomb.x, bomb.y, 260, 'hold');
    let nearest = null, nd = Infinity;
    for (const a of this.actors) { if (!a.alive || a.isPlayer || a.team === this.attackers) continue; const d = U.dist(a.x, a.y, bomb.x, bomb.y); if (d < nd) { nd = d; nearest = a; } }
    if (nearest === b) return { x: bomb.x, y: bomb.y, r: 60, act: 'defuse' };
    return around(bomb.x, bomb.y, 200, 'hold');
  }

  // ---------------------------------------------------------------- vehicles
  // Cars are parked along the roads (or anywhere clear on maps without them), never two in the same spot.
  spawnVehicles(n) {
    const w = this.world, table = Object.values(VEHICLES).map((d) => ({ v: d, w: d.weight }));
    for (let i = 0; i < n; i++) {
      const def = U.weightedPick(table);
      let pos = null, ang = null;
      for (let t = 0; t < 40 && !pos; t++) {
        let c = null, a = null;
        if (w.roads.length && Math.random() < 0.75) {
          const r = U.pick(w.roads), edge = Math.random() < 0.5 ? 30 : 120; // parked on the shoulder
          c = r.horiz ? { x: U.rand(100, w.w - 100), y: r.y + edge } : { x: r.x + edge, y: U.rand(100, w.h - 100) };
          a = (r.horiz ? 0 : Math.PI / 2) + (Math.random() < 0.5 ? Math.PI : 0);
        } else c = w.freeSpot(def.r + 6, 80);
        if (c && w.inBounds(c.x, c.y, def.r + 40) && !w.circleBlocked(c.x, c.y, def.r + 6) && this.vehicles.every((v) => U.dist(v.x, v.y, c.x, c.y) > 260)) { pos = c; ang = a; }
      }
      if (!pos) continue;
      const v = new Vehicle(pos.x, pos.y, def);
      if (ang !== null) v.angle = U.normAngle(ang);
      this.vehicles.push(v);
    }
  }

  // First one in drives; squadmates fill the other seats.
  enterVehicle(a, v) {
    if (!v || !v.alive || !a.alive || a.car || a.zombie || !v.hasSeat(a.team)) return false;
    if (!v.driver) v.driver = a; else v.passengers.push(a);
    v.fresh = false;
    a.car = v; v.carry(a);
    if (a.isPlayer) { this.notify(a, v.driver === a ? 'Driving the ' + v.name : 'Riding in the ' + v.name + ' - you can shoot'); Sound.tone(110, 0.25, 0.12, 'sawtooth', 220); }
    return true;
  }
  // dead: the body stays where the car was (no stepping out).
  leaveVehicle(a, dead) {
    const v = a.car; if (!v) return;
    a.car = null;
    if (v.driver === a) {
      v.driver = v.passengers.shift() || null; // next in line takes the wheel
      if (v.driver && v.driver.isPlayer && v.alive) this.notify(v.driver, 'You take the wheel');
    } else { const i = v.passengers.indexOf(a); if (i >= 0) v.passengers.splice(i, 1); }
    if (dead) return;
    const w = this.world; let pos = null;
    for (const side of U.shuffle([1, -1])) for (const k of [0, 0.9, -0.9]) {
      if (pos) break;
      const ang = v.angle + side * Math.PI / 2 + k, d = v.r + a.r + 8;
      const c = { x: v.x + Math.cos(ang) * d, y: v.y + Math.sin(ang) * d };
      if (w.inBounds(c.x, c.y, a.r + 4) && !w.circleBlocked(c.x, c.y, a.r + 2)) pos = c;
    }
    pos = pos || this.spotNear(v.x, v.y, v.r + a.r + 8, v.r + 130, a.r) || { x: v.x, y: v.y };
    a.x = pos.x; a.y = pos.y; a.vx = 0; a.vy = 0;
  }
  // Out of health: everyone is thrown out and the car goes up, hurting whoever is still standing next to it.
  destroyVehicle(v) {
    if (!v.alive) return;
    v.alive = false; v.wreckT = 16; v.speed = 0; v.vx = 0; v.vy = 0;
    for (const a of [v.driver].concat(v.passengers)) if (a) this.leaveVehicle(a, !a.alive);
    v.driver = null; v.passengers = [];
    this.explode(v.x, v.y, 75, v.lastAttacker && v.lastAttacker.alive ? v.lastAttacker : null, null, 140, true);
  }

  updateVehicles(dt) {
    const vs = this.vehicles; if (!vs.length) return;
    const cam = this.renderer, world = this.world;
    let expired = false;
    for (const v of vs) {
      if (!v.alive) { v.wreckT -= dt; if (v.wreckT <= 0) expired = true; continue; }
      v.update(dt, this);
      if (!v.alive) continue;
      const sp = Math.abs(v.speed);
      if (Math.abs(v.x - cam.camX) < 1200 && Math.abs(v.y - cam.camY) < 800) {
        const hurt = v.hp / v.maxHp;
        if (hurt < 0.4 && Math.random() < 0.5) this.particles.push(new Particle(v.x + U.rand(-8, 8), v.y + U.rand(-8, 8), U.rand(-25, 25), U.rand(-70, -30), U.rand(0.5, 1), hurt < 0.2 && Math.random() < 0.4 ? '#ff8a2a' : 'rgba(40,40,40,0.55)', U.rand(5, 11)));
        if (sp > 200 && Math.random() < 0.5 && !world.onRoad(v.x, v.y)) this.particles.push(new Particle(v.x - v.vx * 0.06 + U.rand(-10, 10), v.y - v.vy * 0.06 + U.rand(-10, 10), U.rand(-20, 20), U.rand(-20, 20), U.rand(0.3, 0.6), 'rgba(150,135,110,0.4)', U.rand(4, 9)));
      }
      // people in the way: enemies get run over at speed, everyone else is shouldered aside
      for (const a of this.actors) {
        if (!a.alive || a.car) continue;
        const dx = a.x - v.x, dy = a.y - v.y, min = v.r + a.r;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy); if (d >= min) continue;
        if (v.driver && a.team !== v.driver.team && sp > 170 && this.time - a.ramAt > 0.6) {
          a.ramAt = this.time; a.lastHitWeapon = 'car';
          const driver = v.driver;
          a.takeDamage(sp * 0.24, driver, this, false);
          for (let i = 0; i < 10; i++) this.particles.push(new Particle(a.x, a.y, v.vx * 0.3 + U.rand(-140, 140), v.vy * 0.3 + U.rand(-140, 140), U.rand(0.25, 0.5), a.shield > 0 ? '#7fc4ff' : '#c62828', U.rand(2, 4.5)));
          if (a.isPlayer) { Sound.hurt(); Sound.boom(0.3); this.renderer.shake = 16; }
          else if (driver === this.player) { Sound.hitmarker(); Sound.boom(0.25); this.renderer.shake = 9; }
          v.speed *= 0.72; v.takeDamage(8, null, this);
        }
        if (d > 0) { a.x = v.x + dx / d * min; a.y = v.y + dy / d * min; } else a.x += min;
        world.resolveCircle(a);
      }
    }
    // car against car
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i]; if (!a.alive) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j]; if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy); if (d >= min || d === 0) continue;
        const p = (min - d) / d, ka = a.def.max ? (b.def.max ? 0.5 : 1) : 0, kb = b.def.max ? (a.def.max ? 0.5 : 1) : 0; // emplacements do not budge
        a.x -= dx * p * ka; a.y -= dy * p * ka; b.x += dx * p * kb; b.y += dy * p * kb;
        world.resolveCircle(a); world.resolveCircle(b);
        const rel = Math.hypot(a.vx - b.vx, a.vy - b.vy);
        if (rel > 120) {
          a.speed *= 0.5; b.speed *= 0.5;
          if (rel > 240) { const dmg = (rel - 240) * 0.07; this.sparks((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffd36b', 8); a.takeDamage(dmg, b.driver, this); b.takeDamage(dmg, a.driver, this); this.carNoise(a, 0.35); }
        }
        if (a.driver) a.carry(a.driver); for (const o of a.passengers) a.carry(o);
        if (b.driver) b.carry(b.driver); for (const o of b.passengers) b.carry(o);
      }
    }
    if (expired) this.vehicles = vs.filter((v) => v.alive || v.wreckT > 0);
  }
  carNoise(v, vol) {
    const d = U.dist(v.x, v.y, this.renderer.camX, this.renderer.camY);
    if (d < 900) Sound.boom(vol * (1 - d / 900));
    if (this.player.car === v) this.renderer.shake = Math.max(this.renderer.shake || 0, 10);
  }
  // Hit a wall, tree or rock hard enough to hurt the car.
  onCrash(v, into) {
    this.sparks(v.x + Math.cos(v.angle) * v.r * Math.sign(v.speed || 1), v.y + Math.sin(v.angle) * v.r * Math.sign(v.speed || 1), '#ffd36b', 8);
    this.carNoise(v, 0.4);
    v.takeDamage((into - 280) * 0.07, null, this);
  }
  // Drove through a crate. Some of them had something inside.
  onSmash(v, o) {
    const x = o.x + o.w / 2, y = o.y + o.h / 2;
    if (U.dist(x, y, this.renderer.camX, this.renderer.camY) < 1100) {
      for (let i = 0; i < 12; i++) this.particles.push(new Particle(x, y, v.vx * 0.4 + U.rand(-200, 200), v.vy * 0.4 + U.rand(-200, 200), U.rand(0.3, 0.7), i % 3 ? o.color : '#3d2c18', U.rand(3, 6)));
      this.carNoise(v, 0.25);
    }
    if (Math.random() < 0.3 && this.mode.type === 'royale') this.dropLoot(x, y, U.pick(['ammo', 'ammo', 'medkit', 'shield']));
  }
  onVehicleHit(v, bullet) {
    this.sparks(bullet.x, bullet.y, '#ffe9a8', 4);
    if (bullet.owner === this.player) Sound.hitmarker();
  }

  controlPlayer(dt) {
    const p = this.player, inp = this.input;
    let mx = 0, my = 0;
    if (inp.down('w') || inp.down('arrowup')) my -= 1;
    if (inp.down('s') || inp.down('arrowdown')) my += 1;
    if (inp.down('a') || inp.down('arrowleft')) mx -= 1;
    if (inp.touch && Math.hypot(inp.stick.dx, inp.stick.dy) > 0.2) { mx += inp.stick.dx; my += inp.stick.dy; } // left thumb stick
    const len = Math.hypot(mx, my), car = p.car;
    if (car) { if (car.driver === p && len > 0) car.steer(mx, my); } // WASD points the car; it turns and accelerates that way
    else if (len > 0) p.move(mx / len, my / len, dt);
    if (inp.touch) this.touchAim(len > 0 ? mx / len : 0, len > 0 ? my / len : 0); else this.aimAssist();
    const m = this.renderer.toWorld(inp.mouse.x, inp.mouse.y);
    p.angle = U.angle(p.x, p.y, m.x, m.y);
    if (car && car.def.gun && car.driver === p) { // tanks and MG nests: the turret follows the cursor, hold to fire
      car.turret = U.lerpAngle(car.turret, p.angle, dt * (car.def.max ? 4.5 : 9));
      if (inp.mouse.down || inp.mouse.clicked) War.fireGun(this, car);
    }
    if (this.war) {
      if (inp.justPressed('g')) War.throwGrenade(this, p, m.x, m.y);
      if (inp.justPressed('t')) War.callArtillery(this, m.x, m.y);
      if (inp.justPressed('c')) War.changeKit(this);
    }

    const w = p.weapon;
    // Hold to fire for every weapon; each weapon's cooldown sets its fire rate.
    if (w && (inp.mouse.down || inp.mouse.clicked)) p.tryShoot(this);
    if (inp.justPressed('r')) p.reload();
    if ((inp.justPressed('f') || inp.justPressed('q')) && p.useMed()) this.ms.medsUsed++;
    for (let i = 1; i <= 3; i++) if (inp.justPressed(String(i))) { if (inp.touch && p.wi === i - 1) p.reload(); else p.switchTo(i - 1); } // touch: tapping the weapon in hand reloads it
    if (inp.wheel && p.weapons.length > 1) p.switchTo((p.wi + Math.sign(inp.wheel) + p.weapons.length) % p.weapons.length);

    // weapon on the ground that needs an explicit swap
    this.nearLoot = null;
    if (p.weapons.length >= 3) {
      let bd = 70;
      for (const l of this.world.loot) {
        if (!l.alive || l.kind !== 'weapon' || p.hasWeapon(l.weapon.key)) continue;
        const d = U.dist(p.x, p.y, l.x, l.y);
        if (d < bd) { bd = d; this.nearLoot = l; }
      }
    }
    // nearest car with a seat for us
    this.nearCar = null;
    if (!car) {
      let bd = Infinity;
      for (const v of this.vehicles) {
        if (!v.hasSeat(p.team)) continue;
        const d = U.dist(p.x, p.y, v.x, v.y) - v.r;
        if (d < 62 && d < bd) { bd = d; this.nearCar = v; }
      }
    }
    if (inp.justPressed('e')) {
      if (car) this.leaveVehicle(p);
      else if (this.nearLoot) p.pickup(this.nearLoot, this, true);
      else if (this.nearCar) this.enterVehicle(p, this.nearCar);
    }
    if (this.mode.type === 'bomb' && inp.down('e')) this.holdAction(p, dt);
    this.holdingE = inp.down('e'); // campaign objectives (plant, grab, light) read this
  }

  // Touch aiming: the right thumb stick gives a direction; the cursor is placed that way from the player, further
  // out the further the stick is pushed (that is where grenades and artillery land). With the stick released you
  // face the way you walk. Aim assist (same toggle as the mouse one) turns the aim onto a visible enemy near the line.
  touchAim(mvx, mvy) {
    const inp = this.input, a = inp.aim, m = inp.mouse, p = this.player, r = this.renderer, s = r.s, W = r.W, H = r.H;
    if (a.id === null && (mvx || mvy)) { a.ax = mvx; a.ay = mvy; }
    if (a.id !== null && !a.moved && Progress.data.prefs.aimAssist) { // thumb held still on FIRE: shoot at the nearest enemy in sight
      let best = null, bd = 800;
      for (const o of this.actors) {
        if (!o.alive || o === p || o.team === p.team) continue;
        const d = U.dist(p.x, p.y, o.x, o.y);
        if (d < bd && d > 1 && this.world.lineOfSight(p.x, p.y, o.x, o.y)) { bd = d; best = o; }
      }
      if (best) { a.ax = (best.x - p.x) / bd; a.ay = (best.y - p.y) / bd; }
    }
    let ang = Math.atan2(a.ay, a.ax), reach = (a.id !== null ? 0.25 + 0.75 * Math.min(1, a.mag) : 0.6) * Math.min(W, H) * 0.42;
    if (Progress.data.prefs.aimAssist) {
      let best = null, bd = 0.3; // radians either side of the stick
      for (const o of this.actors) {
        if (!o.alive || o === p || o.team === p.team) continue;
        const d = U.dist(p.x, p.y, o.x, o.y); if (d > 900 || d < 1) continue;
        const off = Math.abs(U.normAngle(U.angle(p.x, p.y, o.x, o.y) - ang)) + d / 9000; // nearer wins a tie
        if (off < bd && this.world.lineOfSight(p.x, p.y, o.x, o.y)) { bd = off; best = o; }
      }
      if (best) { ang = U.lerpAngle(ang, U.angle(p.x, p.y, best.x, best.y), 0.85); reach = U.dist(p.x, p.y, best.x, best.y) * s; }
    }
    const px = (p.x - r.camX) * s + W / 2, py = (p.y - r.camY) * s + H / 2;
    m.x = U.clamp(px + Math.cos(ang) * reach, 0, W); m.y = U.clamp(py + Math.sin(ang) * reach, 0, H);
    m.down = a.fire;
  }

  // Aim assist: while the cursor is already moving toward a visible enemy, it drifts a little further toward
  // them. It only touches the cursor; bullets fly exactly where the cursor points.
  aimAssist() {
    const inp = this.input, m = inp.mouse;
    if (!Progress.data.prefs.aimAssist) return;
    const mvx = m.mx, mvy = m.my, mlen = Math.hypot(mvx, mvy);
    if (mlen < 0.5) return;
    const r = this.renderer, s = r.s, W = r.W, H = r.H, p = this.player, R = 120;
    let best = null, bd = R;
    for (const a of this.actors) {
      if (!a.alive || a === p || a.team === p.team) continue;
      const sx = (a.x - r.camX) * s + W / 2, sy = (a.y - r.camY) * s + H / 2;
      const d = U.dist(sx, sy, m.x, m.y);
      if (d < bd && U.dist(a.x, a.y, p.x, p.y) < 900 && this.world.lineOfSight(p.x, p.y, a.x, a.y)) { best = { sx, sy, d }; bd = d; }
    }
    if (!best || best.d < 1) return;
    const tx = best.sx - m.x, ty = best.sy - m.y, td = best.d;
    const toward = (mvx * tx + mvy * ty) / (mlen * td); // 1 = moving straight at them, 0 = sideways
    if (toward <= 0.25) return;
    const pull = Math.min(td, mlen * 0.4 * toward * (1 - td / R));
    m.x += (tx / td) * pull; m.y += (ty / td) * pull;
  }

  // ---------------------------------------------------------------- events from entities
  spawnBullet(owner, x, y, angle, w) { this.bullets.push(new Bullet(owner, x, y, angle, w)); }
  onShot(actor, w, mx, my) {
    if (actor.isPlayer) {
      this.shots = (this.shots || 0) + 1; this.renderer.kick(w);
      const reach = w.key === 'sniper' || w.key === 'rocket' ? 1500 : 1000;
      for (const br of this.brains) if (br.hunter && br.bot.alive && br.bot.team !== actor.team && U.dist(br.bot.x, br.bot.y, actor.x, actor.y) < reach) br.heard = { x: actor.x, y: actor.y, t: this.time };
    }
    const ca = Math.cos(actor.angle), sa = Math.sin(actor.angle);
    const big = w.key === 'shotgun' || w.key === 'sniper' || w.key === 'rocket';
    // muzzle flash: bright core plus a few hot sparks
    this.particles.push(new Particle(mx, my, ca * 80, sa * 80, big ? 0.12 : 0.09, '#fff6c0', big ? 22 : 16));
    this.particles.push(new Particle(mx + ca * 6, my + sa * 6, ca * 120, sa * 120, 0.08, '#ffb347', big ? 14 : 10));
    for (let i = 0; i < 3; i++) {
      const a = actor.angle + U.rand(-0.5, 0.5), sp = U.rand(200, 420);
      this.particles.push(new Particle(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, U.rand(0.08, 0.16), '#ffd36b', U.rand(2, 3.5)));
    }
    // shell casing ejected to the side
    const side = actor.angle + Math.PI / 2;
    this.particles.push(new Particle(actor.x + ca * 10, actor.y + sa * 10, Math.cos(side) * U.rand(120, 200) + ca * U.rand(-40, 40), Math.sin(side) * U.rand(120, 200) + sa * U.rand(-40, 40), 0.5, '#e0b84a', 2.5));
    const d = U.dist(actor.x, actor.y, this.renderer.camX, this.renderer.camY);
    Sound.shot(w.key, actor.isPlayer ? 0.9 : U.clamp(1 - d / 1300, 0, 1) * 0.7);
  }
  onHit(victim, bullet, dealt) {
    for (let i = 0; i < 5; i++) this.particles.push(new Particle(victim.x, victim.y, U.rand(-120, 120), U.rand(-120, 120), U.rand(0.2, 0.45), victim.shield > 0 ? '#7fc4ff' : '#c62828', U.rand(2, 4)));
    const o = bullet.owner;
    if (o && o.alive && o.lifesteal > 0 && dealt > 0) o.hp = Math.min(o.maxHp, o.hp + dealt * o.lifesteal);
    if (victim.isPlayer) Sound.hurt();
    else if (o === this.player) Sound.hitmarker();
  }
  // Splash damage around an impact. `direct` already took the projectile hit and gets less.
  // Rockets pass hurtOwner so point-blank shots are risky. Teammates are never hurt.
  // wkey: what to record as the weapon for kills (rocket, shell, grenade, artillery); big unnamed blasts are 'blast'.
  explode(x, y, dmg, owner, direct, r = 75, hurtOwner = false, wkey) {
    const big = r / 75;
    for (let i = 0; i < 14 * big; i++) this.particles.push(new Particle(x, y, U.rand(-260, 260) * big, U.rand(-260, 260) * big, U.rand(0.15, 0.4) * big, i % 2 ? '#ff9800' : '#ffe082', U.rand(3, 7) * big));
    for (let i = 0; i < 8 * big; i++) this.particles.push(new Particle(x, y, U.rand(-80, 80), U.rand(-80, 80), U.rand(0.5, 0.9), 'rgba(60,60,60,0.5)', U.rand(8, 16) * big));
    this.particles.push(new Particle(x, y, 0, 0, 0.12, 'rgba(255,200,80,0.7)', r * 0.8));
    for (const v of this.vehicles) { // blasts are hard on cars; the people inside are shielded until it goes
      if (!v.alive || (owner && v.driver && v.driver.team === owner.team && !(hurtOwner && v === owner.car))) continue;
      const d = U.dist(v.x, v.y, x, y);
      if (d <= r + v.r) v.takeDamage(dmg * 1.5 * (r <= 75 ? v.def.armor || 1 : 1) * (1 - 0.6 * U.clamp((d - v.r) / r, 0, 1)), owner, this); // small blasts do not bother armour
    }
    for (const a of this.actors) {
      if (!a.alive || a.car) continue;
      const self = a === owner;
      if (self && !hurtOwner) continue;
      if (!self && owner && a.team === owner.team) continue;
      const d = U.dist(a.x, a.y, x, y);
      if (d > r + a.r) continue;
      const f = (a === direct ? 0.35 : self ? 0.5 : a.cover > 0 ? 0.5 : 1) * (1 - 0.6 * U.clamp((d - a.r) / r, 0, 1)); // a trench halves a blast
      a.lastHitWeapon = wkey || (r > 75 ? 'blast' : a.lastHitWeapon);
      const dealt = a.takeDamage(dmg * f, owner, this, false);
      if (!self && owner && owner.alive && owner.lifesteal > 0 && dealt > 0) owner.hp = Math.min(owner.maxHp, owner.hp + dealt * owner.lifesteal);
      a.flash = 0.12;
    }
    const dc = U.dist(x, y, this.renderer.camX, this.renderer.camY);
    if (dc < 400) this.renderer.kick({ key: big > 1 ? 'sniper' : 'shotgun' });
    Sound.boom(U.clamp(1 - dc / 1500, 0, 1) * (big > 1 ? 1 : 0.6));
  }
  onSecondWind(actor) {
    for (let i = 0; i < 24; i++) this.particles.push(new Particle(actor.x, actor.y, U.rand(-300, 300), U.rand(-300, 300), U.rand(0.3, 0.7), '#ffd84d', U.rand(2, 5)));
    if (actor.isPlayer) { this.notify(actor, 'SECOND WIND!'); Sound.kill(); }
  }
  sparks(x, y, color, n) {
    for (let i = 0; i < n; i++) this.particles.push(new Particle(x, y, U.rand(-150, 150), U.rand(-150, 150), U.rand(0.1, 0.3), color, U.rand(1.5, 3)));
  }
  onPickup(actor, l) {
    if (actor.isPlayer) { Sound.pickup(); this.ms.pickups++; }
    if ((this.mode.respawn || this.mode.lootRespawn) && l && !l.dropped && !this.war) l.respawnAt = this.time + 25; // arena loot comes back
  }
  notify(actor, text) {
    if (actor !== this.player) return;
    this.notices.unshift({ text, time: this.time });
    if (this.notices.length > 3) this.notices.length = 3;
  }
  dropLoot(x, y, kind, weapon) {
    if (this.mut && this.mut.weapon && kind === 'weapon') { if (weapon && weapon.key !== this.mut.weapon) return; kind = 'ammo'; weapon = null; }
    if (this.mut && this.mut.noShield && kind === 'shield') kind = 'medkit';
    let px = x, py = y;
    for (let t = 0; t < 10; t++) {
      if (this.world.inBounds(px, py, 16) && !this.world.circleBlocked(px, py, 16)) break;
      px = x + U.rand(-60, 60); py = y + U.rand(-60, 60);
    }
    px = U.clamp(px, 30, this.world.w - 30); py = U.clamp(py, 30, this.world.h - 30);
    this.world.addLoot(new Loot(px, py, kind, weapon)).dropped = true; // dropped loot is picked up once; only the map's own loot respawns
  }

  onDeath(victim, killer) {
    const mode = this.mode;
    if (victim.car) this.leaveVehicle(victim, true);
    let k = killer && killer !== victim ? killer : null;
    if (killer === victim) victim.lastAttacker = null; // self-kill: nobody gets credit
    if (!k && victim.lastAttacker && this.time - victim.lastAttackerTime < 10 && victim.lastAttacker.alive) k = victim.lastAttacker;
    if (k) k.kills++;
    victim.deaths++;
    if (this.war) War.onDeath(this, victim);
    if (k === this.player) { const wk = victim.lastHitWeapon || 'pistol'; this.ms.weaponKills[wk] = (this.ms.weaponKills[wk] || 0) + 1; }
    if (this.round && this.round.bomb.carrier === victim) { this.round.bomb.carrier = null; this.round.bomb.x = victim.x; this.round.bomb.y = victim.y; if (victim.isPlayer) this.notify(victim, 'You dropped the bomb'); }

    if (victim.zombie) {
      const t = victim.zombie;
      this.zombiesKilled++; this.zombieDied = true;
      if (t.cloud) { this.hazards.push({ x: victim.x, y: victim.y, r: t.cloud.r, until: this.time + t.cloud.time, src: victim }); for (let i = 0; i < 10; i++) this.particles.push(new Particle(victim.x, victim.y, U.rand(-90, 90), U.rand(-90, 90), U.rand(0.6, 1.2), 'rgba(140,255,60,0.5)', U.rand(6, 12))); }
      // the horde drops supplies now and then; brutes always do
      if (t.id === 'brute' || Math.random() < 0.2) this.dropLoot(victim.x, victim.y, 'ammo');
      if (t.id === 'brute' || Math.random() < 0.05) this.dropLoot(victim.x + U.rand(-30, 30), victim.y + U.rand(-30, 30), Math.random() < 0.5 ? 'medkit' : 'shield');
      for (let i = 0; i < 14; i++) this.particles.push(new Particle(victim.x, victim.y, U.rand(-200, 200), U.rand(-200, 200), U.rand(0.3, 0.7), i % 3 === 0 ? victim.color : '#5a1b1b', U.rand(2, 5)));
      if (t.id === 'brute') {
        this.killfeed.unshift({ text: (k ? (k.isPlayer ? 'You' : k.name) : 'Someone') + ' dropped a Brute', time: this.time, hl: k === this.player });
        if (this.killfeed.length > 6) this.killfeed.length = 6;
      }
      if (k === this.player) Sound.zkill();
      return;
    }

    // Gun Game: the killer moves up the ladder; the top of the ladder wins the match
    if (mode.type === 'gungame' && k) {
      k.gunLevel++;
      if (k.gunLevel >= mode.ladder.length) this.finishArena(k);
      else { k.weapons = [this.gunFor(k)]; k.wi = 0; if (k.isPlayer) this.notify(k, 'Gun up: ' + k.weapon.name); }
    }

    // drop inventory (not in Gun Game, where everyone has a fixed gun)
    if (this.war) War.drops(this, victim);
    else if (mode.type !== 'gungame') {
      for (const w of victim.weapons) if (w.key !== 'pistol' || Math.random() < 0.3) this.dropLoot(victim.x + U.rand(-40, 40), victim.y + U.rand(-40, 40), 'weapon', w);
      for (let i = 0; i < victim.meds; i++) this.dropLoot(victim.x + U.rand(-40, 40), victim.y + U.rand(-40, 40), 'medkit');
      if (victim.shield > 25 || Math.random() < 0.3) this.dropLoot(victim.x + U.rand(-40, 40), victim.y + U.rand(-40, 40), 'shield');
      if (Math.random() < 0.6) this.dropLoot(victim.x + U.rand(-40, 40), victim.y + U.rand(-40, 40), 'ammo');
    }
    victim.weapons = []; victim.meds = 0;
    for (let i = 0; i < 18; i++) this.particles.push(new Particle(victim.x, victim.y, U.rand(-220, 220), U.rand(-220, 220), U.rand(0.3, 0.8), i % 3 === 0 ? victim.color : '#b71c1c', U.rand(2, 5)));

    const who = k ? (k.isPlayer ? 'You' : k.name) : this.bombBlast ? 'The bomb' : this.war ? 'An explosion' : 'The zone';
    const whom = victim.isPlayer ? 'You' : victim.name;
    const text = killer === victim ? whom + ' blew ' + (victim.isPlayer ? 'yourself' : 'themselves') + ' up' : who + (k && k.zombie ? ' got ' : k && victim.lastHitWeapon === 'car' && this.time - victim.ramAt < 0.05 ? ' ran over ' : ' eliminated ') + whom;
    if (!this.war || victim.isPlayer || k === this.player) this.killfeed.unshift({ text, time: this.time, hl: victim.isPlayer || k === this.player || (mode.teamSize > 1 && victim.team === this.player.team) });
    if (this.killfeed.length > 6) this.killfeed.length = 6;
    if (k === this.player) Sound.kill();

    if (mode.respawn) {
      victim.respawnAt = this.war ? War.respawnAt(this, victim) : this.time + 3;
      if (victim.isPlayer && this.state === 'playing') {
        this.ui.banner.textContent = 'ELIMINATED' + (k ? ' by ' + k.name : '');
        this.ui.banner.classList.remove('win'); this.ui.banner.classList.remove('hidden');
      }
    } else if (victim.isPlayer && mode.teamSize > 1 && this.aliveTeams().has(victim.team)) {
      // squad still alive: spectate them (the win/lose check in update() handles the rest)
      this.ui.banner.textContent = mode.type === 'zombies' ? 'DOWN - back next wave' : 'DOWN' + (k ? ' - ' + k.name : '') + ' - your squad fights on';
      this.ui.banner.classList.remove('win'); this.ui.banner.classList.remove('hidden');
    }
  }

  // Deathmatch timer ran out, or someone finished the Gun Game ladder.
  finishArena(winner) {
    if (this.state !== 'playing') return;
    const ranked = this.scoreboard = this.arenaRanking();
    if (winner) { ranked.splice(ranked.indexOf(winner), 1); ranked.unshift(winner); }
    this.placement = ranked.indexOf(this.player) + 1;
    this.endGame(this.placement === 1);
  }

  endGame(win) {
    if (this.state !== 'playing') return;
    this.state = 'over'; this.win = win; this.overTimer = 0; this.panelShown = false;
    if (win) this.placement = 1;
    this.survived = this.time;
    if (this.mode.type === 'zombies') this.scoreboard = this.actors.filter((a) => !a.zombie).sort((a, b) => b.kills - a.kills);
    if (this.mode.type === 'bomb') { this.scoreboard = this.arenaRanking(); this.placement = this.scoreboard.indexOf(this.player) + 1; }
    const opts = this.xpOpts(win);
    opts.mutator = this.mut; opts.L = this.L; // the difficulty actually played
    opts.stats = { mode: this.mode.id, royale: this.mode.type === 'royale', win, kills: this.player.kills, placement: this.placement, waves: this.wavesCleared || 0, powers: Progress.data.powers.length, L: this.L, medsUsed: this.ms.medsUsed, pickups: this.ms.pickups, weaponKills: this.ms.weaponKills, mutator: this.mut.id, objectives: this.ms.objectives };
    this.xpResult = Progress.award(this.player.kills, this.placement, this.survived, win, opts);
    this.adaptNote = this.camp || this.war ? null : Progress.adapt(win); // nor does a battle that 79 bots mostly decide // story missions do not move Adaptive difficulty
    // immediate full-screen banner so a sudden death never looks like a freeze
    const k = this.player.lastAttacker;
    let text;
    if (this.mode.type === 'campaign') { text = win ? 'MISSION COMPLETE' : 'MISSION FAILED'; this.$('radio').classList.add('hidden'); }
    else if (this.war) text = win ? 'VICTORY' : 'DEFEAT';
    else if (this.mode.type === 'zombies') text = win ? 'SURVIVED' : 'OVERRUN';
    else if (this.mode.type === 'bomb' && win) text = 'VICTORY ' + this.score[0] + ' - ' + this.score[1];
    else if (win) text = this.mode.type === 'royale' && this.mode.teamSize > 1 ? 'SQUAD WINS' : 'WINNER';
    else if (this.mode.type === 'bomb') text = 'DEFEAT ' + this.score[0] + ' - ' + this.score[1];
    else if (this.mode.arena) text = 'MATCH OVER';
    else text = (this.mode.teamSize > 1 ? 'SQUAD ELIMINATED' : 'ELIMINATED') + (k && this.mode.teamSize === 1 ? ' by ' + k.name : '');
    this.ui.banner.textContent = text;
    this.ui.banner.classList.toggle('win', !!win);
    this.ui.banner.classList.remove('hidden');
  }
  // Zombies pays per zombie and per wave instead of placement.
  xpOpts(win) {
    if (this.war) return { killXp: 8, noPlacement: true, survLabel: 'Time in battle', extra: [{ label: 'Positions captured: ' + this.war.captures, xp: this.war.captures * 25 }, win ? { label: 'Victory', xp: 200 } : null] };
    if (this.mode.type === 'bomb') return { extra: [{ label: 'Rounds won: ' + this.score[0], xp: this.score[0] * 20 }] };
    if (this.camp) return { noPlacement: true, extra: [win ? { label: 'Mission complete: ' + this.camp.m.name, xp: 80 + this.camp.idx * 20 } : null, win && this.camp.first ? { label: 'First clear', xp: 100 } : null] };
    if (this.mode.type !== 'zombies') return {};
    const extra = [{ label: 'Waves cleared: ' + this.wavesCleared + (this.threat > 1 ? ' (horde x' + this.threat + ')' : ''), xp: Math.round(this.wavesCleared * 10 * this.threat) }];
    if (win) extra.push({ label: 'Survived the night', xp: 150 });
    return { killXp: 3, killLabel: 'zombie', noPlacement: true, extra };
  }
  showOverPanel() {
    this.panelShown = true;
    this.input.unlock();
    this.ui.banner.classList.add('hidden'); this.ui.hud.classList.add('hidden'); // the result panel gets the screen to itself
    const ui = this.ui, mode = this.mode, n = mode.players;
    ui.overTitle.textContent = mode.type === 'zombies' ? (this.win ? 'SURVIVED' : 'OVERRUN') : this.win ? 'WINNER' : '#' + this.placement;
    let sub;
    if (mode.type === 'bomb') { ui.overTitle.textContent = this.win ? 'VICTORY' : 'DEFEAT'; sub = (this.win ? 'Won ' : 'Lost ') + this.score[0] + ' - ' + this.score[1] + ' on ' + this.map.name + '.'; }
    else if (mode.type === 'zombies') sub = this.win ? 'All ' + mode.waves + ' waves cleared. The night is over.' : 'Your squad fell on wave ' + this.wave + '.';
    else if (mode.type === 'dm') sub = this.win ? 'Most kills in the arena.' : 'Time! You finished #' + this.placement + ' of ' + n + '.';
    else if (mode.type === 'gungame') sub = this.win ? 'You finished the ladder first.' : (this.scoreboard && this.scoreboard[0] ? this.scoreboard[0].name + ' finished the ladder first.' : 'Match over.');
    else if (mode.teamSize > 1) sub = this.win ? 'Last squad standing.' : 'Squad eliminated. ' + (this.placement - 1) + (this.placement === 2 ? ' squad' : ' squads') + ' outlasted you.';
    else sub = this.win ? 'Last one standing. Well played.' : 'Eliminated. ' + (this.placement - 1) + ' ' + (this.placement === 2 ? 'player' : 'players') + ' outlasted you.';
    const again = this.$('again-btn'); again.textContent = 'PLAY AGAIN';
    if (this.camp) {
      const c = this.camp, last = c.idx === CAMPAIGN.length - 1;
      ui.overTitle.textContent = this.win ? (last ? 'CAMPAIGN COMPLETE' : 'MISSION COMPLETE') : 'MISSION FAILED';
      sub = this.win ? c.m.debrief : c.fail + '. ' + c.m.name + ' is still waiting.';
      again.textContent = this.win ? (last ? 'PLAY AGAIN' : 'NEXT MISSION') : 'RETRY';
    }
    if (this.war) { ui.overTitle.textContent = this.win ? 'VICTORY' : 'DEFEAT'; sub = this.war.battle.name + '. ' + this.war.result; }
    if (this.mut && this.mut.id !== 'none') sub += ' Mutator: ' + this.mut.name + '.';
    ui.overSub.textContent = sub;
    const places = mode.teamSize > 1 ? Math.ceil(n / mode.teamSize) : n;
    if (mode.type === 'bomb') ui.overStats.innerHTML = '<div><b>' + this.player.kills + '</b>kills</div><div><b>' + this.score[0] + ' - ' + this.score[1] + '</b>rounds</div><div><b>#' + this.placement + '</b>of ' + n + '</div>';
    else if (this.war) ui.overStats.innerHTML = '<div><b>' + this.player.kills + '</b>kills</div><div><b>' + this.war.captures + '</b>positions taken</div><div><b>' + this.war.tickets[0] + ' - ' + this.war.tickets[1] + '</b>' + (this.war.battle.score ? 'seconds held' : 'reinforcements left') + '</div>';
    else if (this.camp) ui.overStats.innerHTML = '<div><b>' + this.player.kills + '</b>kills</div><div><b>' + U.fmtTime(this.survived) + '</b>mission time</div><div><b>' + (this.camp.idx + 1) + '</b>of ' + CAMPAIGN.length + ' missions</div>';
    else if (mode.type === 'zombies') ui.overStats.innerHTML = '<div><b>' + this.player.kills + '</b>zombies</div><div><b>' + U.fmtTime(this.survived) + '</b>survived</div><div><b>' + this.wavesCleared + '</b>of ' + mode.waves + ' waves</div>';
    else ui.overStats.innerHTML = '<div><b>' + this.player.kills + '</b>kills</div><div><b>' + U.fmtTime(this.survived) + '</b>' + (mode.arena ? 'played' : 'survived') + '</div><div><b>#' + this.placement + '</b>of ' + places + '</div>';
    if (this.scoreboard) {
      let sh = '';
      this.scoreboard.slice(0, 6).forEach((a, i) => {
        const score = mode.type === 'gungame' ? 'gun ' + Math.min(a.gunLevel + 1, mode.ladder.length) + '/' + mode.ladder.length + ' · ' + a.kills + ' kills' : a.kills + ' kills';
        sh += '<div' + (a.isPlayer ? ' class="me"' : '') + '><span>' + (i + 1) + '</span><span>' + a.name + '</span><span>' + score + '</span></div>';
      });
      ui.scoreboard.innerHTML = sh; ui.scoreboard.classList.remove('hidden');
    } else ui.scoreboard.classList.add('hidden');
    const r = this.xpResult;
    if (r) {
      let h = '';
      for (const l of r.lines) h += '<div><span>' + l.label + '</span><span>+' + l.xp + ' XP</span></div>';
      h += '<div class="total"><span>XP earned</span><span>+' + r.total + ' XP</span></div>';
      if (r.leveledUp) h += '<div class="levelup">LEVEL UP &middot; ' + r.level + '</div>';
      if (this.adaptNote) h += '<div><span>Adaptive difficulty</span><span>' + (this.win ? 'up to ' : 'down to ') + this.adaptNote + '</span></div>';
      this.$('xp-report').innerHTML = h;
    }
    this.$('profile-over').innerHTML = Progress.summaryHtml();
    ui.overlay.classList.remove('hidden'); ui.over.classList.remove('hidden'); ui.start.classList.add('hidden');
  }

  cameraTarget() {
    const p = this.player;
    if (p.alive || this.mode.respawn) return p;
    if (this.mode.teamSize > 1) for (const a of this.actors) if (a.alive && a.team === p.team) return a;
    if (p.lastAttacker && p.lastAttacker.alive) return p.lastAttacker;
    for (const a of this.actors) if (a.alive) return a;
    return p;
  }

  // ---------------------------------------------------------------- HUD
  updateHud() {
    const ui = this.ui, p = this.player, zone = this.world.zone, mode = this.mode;
    let s1, s2, s3;
    if (mode.type === 'royale') {
      s1 = '<span>' + this.aliveCount() + '</span> alive' + (mode.teamSize > 1 ? ' <span class="team">' + this.aliveTeams().size + '</span> squads' : '');
      s2 = '<span>' + p.kills + '</span> kills';
      if (zone.state === 'wait') s3 = 'Zone shrinks in ' + U.fmtTime(zone.timer);
      else if (zone.state === 'shrink') s3 = 'Zone shrinking!';
      else s3 = 'Zone closed';
    } else if (this.war) {
      const h = War.hud(this); s1 = h.s1; s2 = h.s2; s3 = h.s3;
    } else if (this.camp) {
      s1 = 'Mission <span>' + (this.camp.idx + 1) + '</span> &middot; ' + this.camp.m.name;
      s2 = '<span>' + p.kills + '</span> kills';
      s3 = Campaign.text(this);
    } else if (mode.type === 'bomb') {
      const rd = this.round, att = this.attackers === 0;
      s1 = 'Round <span>' + (rd ? rd.n : 0) + '</span> &middot; <span class="team">' + this.score[0] + '</span> - <span>' + this.score[1] + '</span>';
      s2 = '<span>' + p.kills + '</span> kills';
      if (!rd || rd.state === 'over') s3 = 'Next round...';
      else if (rd.state === 'planted') s3 = 'BOMB PLANTED at ' + rd.bomb.site.name + ' - ' + Math.ceil(rd.bomb.fuse) + 's';
      else s3 = (att ? 'ATTACK: plant at A or B' : 'DEFEND A and B') + ' - ' + U.fmtTime(rd.timer);
    } else if (mode.type === 'zombies') {
      s1 = 'Wave <span>' + this.wave + '</span>/' + mode.waves;
      s2 = '<span>' + p.kills + '</span> zombies';
      s3 = this.waveState === 'break' ? (this.wave === 0 ? 'First wave in ' : 'Next wave in ') + Math.ceil(this.waveTimer) + 's' : (this.zombiesAlive() + this.toSpawn) + ' zombies left';
    } else {
      const lead = this.arenaRanking()[0];
      if (mode.type === 'dm') {
        s1 = '<span>' + U.fmtTime(this.timeLeft) + '</span> left';
        s2 = '<span>' + p.kills + '</span> kills';
        s3 = lead ? 'Leader: ' + (lead.isPlayer ? 'You' : lead.name) + ' (' + lead.kills + ')' : '';
      } else {
        const n = mode.ladder.length;
        s1 = 'Gun <span>' + Math.min(p.gunLevel + 1, n) + '</span>/' + n + (p.weapon ? ' ' + p.weapon.name : '');
        s2 = '<span>' + p.kills + '</span> kills';
        s3 = lead ? 'Leader: ' + (lead.isPlayer ? 'You' : lead.name) + ' gun ' + Math.min(lead.gunLevel + 1, n) + '/' + n : '';
      }
    }
    if (s1 !== this.lastS1) { ui.stat1.innerHTML = s1; this.lastS1 = s1; }
    if (s2 !== this.lastS2) { ui.stat2.innerHTML = s2; this.lastS2 = s2; }
    if (s3 !== this.lastS3) { ui.zoneStatus.textContent = s3; this.lastS3 = s3; }
    if (this.war) { const h = War.barHtml(this); if (h !== this.lastWarHtml) { ui.warbar.innerHTML = h; this.lastWarHtml = h; } }
    ui.warbar.classList.toggle('hidden', !this.war);
    if (this.time > 10 && !this.powersFaded) { this.powersFaded = true; ui.powers.classList.add('faded'); } // loadout chips step aside once the match is under way
    if (this.time <= 10 && this.powersFaded) { this.powersFaded = false; ui.powers.classList.remove('faded'); }
    const outside = p.alive && !zone.contains(p.x, p.y), poisoned = p.alive && p.poison > 0;
    ui.zoneWarn.classList.toggle('hidden', !(outside || poisoned));
    ui.zoneWarn.classList.toggle('poison', !outside && poisoned);
    const warnText = outside ? 'OUTSIDE THE ZONE' : 'POISONED';
    if (ui.zoneWarn.textContent !== warnText) ui.zoneWarn.textContent = warnText;

    ui.hpFill.style.width = (p.hp / p.maxHp * 100) + '%'; ui.hpText.textContent = Math.ceil(p.hp);
    ui.shFill.style.width = (p.shield / p.maxShield * 100) + '%'; ui.shText.textContent = Math.ceil(p.shield);
    ui.meds.textContent = 'x' + p.meds;

    let html = '';
    for (let i = 0; i < 3; i++) {
      const w = p.weapons[i];
      if (!w) { html += '<div class="slot empty"><span class="num">' + (i + 1) + '</span><span class="wname">&mdash;</span><span class="ammo">empty</span></div>'; continue; }
      const ammo = w.reloading ? 'Reloading...' : w.ammo + ' / ' + (w.infinite ? '∞' : w.reserve);
      const low = !w.reloading && w.ammo + w.reserve <= w.mag * 0.5 ? ' low' : '';
      html += '<div class="slot' + (i === p.wi ? ' active' : '') + '"><span class="num">' + (i + 1) + '</span><span class="wname" style="color:' + w.color + '">' + (w.short || w.name) + '</span><span class="ammo' + low + '">' + ammo + '</span></div>';
    }
    if (html !== this.lastWeaponsHtml) { ui.weapons.innerHTML = html; this.lastWeaponsHtml = html; }

    let prompt = '';
    if (p.alive && this.round && this.round.state !== 'over') {
      const rd = this.round, b = rd.bomb;
      if (rd.state === 'live' && b.carrier === p) prompt = this.siteAt(p.x, p.y) ? 'Hold [E] to plant' : 'You carry the bomb - get to A or B';
      else if (rd.state === 'live' && !b.carrier && this.attackers === 0 && U.dist(p.x, p.y, b.x, b.y) < 160) prompt = 'Pick up the bomb';
      else if (rd.state === 'planted' && this.attackers !== 0 && U.dist(p.x, p.y, b.x, b.y) < 90) prompt = 'Hold [E] to defuse';
    }
    if (p.alive && !prompt && this.camp) prompt = Campaign.prompt(this);
    if (p.alive && !prompt) {
      if (p.car) prompt = (p.car.def.gun ? (p.car.def.max ? 'Commanding the ' : 'Manning the ') : p.car.driver === p ? 'Driving the ' : 'Riding in the ') + p.car.name + ' \u00b7 ' + Math.ceil(p.car.hp / p.car.maxHp * 100) + '% \u00b7 [E] get out';
      else if (this.nearCar && !this.nearLoot) prompt = '[E] ' + (this.nearCar.def.gun ? (this.nearCar.def.max ? 'Take the ' : 'Man the ') : this.nearCar.driver ? 'Ride in the ' : 'Drive the ') + this.nearCar.name;
      else if (this.nearLoot) prompt = '[E] Swap ' + (p.weapon ? p.weapon.name : '') + ' for ' + this.nearLoot.weapon.name;
      else if (p.healing > 0) prompt = 'Healing...';
      else if (p.weapon && p.weapon.ammo === 0 && p.weapon.reserve === 0) prompt = 'Out of ammo! Switch weapon.';
    }
    if (this.input.touch && ui.touch) { // on-screen buttons: USE lights up when there is something to use, War adds its three
      ui.touch.classList.toggle('use', prompt.includes('[E]')); ui.touch.classList.toggle('war', !!this.war);
      const mt = 'x' + p.meds; if (ui.tMed.textContent !== mt) ui.tMed.textContent = mt;
      prompt = prompt.replace('[E]', '[USE]');
    }
    if (ui.prompt.textContent !== prompt) ui.prompt.textContent = prompt;

    let nh = '';
    for (const n of this.notices) nh += '<div style="opacity:' + U.clamp(1 - (this.time - n.time) / 2.2, 0, 1) + '">' + n.text + '</div>';
    if (nh !== this.lastNoticesHtml) { ui.notices.innerHTML = nh; this.lastNoticesHtml = nh; }
    let kh = '';
    for (const k of this.killfeed) kh += '<div' + (k.hl ? ' class="hl"' : '') + '>' + k.text + '</div>';
    if (kh !== this.lastKillfeedHtml) { ui.killfeed.innerHTML = kh; this.lastKillfeedHtml = kh; }

    if (!p.alive) {
      ui.spectate.classList.remove('hidden');
      let st;
      if (mode.type === 'bomb' && this.state === 'playing') { const f = this.cameraTarget(); st = 'Dead until next round' + (f !== p ? ' - spectating ' + f.name : ''); }
      else if (mode.respawn && this.state === 'playing') st = 'Respawning in ' + Math.max(0, Math.ceil(p.respawnAt - this.time)) + 's';
      else { const f = this.cameraTarget(); st = f === p ? 'Match over' : (mode.type === 'zombies' && this.state === 'playing' ? 'Down - back next wave - ' : '') + 'Spectating ' + f.name; }
      if (ui.spectate.textContent !== st) ui.spectate.textContent = st;
    }
  }
}

// Surface runtime errors on screen so problems are visible without devtools.
window.addEventListener('error', (e) => {
  let box = document.getElementById('errbox');
  if (!box) {
    box = document.createElement('div'); box.id = 'errbox';
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:60vw;background:#b00020;color:#fff;font:12px monospace;padding:8px;border-radius:6px;z-index:99;white-space:pre-wrap;';
    document.body.appendChild(box);
  }
  box.textContent = 'Error: ' + e.message + '\n' + (e.filename || '').split('/').pop() + ':' + e.lineno;
});

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.game = game;
  // Test hooks: index.html?autostart&autofire&debug&mode=duos&map=snow (used by headless screenshot checks)
  const q = new URLSearchParams(location.search);
  if (q.has('xp')) { Progress.data.xp += parseInt(q.get('xp'), 10) || 0; game.$('profile-start').innerHTML = Progress.summaryHtml(); }
  if (q.has('reset')) { if (typeof confirm !== 'function' || confirm('Reset ALL progress?')) Progress.reset(); }
  if (q.get('own') === 'all') { for (const it of SHOP_ITEMS) if (!Progress.owns(it.id)) Progress.data.owned.push(it.id); Progress.data.powers = SHOP_ITEMS.filter((i) => i.type === 'power').slice(0, Progress.slots()).map((i) => i.id); }
  if (q.has('battle')) Progress.data.prefs.battle = q.get('battle');
  if (q.has('fwd') || q.has('mid') || q.has('sky')) War.force = { fwd: q.get('fwd'), mid: q.get('mid'), sky: q.get('sky') }; // pin War's terrain: ?fwd=bunkers&mid=wood
  if (q.has('mut') && MUTATORS[q.get('mut')]) Progress.data.prefs.mutator = q.get('mut');
  if (q.has('start') && Progress.item('start_' + q.get('start'))) Progress.data.equipped.start = 'start_' + q.get('start');
  if (q.has('mode') && MODES[q.get('mode')]) Progress.data.prefs.mode = q.get('mode');
  if (q.has('mission')) { const n = U.clamp((parseInt(q.get('mission'), 10) || 1) - 1, 0, CAMPAIGN.length - 1); Progress.data.prefs.mode = 'campaign'; Progress.data.prefs.mission = n; Progress.data.campaign.unlocked = Math.max(Progress.data.campaign.unlocked, n); }
  if (q.has('map') && (MAPS[q.get('map')] || q.get('map') === 'random')) Progress.data.prefs.map = q.get('map');
  if (q.has('diff') && DIFFICULTIES[q.get('diff')]) Progress.data.prefs.difficulty = q.get('diff');
  if (q.has('skin') && Progress.item('skin_' + q.get('skin'))) Progress.data.equipped.skin = 'skin_' + q.get('skin');
  game.refreshProfiles(); game.buildPickers();
  if (q.has('touch')) game.input.setTouch(true); // ?touch shows the phone controls and layout without a touchscreen
  if (q.has('autostart')) {
    game.start();
    game.input.mouse.x = window.innerWidth * 0.75; game.input.mouse.y = window.innerHeight * 0.4;
    if (q.has('autofire')) game.input.mouse.down = true;
    // ?goto drops the player beside the current campaign objective
    if (q.has('goto') && game.camp) { const m = Campaign.marks(game)[0]; if (m) { game.player.x = m.x - 150; game.player.y = m.y + 60; } }
    // ?event=air|supply|fog or ?event=smoke|armour|barrage|infantry (War): make it happen now, with the player beside it
    if (q.has('event') && game.war) {
      const k = q.get('event'), w = game.war, p = game.player;
      if (['air', 'supply', 'fog'].includes(k)) War.event(game, k); else War.startPush(game, k);
      const at = k === 'air' ? { x: w.planes[0].x - 160, y: (w.planes[0].y0 + w.planes[0].y1) / 2 } : k === 'supply' ? { x: w.drop.x - 120, y: w.drop.y + 60 } : k === 'fog' ? p : { x: w.points[War.attackIdx(w, 0)].x - w.points[War.attackIdx(w, 0)].hx - 260, y: w.points[War.attackIdx(w, 0)].y };
      p.x = at.x; p.y = at.y; p.invuln = 99;
    }
    // ?tank (War) starts the player in their tank, rolling east
    if (q.has('tank') && game.war) { War.updateVehicles(game, 0); const v = game.war.reserved; if (v) { game.enterVehicle(game.player, v); game.input.keys.add('d'); } }
    // ?car puts the player behind the wheel of a car at the spawn point and holds D so it is moving
    if (q.has('car')) { const p = game.player, v = new Vehicle(p.x, p.y, VEHICLES[q.get('car')] || VEHICLES.sedan); game.vehicles.push(v); game.enterVehicle(p, v); game.input.keys.add('d'); }
    // ?warmup=N runs N frames immediately so a screenshot shows the game mid-action
    const n = parseInt(q.get('warmup') || '0', 10);
    for (let i = 0; i < n; i++) { game.dt = 1 / 60; game.update(1 / 60); game.input.endFrame(); }
  }
  if (q.has('brief')) game.showBriefing(); // ?mission=2&brief opens that mission's briefing
  if (q.has('pause') && game.state === 'playing') game.pause();
  if (q.has('shop')) { game.shopOnly = q.get('shop') || null; game.openShop(game.ui.start); }
  if (q.has('debug')) {
    const box = document.createElement('div'); box.id = 'debugbox';
    box.style.cssText = 'position:fixed;left:8px;top:140px;background:rgba(0,0,0,0.7);color:#0f0;font:13px monospace;padding:8px;border-radius:6px;z-index:99;white-space:pre;';
    document.body.appendChild(box);
    game.debugBox = box;
  }
});
