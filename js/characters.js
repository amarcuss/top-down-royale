'use strict';
// Characters. You play as one of six fighters, each with a signature weapon, their own health and speed, and one
// ability on a cooldown. A character is levelled up with XP (1 to 10): each level adds 5% health and 4% damage and
// takes 3% off the ability's cooldown; at level 5 the ability itself gets stronger, and at level 10 the character
// starts every life with 50 shield. Characters replace the old shop upgrades (starting weapons,
// perks and power-ups); skins are still cosmetic and go on top of whichever character is picked.
//
// Each character also has a special attack. It charges as the character deals damage (and very slowly on its own) and
// is fired by double-tapping the shoot side of the screen (right-click or X with a mouse and keyboard).
//
// This file is loaded by the browser and by the game server, so abilities behave the same online. Online everyone
// plays at level 1.
const CHARACTERS = [
  { id: 'dart', name: 'Dart', role: 'Scout', weapon: 'smg', hp: 90, speed: 1.08, cost: 0, desc: 'Fast and light. In, out, gone.',
    special: { id: 'whirl', name: 'Whirlwind', need: 220, desc: 'Eighteen rounds in every direction at once.' },
    ability: { id: 'dash', name: 'Dash', cd: 6, desc: 'A burst of speed. Nothing can hit you mid-dash.', up: 'Dash goes half as far again.' },
    look: { color: '#39c6ff', accent: '#10202c', trim: '#ff4b2b', hat: 'c_goggles', back: 'scarf' } },
  { id: 'brick', name: 'Brick', role: 'Heavy', weapon: 'shotgun', hp: 130, speed: 0.92, cost: 0, desc: 'Slow, close, and very hard to move.',
    special: { id: 'slam', name: 'Ground Slam', need: 260, desc: 'A shockwave that flattens everyone close to you.' },
    ability: { id: 'barrier', name: 'Barrier', cd: 14, desc: '+50 shield, and hits hurt 40% less for 3 seconds.', up: '+75 shield, and the protection lasts 4.5 seconds.' },
    look: { color: '#c9713a', accent: '#5b6472', trim: '#ffb81c', hat: 'c_visor', back: 'plates' } },
  { id: 'patch', name: 'Patch', role: 'Medic', weapon: 'pistol', hp: 100, speed: 1, meds: 2, cost: 0, desc: 'Keeps the squad standing. Starts with two medkits.',
    special: { id: 'dose', name: 'Triple Dose', need: 220, desc: 'A fan of seven shots, and 25 health back for you.' },
    ability: { id: 'mend', name: 'Mend', cd: 16, desc: 'Heals you and squadmates close by for 40.', up: 'Heals for 60.' },
    look: { color: '#f4f6fa', accent: '#e53935', trim: '#7fd6c8', hat: 'c_cross', back: 'pack' } },
  { id: 'flint', name: 'Flint', role: 'Ranger', weapon: 'rifle', hp: 100, speed: 1, cost: 400, desc: 'A steady rifle at any range.',
    special: { id: 'rocket', name: 'Rocket', need: 280, desc: 'One rocket, straight where you are aiming.' },
    ability: { id: 'blast', name: 'Blast Rounds', cd: 14, desc: 'For 4 seconds your bullets explode where they land.', up: 'Lasts 6 seconds.' },
    look: { color: '#7a9a46', accent: '#6b5233', trim: '#f2b632', hat: 'c_hat', back: 'roll' } },
  { id: 'wisp', name: 'Wisp', role: 'Sniper', weapon: 'sniper', hp: 85, speed: 1.03, cost: 600, desc: 'One shot from far away, then somewhere else.',
    special: { id: 'deadeye', name: 'Deadeye', need: 260, desc: 'One shot for triple damage that goes through everyone in line.' },
    ability: { id: 'vanish', name: 'Vanish', cd: 15, desc: 'Unseen for 3 seconds, and quicker on your feet.', up: 'Lasts 4.5 seconds.' },
    look: { color: '#4a3d78', accent: '#c9b8ff', trim: '#1b1530', hat: 'c_hood', back: 'cape' } },
  { id: 'rivet', name: 'Rivet', role: 'Gunner', weapon: 'lmg', hp: 115, speed: 0.94, cost: 800, desc: 'A machine gun and the patience to use it.',
    special: { id: 'storm', name: 'Lead Storm', need: 300, desc: 'Twenty-four rounds in just over a second, no ammunition used.' },
    ability: { id: 'frenzy', name: 'Frenzy', cd: 16, desc: 'A full magazine at once, then 5 seconds of faster fire.', up: 'Lasts 7 seconds.' },
    look: { color: '#9aa0ab', accent: '#ff3d3d', trim: '#d9a441', hat: 'c_mohawk', back: 'drum' } },
];

const Chars = {
  MAX: 10,
  get(id) { return CHARACTERS.find((c) => c.id === id) || null; },
  // The save: which characters are unlocked and their levels, and the one in use. The first time this runs on an old
  // save, the XP spent on shop upgrades (which no longer exist) is handed back.
  state() {
    const d = Progress.data;
    if (!d.chars || typeof d.chars !== 'object') {
      d.chars = {}; for (const c of CHARACTERS) if (!c.cost) d.chars[c.id] = 1;
      let back = 0;
      d.owned = (d.owned || []).filter((id) => { const it = Progress.item(id); if (it && (it.type === 'start' || it.type === 'perk' || it.type === 'power')) { back += it.cost || 0; return false; } return true; });
      d.xp += back; d.powers = []; if (d.equipped) d.equipped.start = null;
      d.charsRefund = back;
    }
    if (!this.get(d.char) || !d.chars[d.char]) d.char = CHARACTERS[0].id;
    return d;
  },
  level(id) { return this.state().chars[id] || 0; },
  owned(id) { return this.level(id) > 0; },
  current() { return this.get(this.state().char); },
  upCost(lvl) { return lvl * 100; }, // XP to go from lvl to lvl + 1
  stats(def, lvl) { const k = Math.max(0, (lvl || 1) - 1); return { hp: Math.round(def.hp * (1 + 0.05 * k)), dmg: +(1 + 0.04 * k).toFixed(2), speed: def.speed, cd: +(def.ability.cd * (1 - 0.03 * k)).toFixed(1), boost: lvl >= 5, shield: lvl >= 10 ? 50 : 0 }; },
  select(id) { const d = this.state(); if (!d.chars[id]) return false; d.char = id; Progress.save(); return true; },
  unlock(id) { const d = this.state(), c = this.get(id); if (!c || d.chars[id] || d.xp < c.cost) return false; d.xp -= c.cost; d.chars[id] = 1; d.char = id; Progress.save(); return true; },
  upgrade(id) {
    const d = this.state(), lvl = d.chars[id]; if (!lvl || lvl >= this.MAX) return false;
    const cost = this.upCost(lvl); if (d.xp < cost) return false;
    d.xp -= cost; d.chars[id] = lvl + 1; Progress.save(); return true;
  },
  // How much harder the lobby plays for this character and level (bots keep pace: see Game.toughenBot).
  threat() { const c = this.current(), l = this.level(c.id); return Math.round((1 + ({ rifle: 0.15, sniper: 0.15, lmg: 0.2, smg: 0.08, shotgun: 0.08 }[c.weapon] || 0) + (l - 1) * 0.03) * 10) / 10; },
  // Make an actor this character: health, speed, weapon, medkits, and a fresh ability.
  // keepWeapons: the mode decides the guns (Gun Game), so only the body changes.
  apply(a, def, lvl, keepWeapons) {
    const s = this.stats(def, lvl);
    a.char = def; a.charLvl = lvl || 1; a.abMax = s.cd; a.abCd = 0; a.spCharge = 0; a.stormT = 0;
    a.maxHp = s.hp; a.hp = s.hp; a.speed = 235 * s.speed; a.baseSpeed = a.speed; a.meds = def.meds || 0;
    a.dmgMult = (a.charDmg ? a.dmgMult / a.charDmg : a.dmgMult || 1) * s.dmg; a.charDmg = s.dmg; // level damage, applied once however often the character is re-applied
    a.abBoost = s.boost; a.spawnShield = s.shield; a.shield = Math.max(a.shield || 0, s.shield);
    a.dashT = 0; a.guardT = 0; a.blastT = 0; a.hideT = 0; a.frenzyT = 0;
    if (!keepWeapons) { const w = makeWeapon(def.weapon); a.applyWeaponMods(w); w.ammo = w.mag; a.weapons = [w]; a.wi = 0; }
  },
  // Back to an ordinary fighter (online: the player left and a bot takes the body back).
  clear(a) { if (!a.char) return; this.endEffects(a); a.char = null; a.abCd = 0; a.maxHp = 100; a.hp = Math.min(a.hp, 100); if (a.charDmg) { a.dmgMult /= a.charDmg; a.charDmg = 0; } a.abBoost = false; a.spawnShield = 0; },
  // Stop whatever ability is running and put back what it changed (on death, respawn, or leaving).
  endEffects(a) {
    if (a.blastT > 0) a.explosive = !!a.preBlast;
    if (a.hideT > 0) a.speed = a.preHide;
    if (a.frenzyT > 0) a.rateMult = a.preRate;
    a.dashT = a.guardT = a.blastT = a.hideT = a.frenzyT = 0; a.stormT = 0;
  },
};

if (typeof Actor !== 'undefined') {
  // The ability button. True if it went off.
  Actor.prototype.useAbility = function (game) {
    const c = this.char;
    if (!c || !this.alive || this.abCd > 0 || this.car) return false;
    const puff = (color, n) => { if (typeof Particle !== 'undefined' && game.particles) for (let i = 0; i < n; i++) game.particles.push(new Particle(this.x, this.y, U.rand(-170, 170), U.rand(-170, 170), U.rand(0.25, 0.6), color, U.rand(2, 4))); };
    switch (c.ability.id) {
      case 'dash': {
        const v = Math.hypot(this.vx, this.vy);
        this.dashX = v > 20 ? this.vx / v : Math.cos(this.angle); this.dashY = v > 20 ? this.vy / v : Math.sin(this.angle);
        this.dashT = this.abBoost ? 0.33 : 0.22; this.invuln = Math.max(this.invuln, this.dashT + 0.08); puff('#9fe4ff', 10); break;
      }
      case 'barrier': this.shield = Math.min(this.maxShield, this.shield + (this.abBoost ? 75 : 50)); this.guardT = this.abBoost ? 4.5 : 3; puff('#7fb8ff', 12); break;
      case 'mend':
        for (const o of game.actors) if (o.alive && o.team === this.team && !o.zombie && (o === this || U.dist(o.x, o.y, this.x, this.y) < 240)) { o.hp = Math.min(o.maxHp, o.hp + (this.abBoost ? 60 : 40)); o.poison = 0; o.mendT = 0.6; }
        puff('#8cf07f', 16); break;
      case 'blast': this.preBlast = this.explosive; this.blastT = this.blastMax = this.abBoost ? 6 : 4; this.explosive = true; puff('#ff9a3c', 10); break;
      case 'vanish': this.preHide = this.speed; this.hideT = this.abBoost ? 4.5 : 3; this.speed *= 1.3; puff('#c9b8ff', 14); break;
      case 'frenzy': {
        const w = this.weapon; if (w) { w.reloading = false; w.ammo = w.mag; w.cooldown = 0; }
        this.preRate = this.rateMult; this.frenzyT = this.frenzyMax = this.abBoost ? 7 : 5; this.rateMult *= 0.6; puff('#ff5252', 10); break;
      }
      default: return false;
    }
    this.abCd = this.abMax || c.ability.cd;
    if (this.isPlayer && typeof Sound !== 'undefined' && Sound.tone) Sound.tone(420, 0.12, 0.06, 'sawtooth', 880);
    if (game.onAbility) game.onAbility(this);
    return true;
  };
  // The special attack: fires only when fully charged. True if it went off.
  Actor.prototype.useSpecial = function (game) {
    const c = this.char;
    if (!c || !c.special || !this.alive || this.car || (this.spCharge || 0) < 1 || this.healing > 0) return false;
    const muzzle = this.r + 16, mx = this.x + Math.cos(this.angle) * muzzle, my = this.y + Math.sin(this.angle) * muzzle;
    const gun = (key, over) => Object.assign(makeWeapon(key), over || {});
    switch (c.special.id) {
      case 'whirl': { const w = gun('smg'); for (let i = 0; i < 18; i++) { const an = this.angle + (i / 18) * Math.PI * 2; game.spawnBullet(this, this.x + Math.cos(an) * muzzle, this.y + Math.sin(an) * muzzle, an, w); } game.onShot(this, w, mx, my); break; }
      case 'slam': this.invuln = Math.max(this.invuln, 0.25); game.explode(this.x, this.y, 55 * (this.dmgMult || 1), this, null, 175); break;
      case 'dose': { const w = gun('pistol'); for (let i = -3; i <= 3; i++) game.spawnBullet(this, mx, my, this.angle + i * 0.09, w); this.hp = Math.min(this.maxHp, this.hp + 25); this.mendT = 0.6; game.onShot(this, w, mx, my); break; }
      case 'rocket': { const w = gun('rocket'); game.spawnBullet(this, mx, my, this.angle, w); game.onShot(this, w, mx, my); break; }
      case 'deadeye': { const w = gun('sniper', { dmg: makeWeapon('sniper').dmg * 3 }), keep = this.pierce; this.pierce = 4; game.spawnBullet(this, mx, my, this.angle, w); this.pierce = keep; game.onShot(this, w, mx, my); break; }
      case 'storm': this.stormT = 1.2; this.stormShot = 0; break;
      default: return false;
    }
    this.spCharge = 0;
    if (this.isPlayer && typeof Sound !== 'undefined' && Sound.tone) Sound.tone(220, 0.2, 0.08, 'sawtooth', 990);
    if (game.onAbility) game.onAbility(this, true);
    return true;
  };
  // Cooldown and the timed effects, every frame.
  Actor.prototype.tickAbility = function (dt, game) {
    if (this.abCd > 0) this.abCd = Math.max(0, this.abCd - dt);
    if (this.alive && this.spCharge < 1) this.spCharge = Math.min(1, (this.spCharge || 0) + dt / 90); // a trickle, so it always comes round
    if (this.stormT > 0) { // Lead Storm: a stream of rounds while it lasts
      this.stormT -= dt; this.stormShot = Math.max(-0.3, (this.stormShot || 0) - dt);
      for (let n = 0; n < 6 && this.stormShot <= 0 && this.alive; n++) { this.stormShot += 0.05; const w = makeWeapon('lmg'), an = this.angle + (Math.random() - 0.5) * 0.16, m = this.r + 16; game.spawnBullet(this, this.x + Math.cos(this.angle) * m, this.y + Math.sin(this.angle) * m, an, w); if (Math.random() < 0.34) game.onShot(this, w, this.x + Math.cos(this.angle) * m, this.y + Math.sin(this.angle) * m); }
    }
    if (this.mendT > 0) this.mendT -= dt;
    if (this.dashT > 0) {
      this.dashT -= dt;
      if (this.alive && !this.car) { this.x += this.dashX * 900 * dt; this.y += this.dashY * 900 * dt; if (game.world && game.world.resolveCircle) game.world.resolveCircle(this); }
    }
    if (this.guardT > 0) this.guardT -= dt;
    if (this.blastT > 0) { this.blastT -= dt; if (this.blastT <= 0) this.explosive = !!this.preBlast; }
    if (this.hideT > 0) { this.hideT -= dt; if (this.hideT <= 0) this.speed = this.preHide; }
    if (this.frenzyT > 0) { this.frenzyT -= dt; if (this.frenzyT <= 0) this.rateMult = this.preRate; }
  };
  const update = Actor.prototype.update, takeDamage = Actor.prototype.takeDamage;
  Actor.prototype.update = function (dt, game) { update.call(this, dt, game); if (this.char || this.mendT > 0) this.tickAbility(dt, game); };
  Actor.prototype.takeDamage = function (amount, source, game, fromZone, poison) {
    if (this.guardT > 0 && !fromZone && !poison) amount *= 0.6; // Barrier
    if (this.hideT > 0 && amount > 0 && !fromZone && !poison) { this.hideT = 0; this.speed = this.preHide; } // being hit breaks Vanish
    const dealt = takeDamage.call(this, amount, source, game, fromZone, poison);
    // dealing damage charges the attacker's special (not while Lead Storm is pouring out)
    if (dealt > 0 && source && source.char && source.char.special && source !== this && source.team !== this.team && !(source.stormT > 0)) source.spCharge = Math.min(1, (source.spCharge || 0) + dealt / source.char.special.need);
    return dealt;
  };
}
