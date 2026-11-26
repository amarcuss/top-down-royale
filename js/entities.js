'use strict';
const BOT_NAMES = ['Viper', 'Raptor', 'Ghost', 'Nova', 'Blaze', 'Shadow', 'Falcon', 'Rogue', 'Titan', 'Echo', 'Frost', 'Hawk', 'Jinx', 'Krait', 'Lynx', 'Mako', 'Onyx', 'Pyro', 'Quill', 'Rex', 'Sable', 'Tusk', 'Vex', 'Wraith', 'Zephyr', 'Bolt', 'Cinder', 'Drift', 'Nyx', 'Koda', 'Zane', 'Ash', 'Rune', 'Sly', 'Fang', 'Dusk'];

class Actor {
  constructor(x, y, name, color, isPlayer) {
    this.id = Actor.nextId++;
    this.team = this.id;          // solo by default; team modes assign shared ids
    this.gunLevel = 0;            // Gun Game ladder position
    this.respawnAt = 0; this.deaths = 0;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.r = 18;
    this.name = name; this.color = color; this.isPlayer = !!isPlayer;
    this.hp = 100; this.maxHp = 100; this.shield = 0; this.maxShield = 100;
    this.speed = isPlayer ? 235 : U.rand(210, 232);
    this.angle = U.rand(-Math.PI, Math.PI);
    this.weapons = [makeWeapon('pistol')]; this.wi = 0;
    this.meds = 0; this.healing = 0; this.healRate = 0;
    this.alive = true; this.kills = 0; this.deathTime = 0;
    this.flash = 0; this.lastDamaged = -99; this.lastAttacker = null; this.lastAttackerTime = -99;
    this.seed = Math.random() * 100;
    // perks / power-ups (player only; bots keep the defaults)
    this.reloadMult = 1; this.ammoMult = 1; this.magMult = 1; this.rateMult = 1;
    this.homing = false; this.explosive = false; this.pierce = 0;
    this.lifesteal = 0; this.secondWind = 0; this.zoneResist = 1; this.invuln = 0;
    this.dmgMult = 1; this.spreadMult = 1; this.shotCost = 0; // power-up downsides
    this.skin = null;             // cosmetic skin def (player only)
    this.lastHitWeapon = null;    // weapon key of the last hit taken (for challenge tracking)
    this.actionProgress = 0;      // 0..1 while planting or defusing (Bomb mode)
    this.poison = 0; this.poisonDps = 0; this.poisonSrc = null; // Toxic zombie bite: seconds left, damage per second
    this.zombie = null; this.attackCd = 0; this.lunge = 0; // Zombies mode: zombie type def and melee state
    this.cover = 0; this.slow = 1; this.grenades = 0;     // War: chance a distant bullet passes over (in a trench), wire slowdown
    this.car = null; this.ramAt = -9;                     // the Vehicle this actor sits in; when a car last hit them
  }

  // Big Mags etc. are applied to each weapon the first time this actor holds it.
  applyWeaponMods(w) {
    if (!w || w.modded || this.magMult === 1) return;
    w.modded = true;
    w.mag = Math.round(w.mag * this.magMult);
  }
  get weapon() { return this.weapons[this.wi] || null; }

  move(dx, dy, dt) {
    const s = this.speed * (this.healing > 0 ? 0.55 : 1) * this.slow;
    this.vx = dx * s; this.vy = dy * s;
    this.x += this.vx * dt; this.y += this.vy * dt;
  }

  update(dt, game) {
    for (const w of this.weapons) {
      if (w.cooldown > 0) w.cooldown -= dt;
      if (w.reloading) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) {
          w.reloading = false;
          const take = Math.min(w.mag - w.ammo, w.reserve);
          w.ammo += take; if (!w.infinite) w.reserve -= take;
          if (this.isPlayer) Sound.reload();
        }
      }
    }
    if (this.healing > 0) {
      const step = Math.min(dt, this.healing);
      this.healing -= step;
      this.hp = Math.min(this.maxHp, this.hp + this.healRate * step);
    }
    if (this.flash > 0) this.flash -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.lunge > 0) this.lunge -= dt;
    if (this.poison > 0) { this.poison -= dt; this.takeDamage(this.poisonDps * dt, this.poisonSrc, game, false, true); }
  }

  tryShoot(game) {
    const w = this.weapon;
    if (!w || this.healing > 0 || w.reloading || w.cooldown > 0) return false;
    if (this.car && this.car.driver === this) return false; // hands on the wheel; passengers can shoot
    if (w.ammo <= 0) { this.reload(); return false; }
    w.ammo--; w.cooldown = w.rate * this.rateMult;
    const muzzle = this.r + 16;
    const mx = this.x + Math.cos(this.angle) * muzzle, my = this.y + Math.sin(this.angle) * muzzle;
    for (let i = 0; i < w.pellets; i++) {
      const a = this.angle + (Math.random() - 0.5) * 2 * w.spread * this.spreadMult;
      game.spawnBullet(this, mx, my, a, w);
    }
    if (this.shotCost > 0) this.hp = Math.max(1, this.hp - this.shotCost); // Explosive Rounds bite the shooter
    game.onShot(this, w, mx, my);
    if (w.ammo <= 0) this.reload();
    return true;
  }

  reload() {
    const w = this.weapon;
    if (!w || w.reloading || w.ammo >= w.mag || w.reserve <= 0) return;
    w.reloading = true; w.reloadTotal = w.reload * this.reloadMult; w.reloadT = w.reloadTotal;
  }

  switchTo(i) {
    if (i < 0 || i >= this.weapons.length || i === this.wi) return;
    if (this.weapon) this.weapon.reloading = false;
    this.wi = i;
  }

  hasWeapon(key) { return this.weapons.find((w) => w.key === key) || null; }
  worstIndex() {
    let wi = 0;
    for (let i = 1; i < this.weapons.length; i++) if (weaponValue(this.weapons[i]) < weaponValue(this.weapons[wi])) wi = i;
    return wi;
  }

  wantsLoot(l) {
    if (this.noLoot) return false; // campaign soldiers fight with what they were issued
    switch (l.kind) {
      case 'weapon': {
        const own = this.hasWeapon(l.weapon.key);
        if (own) return own.reserve < own.ammoPickup * 1.5;
        if (this.weapons.length < 3) return true;
        return weaponValue(l.weapon) > weaponValue(this.weapons[this.worstIndex()]) + 4;
      }
      case 'ammo': return this.weapons.some((w) => w.reserve < w.ammoPickup * 1.5);
      case 'medkit': return this.meds < 4;
      case 'shield': return this.shield < this.maxShield - 1;
    }
    return false;
  }

  // force = player explicitly pressed E to swap into a full inventory.
  pickup(l, game, force) {
    if (!force && !this.wantsLoot(l)) return false;
    switch (l.kind) {
      case 'weapon': {
        const own = this.hasWeapon(l.weapon.key);
        if (own) {
          const n = Math.ceil((l.weapon.ammo + l.weapon.reserve) * this.ammoMult);
          own.reserve += n; game.notify(this, '+' + n + ' ' + own.name + ' ammo');
        } else if (this.weapons.length < 3) {
          this.applyWeaponMods(l.weapon);
          this.weapons.push(l.weapon); this.switchTo(this.weapons.length - 1);
          game.notify(this, 'Picked up ' + l.weapon.name);
        } else {
          if (this.isPlayer && !force) return false; // needs E to swap
          const idx = this.isPlayer ? this.wi : this.worstIndex();
          const old = this.weapons[idx]; old.reloading = false;
          game.dropLoot(this.x + U.rand(-30, 30), this.y + U.rand(-30, 30), 'weapon', old);
          this.applyWeaponMods(l.weapon);
          this.weapons[idx] = l.weapon; this.wi = idx;
          game.notify(this, 'Swapped for ' + l.weapon.name);
        }
        break;
      }
      case 'ammo':
        for (const w of this.weapons) w.reserve += Math.ceil(w.ammoPickup * 0.5 * this.ammoMult);
        game.notify(this, '+ Ammo');
        break;
      case 'medkit': this.meds++; game.notify(this, 'Medkit (' + this.meds + ')'); break;
      case 'shield': this.shield = Math.min(this.maxShield, this.shield + 50); game.notify(this, '+50 Shield'); break;
    }
    l.alive = false;
    game.onPickup(this, l);
    return true;
  }

  useMed() {
    if (this.meds <= 0 || this.healing > 0 || this.hp >= this.maxHp) return false;
    this.meds--; this.healing = 2.5; this.healRate = 60 / 2.5; this.poison = 0; // a medkit also cures poison
    if (this.weapon) this.weapon.reloading = false;
    return true;
  }

  // Returns the damage actually dealt (shield + health), used for lifesteal.
  // poison: bypasses shields and does not flash, but still credits the biter
  takeDamage(amount, source, game, fromZone, poison) {
    if (!this.alive || this.invuln > 0) return 0;
    if (fromZone) amount *= this.zoneResist;
    const before = this.hp + this.shield;
    if (!fromZone && !poison && this.shield > 0) { const s = Math.min(this.shield, amount); this.shield -= s; amount -= s; }
    this.hp -= amount; this.lastDamaged = game.time;
    if (!fromZone && !poison) this.flash = 0.12;
    if (source && source !== this) { this.lastAttacker = source; this.lastAttackerTime = game.time; }
    if (this.hp <= 0) {
      if (this.secondWind > 0) {
        this.secondWind--; this.hp = 50; this.invuln = 1.5;
        game.onSecondWind(this);
      } else {
        this.hp = 0; this.alive = false; this.deathTime = game.time;
        game.onDeath(this, fromZone ? null : source);
      }
    }
    return Math.max(0, before - (Math.max(0, this.hp) + this.shield));
  }
}

Actor.nextId = 1;

class Bullet {
  constructor(owner, x, y, angle, w) {
    this.owner = owner; this.x = x; this.y = y; this.px = x; this.py = y;
    const sp = w.speed * U.rand(0.95, 1.05);
    this.vx = Math.cos(angle) * sp; this.vy = Math.sin(angle) * sp; this.speed = sp;
    this.dmg = w.dmg * (owner.dmgMult || 1); this.range = w.range * U.rand(0.9, 1.1); this.traveled = 0;
    this.alive = true; this.color = w.color; this.r = 3; this.weaponName = w.name; this.wkey = w.key;
    // rockets: bigger, no falloff, always detonate
    this.kind = w.kind || 'bullet'; this.splash = w.splash || 0; this.radius = w.radius || 0;
    if (this.kind === 'rocket') this.r = 7;
    // power-ups carried over from the shooter
    this.homing = !!owner.homing; this.explosive = !!owner.explosive && this.kind !== 'rocket'; this.pierce = this.kind === 'rocket' ? 0 : (owner.pierce || 0);
    this.hitList = null;
    if (this.explosive) this.color = '#ff7043';
  }

  detonate(x, y, game, direct) {
    game.explode(x, y, this.splash, this.owner, direct, this.radius, !this.noSelf, this.wkey); // tank shells spare their own tank
  }

  // Tracking Bullets: bend toward the nearest enemy roughly ahead of the bullet.
  steer(dt, game) {
    let best = null, bestD = 420 * 420;
    const dir = Math.atan2(this.vy, this.vx);
    for (const a of game.actors) {
      if (!a.alive || a.team === this.owner.team) continue;
      const dx = a.x - this.x, dy = a.y - this.y, d2 = dx * dx + dy * dy;
      if (d2 > bestD) continue;
      if (Math.abs(U.normAngle(Math.atan2(dy, dx) - dir)) > 1.0) continue;
      best = a; bestD = d2;
    }
    if (!best) return;
    const want = U.angle(this.x, this.y, best.x, best.y);
    const turn = U.clamp(U.normAngle(want - dir), -6 * dt, 6 * dt);
    const nd = dir + turn;
    this.vx = Math.cos(nd) * this.speed; this.vy = Math.sin(nd) * this.speed;
  }

  update(dt, game) {
    this.px = this.x; this.py = this.y;
    if (this.homing) this.steer(dt, game);
    if (this.kind === 'rocket') game.particles.push(new Particle(this.x, this.y, U.rand(-20, 20), U.rand(-20, 20), 0.45, 'rgba(200,200,200,0.6)', U.rand(4, 7)));
    const steps = Math.max(1, Math.ceil((this.speed * dt) / 8)), sdt = dt / steps;
    for (let i = 0; i < steps && this.alive; i++) {
      this.x += this.vx * sdt; this.y += this.vy * sdt; this.traveled += this.speed * sdt;
      if (game.world.solidAt(this.x, this.y)) {
        this.alive = false; game.sparks(this.x, this.y, '#ddd', 4);
        if (this.kind === 'rocket') this.detonate(this.px, this.py, game, null);
        else if (this.explosive) game.explode(this.px, this.py, this.dmg, this.owner);
        break;
      }
      if (this.traveled >= this.range) {
        this.alive = false;
        if (this.kind === 'rocket') this.detonate(this.x, this.y, game, null);
        break;
      }
      // cars stop bullets (and shield whoever is inside), except the shooter's own squad's ride
      const vs = game.vehicles;
      if (vs) for (let j = 0; j < vs.length; j++) {
        const v = vs[j];
        if (!v.alive || v === this.owner.car || (v.driver && v.driver.team === this.owner.team)) continue;
        const dx = v.x - this.x, dy = v.y - this.y, rr = v.r + this.r;
        if (dx * dx + dy * dy >= rr * rr) continue;
        this.alive = false;
        v.takeDamage(this.kind === 'rocket' ? this.dmg : this.dmg * (v.def.armor || 1), this.owner, game); // armour shrugs off bullets
        if (game.onVehicleHit) game.onVehicleHit(v, this);
        if (this.kind === 'rocket') this.detonate(this.x, this.y, game, null);
        else if (this.explosive) game.explode(this.x, this.y, this.dmg, this.owner);
        break;
      }
      if (!this.alive) break;
      const actors = game.actors;
      for (let j = 0; j < actors.length; j++) {
        const a = actors[j];
        if (!a.alive || a.car || a.team === this.owner.team || (this.hitList && this.hitList.includes(a))) continue; // no friendly fire
        const dx = a.x - this.x, dy = a.y - this.y, rr = a.r + this.r;
        if (dx * dx + dy * dy < rr * rr) {
          // dug in: most bullets fired from a distance pass overhead (decided once per bullet and target)
          if (a.cover > 0 && this.kind !== 'rocket' && this.traveled > 140) {
            (this.hitList = this.hitList || []).push(a);
            if (Math.random() < a.cover) continue;
          }
          // damage falloff in the last 40% of range
          const far = this.range * 0.6;
          const f = this.kind === 'rocket' ? 1 : (this.traveled > far ? U.lerp(1, 0.6, (this.traveled - far) / (this.range * 0.4)) : 1);
          a.lastHitWeapon = this.wkey;
          const dealt = a.takeDamage(this.dmg * f, this.owner, game, false);
          game.onHit(a, this, dealt);
          if (this.kind === 'rocket') this.detonate(this.x, this.y, game, a);
          else if (this.explosive) game.explode(this.x, this.y, this.dmg, this.owner, a);
          if (this.pierce > 0) {
            this.pierce--; if (!this.hitList || !this.hitList.includes(a)) (this.hitList = this.hitList || []).push(a);
          } else {
            this.alive = false;
          }
          break;
        }
      }
    }
  }
}

// Cars. Arcade handling: whoever drives gives a direction, the car turns toward it and accelerates. Asking for
// the direction straight behind a slow car backs it up instead of turning it around.
// max = top speed on a road (px/s), turn = rad/s at speed, r = collision radius.
const VEHICLES = {
  buggy: { id: 'buggy', name: 'Buggy', seats: 2, hp: 240, max: 650, accel: 560, turn: 3.3, len: 62, wid: 36, r: 25, weight: 4 },
  sedan: { id: 'sedan', name: 'Sedan', seats: 4, hp: 360, max: 590, accel: 430, turn: 2.8, len: 76, wid: 40, r: 28, weight: 5 },
  truck: { id: 'truck', name: 'Truck', seats: 4, hp: 620, max: 480, accel: 320, turn: 2.3, len: 92, wid: 46, r: 33, weight: 2 },
};
const CAR_COLORS = ['#c0392b', '#2e86c1', '#d4a017', '#27ae60', '#8e44ad', '#e67e22', '#dfe4e8', '#3d5166'];

class Vehicle {
  constructor(x, y, def) {
    this.def = def; this.x = x; this.y = y; this.r = def.r;
    this.angle = U.rand(-Math.PI, Math.PI); this.speed = 0; this.vx = 0; this.vy = 0;
    this.hp = def.hp; this.maxHp = def.hp; this.alive = true; this.wreckT = 0; this.flash = 0;
    this.driver = null; this.passengers = [];
    this.ix = 0; this.iy = 0; this.throttle = 1;      // this frame's input from the driver
    this.color = U.pick(CAR_COLORS); this.seed = Math.random() * 100;
    this.lastAttacker = null; this.lastDamaged = -99;
    this.turret = this.angle; this.gunCd = 0; this.mgCd = 0; this.team = -1; // armed vehicles (War): see WAR_VEHICLES
  }
  get name() { return this.def.name; }
  get count() { return (this.driver ? 1 : 0) + this.passengers.length; }
  // Can someone on this team get in? Empty cars are anyone's; occupied ones only take the driver's squad.
  hasSeat(team) { return this.alive && (!this.driver || (this.driver.team === team && this.count < this.def.seats)); }
  // dx,dy: the direction to go (any length); throttle 0..1 caps the speed.
  steer(dx, dy, throttle = 1) { this.ix = dx; this.iy = dy; this.throttle = throttle; }

  update(dt, game) {
    const d = this.def, world = game.world;
    if (this.flash > 0) this.flash -= dt;
    const top = d.max * (d.offroad || world.onRoad(this.x, this.y) ? 1 : 0.82) * (this.hp < this.maxHp * 0.25 ? 0.7 : 1);
    if (this.driver && (this.ix || this.iy)) {
      const want = Math.atan2(this.iy, this.ix);
      let diff = U.normAngle(want - this.angle);
      if (Math.abs(diff) > 2.1 && this.speed < 90) { // back up
        diff = U.normAngle(want + Math.PI - this.angle);
        this.speed = Math.max(-top * 0.42, this.speed - d.accel * 0.9 * dt);
      } else {
        const target = top * this.throttle * (Math.cos(diff) > 0.2 ? 1 : 0.55); // ease off through hard turns
        if (this.speed < target) this.speed = Math.min(target, this.speed + d.accel * dt * (this.speed < 0 ? 2.2 : 1));
        else this.speed = Math.max(target, this.speed - d.accel * 1.3 * dt);
      }
      const turn = d.turn * U.clamp(Math.abs(this.speed) / 140, 0.3, 1) * dt;
      this.angle = U.normAngle(this.angle + U.clamp(diff, -turn, turn));
    } else {
      const drag = (this.driver ? 300 : 460) * dt; // coast to a stop
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    this.ix = 0; this.iy = 0; this.throttle = 1;

    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    if (this.speed !== 0) {
      // crates give way to a moving car; everything else stops it
      if (Math.abs(this.speed) > (d.crush ? 20 : 230)) { // tanks also flatten sandbags, at any speed
        let hit = null;
        world.cellsAround(this.x, this.y, this.r + 6, (o) => {
          if (o.kind !== 'crate' && !(d.crush && o.kind === 'sandbag')) return;
          const nx = U.clamp(this.x, o.x, o.x + o.w), ny = U.clamp(this.y, o.y, o.y + o.h);
          if ((this.x - nx) ** 2 + (this.y - ny) ** 2 < (this.r + 4) ** 2 && !(hit && hit.includes(o))) (hit = hit || []).push(o);
        });
        if (hit) for (const o of hit) { world.removeObstacle(o); this.speed *= d.crush ? 0.97 : 0.86; if (!d.crush) this.hp = Math.max(1, this.hp - 4); if (game.onSmash) game.onSmash(this, o); }
      }
      const nx = this.x + ca * this.speed * dt, ny = this.y + sa * this.speed * dt;
      this.x = nx; this.y = ny;
      world.resolveCircle(this);
      const px = this.x - nx, py = this.y - ny, pd = Math.hypot(px, py);
      if (pd > 0.01) {
        // pushed back out of something: lose the part of the speed that was aimed into it
        const into = Math.max(0, -this.speed * (ca * px + sa * py) / pd);
        if (into > 0) {
          this.speed *= 1 - 0.85 * Math.min(1, into / Math.abs(this.speed));
          if (into > 280 && game.onCrash) game.onCrash(this, into);
        }
      }
    }
    this.vx = ca * this.speed; this.vy = sa * this.speed;
    if (this.driver) this.carry(this.driver);
    for (const p of this.passengers) this.carry(p);
  }
  carry(a) { a.x = this.x; a.y = this.y; a.vx = this.vx; a.vy = this.vy; }

  takeDamage(amount, source, game) {
    if (!this.alive || amount <= 0) return 0;
    this.hp -= amount; this.flash = 0.1; this.lastDamaged = game.time;
    if (source) this.lastAttacker = source;
    if (this.hp <= 0) { this.hp = 0; game.destroyVehicle(this); }
    return amount;
  }
}

class Particle {
  constructor(x, y, vx, vy, life, color, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life; this.color = color; this.size = size;
  }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vx -= this.vx * 5 * dt; this.vy -= this.vy * 5 * dt;
    this.life -= dt;
  }
}
