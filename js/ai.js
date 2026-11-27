'use strict';
// Bot behaviour: perceive -> decide (every ~0.2s) -> act (every frame).
class BotBrain {
  constructor(bot) {
    this.bot = bot;
    this.skill = U.rand(0.45, 1);          // aim, reaction, vision
    this.state = 'roam'; this.target = null; this.targetD = 0; this.targetSeen = -99;
    this.dest = null; this.zoneDest = null;
    this.think = U.rand(0, 0.3); this.reaction = 0;
    this.strafe = 1; this.strafeT = 0;
    this.stuckT = 0; this.lastX = bot.x; this.lastY = bot.y; this.detour = null; this.detourT = 0;
    this.viewRange = 560 + this.skill * 260;
    this.aggro = U.rand(0.45, 1);          // cautious bots only engage up close or when shot at
    this.burstT = 0; this.pauseT = 0;      // trigger discipline: fire in bursts with gaps
    this.retreating = false;
    // difficulty knobs, set by Game.toughenBot
    this.lethal = 0; this.reactionMult = 1; this.wobbleMult = 1; this.pauseMult = 1; this.hunter = false; this.heard = null; this.post = null;
    this.vsBots = null; // how this bot treats other bots when it has been told to go easy on people (set by Game.toughenBot)
    // cars: who goes looking for one, the one being walked to, and the driver's stuck / reverse bookkeeping
    this.likesCars = Math.random() < 0.6; this.carGoal = null; this.carSince = 0; this.noCarUntil = U.rand(0, 6); this.carUntil = 0;
    this.carStuck = 0; this.carFails = 0; this.reverseT = 0; this.avoid = Math.random() < 0.5 ? -1 : 1;
  }

  update(dt, game) {
    this.think -= dt;
    if (this.think <= 0) { this.think = 0.18 + Math.random() * 0.12; this.decide(game); }
    this.act(dt, game);
  }

  // Reaction, aim wobble and trigger pauses: the difficulty's setting against people, never worse than Normal against other bots.
  mult(k, target) {
    const own = k === 'reaction' ? this.reactionMult : k === 'wobble' ? this.wobbleMult : this.pauseMult;
    return this.vsBots && target && !target.isPlayer && !target.human ? Math.min(own, this.vsBots[k]) : own;
  }

  decide(game) {
    const b = this.bot, world = game.world, zone = world.zone;

    // --- perception: nearest visible enemy
    let best = null, bestD = Infinity;
    const provoked = game.time - b.lastDamaged < 4 || (this.target && this.target.alive);
    const gunner = b.car && b.car.def.gun && b.car.driver === b; // tank crews see further
    const view = gunner ? Math.max(this.viewRange, game.war && game.war.fogOn ? 540 : 980) : this.viewRange;
    const engage = provoked || gunner ? view : view * (0.45 + this.aggro * 0.55);
    const engageBots = this.vsBots && !provoked && !gunner ? view * (0.45 + Math.max(this.aggro, this.vsBots.aggro) * 0.55) : engage; // bots do not hang back from each other
    const antiTank = gunner || b.weapons.some((w) => w.kind === 'rocket' && w.ammo + w.reserve > 0);
    for (const a of game.actors) {
      if (a.team === b.team || !a.alive) continue;
      const d = U.dist(b.x, b.y, a.x, a.y);
      let score = a.isPlayer && this.lethal >= 0.6 ? d * 0.5 : d;
      if (a.car && a.car.def.armor) score *= antiTank ? 0.6 : 3; // armour is a job for rockets and other tanks
      if (d < (a.zombie ? view : a.isPlayer || a.human ? engage : engageBots) && score < bestD && world.lineOfSight(b.x, b.y, a.x, a.y)) { best = a; bestD = score; }
    }
    if (best) {
      if (this.target !== best) this.reaction = best.zombie ? 0.1 : (0.3 + (1 - this.skill) * 0.7) * this.mult('reaction', best);
      this.target = best; this.targetD = U.dist(b.x, b.y, best.x, best.y); this.targetSeen = game.time;
    } else if (this.target && (!this.target.alive || game.time - this.targetSeen > 2.5)) {
      if (this.hunter && this.target.alive) this.heard = { x: this.target.x, y: this.target.y, t: game.time }; // hunters chase a target that broke line of sight
      this.target = null;
    }

    this.chooseWeapon();

    // --- low health: back off and heal if we can
    this.retreating = b.hp + b.shield < 40 && (b.meds > 0 || Math.random() < 0.5);
    if (b.hp < 55 && b.meds > 0 && b.healing <= 0 && (!best || bestD > 420)) b.useMed();

    // --- cars: passengers ride until the leader gets out or the car is about to blow; drivers have their own logic
    const car = b.car;
    if (car) {
      if (car.driver === b) return car.def.gun ? this.decideTank(game, car, best) : this.decideDrive(game, car, best);
      const ld = game.teamLeader ? game.teamLeader(b) : null;
      if ((ld && !ld.car) || car.hp < car.maxHp * 0.3) return this.bail(game);
      this.state = 'ride';
      return;
    }
    if (game.vehicles && game.vehicles.length && !this.target && !this.retreating && game.time >= this.noCarUntil) {
      const v = this.pickCar(game);
      if (v) { this.state = 'car'; this.dest = { x: v.x, y: v.y }; return; }
    }

    // --- zone pressure
    const zx = zone.goalX, zy = zone.goalY, zr = zone.goalR;
    const dz = U.dist(b.x, b.y, zx, zy);
    const hurry = !zone.contains(b.x, b.y)
      || (zone.state === 'shrink' && dz > zr - 80)
      || (zone.state === 'wait' && zone.timer < 10 + (1 - this.skill) * 8 && dz > zr - 120);
    if (hurry) {
      if (!this.zoneDest || U.dist(this.zoneDest.x, this.zoneDest.y, zx, zy) > zr * 0.6) {
        const a = U.rand(0, Math.PI * 2), d = U.rand(0, zr * 0.5);
        this.zoneDest = { x: U.clamp(zx + Math.cos(a) * d, 40, world.w - 40), y: U.clamp(zy + Math.sin(a) * d, 40, world.h - 40) };
      }
      this.state = 'zone'; this.dest = this.zoneDest;
      return;
    }
    this.zoneDest = null;

    // objective carriers (Bomb: plant, defuse, pick up) keep pushing while shooting back, and only stop to fight when hit
    const objNow = game.objectiveFor ? game.objectiveFor(b) : null;
    const pressing = objNow && objNow.act !== 'hold' && (objNow.act === 'charge' || game.time - b.lastDamaged > 1.5);
    if (this.target && this.target.alive && !pressing) { this.state = 'fight'; return; }
    if (pressing) { this.state = 'objective'; this.obj = objNow; this.dest = { x: objNow.x, y: objNow.y }; return; }

    // --- hunters close in on gunfire they heard recently
    if (this.heard && (game.time - this.heard.t > 8 || U.dist(b.x, b.y, this.heard.x, this.heard.y) < 140)) this.heard = null;
    if (this.heard && U.dist(this.heard.x, this.heard.y, zx, zy) < zr - 40) { this.state = 'hunt'; this.dest = { x: this.heard.x, y: this.heard.y }; return; }

    // --- objective modes (Bomb): the game hands out a destination and an action
    const obj = game.objectiveFor ? game.objectiveFor(b) : null;
    if (obj) { this.state = 'objective'; this.obj = obj; this.dest = { x: obj.x, y: obj.y }; return; }
    this.obj = null;

    // --- team modes: stay with the squad leader (the player, or the first living teammate)
    const leader = game.teamLeader ? game.teamLeader(b) : null;
    const dl = leader ? U.dist(b.x, b.y, leader.x, leader.y) : 0;
    const followTo = () => {
      const a = U.rand(0, Math.PI * 2), d = U.rand(70, 160);
      this.state = 'follow'; this.dest = { x: U.clamp(leader.x + Math.cos(a) * d, 40, world.w - 40), y: U.clamp(leader.y + Math.sin(a) * d, 40, world.h - 40) };
    };
    if (leader && dl > 900) { followTo(); return; }

    // --- loot nearby
    let bl = null, bd = 420;
    const seeLoot = (l) => {
      if (!l.alive) return;
      const d = U.dist(b.x, b.y, l.x, l.y);
      if (d < bd && b.wantsLoot(l) && U.dist(l.x, l.y, zx, zy) < zr - 50) { bl = l; bd = d; }
    };
    if (world.lootNear) world.lootNear(b.x, b.y, bd, seeLoot); else for (const l of world.loot) seeLoot(l);
    if (bl) { this.state = 'loot'; this.dest = { x: bl.x, y: bl.y }; return; }
    if (leader && dl > 380) { followTo(); return; }

    // --- roam toward a point inside the upcoming zone (near the leader in team modes)
    if (this.state !== 'roam' || !this.dest || U.dist(b.x, b.y, this.dest.x, this.dest.y) < 40 || Math.random() < 0.03) {
      this.state = 'roam';
      let p = null;
      for (let t = 0; t < 6 && !p; t++) {
        // campaign guards have a post and stay around it
        const a = U.rand(0, Math.PI * 2), d = leader ? U.rand(80, 300) : this.post ? U.rand(0, this.post.r) : U.rand(250, 900);
        const ox = leader ? leader.x : this.post ? this.post.x : b.x, oy = leader ? leader.y : this.post ? this.post.y : b.y;
        const c = { x: U.clamp(ox + Math.cos(a) * d, 40, world.w - 40), y: U.clamp(oy + Math.sin(a) * d, 40, world.h - 40) };
        if (U.dist(c.x, c.y, zx, zy) < zr * 0.85 && world.inBounds(c.x, c.y, 30)) p = c;
      }
      if (!p) {
        const a = U.rand(0, Math.PI * 2), d = U.rand(0, zr * 0.7);
        p = { x: U.clamp(zx + Math.cos(a) * d, 40, world.w - 40), y: U.clamp(zy + Math.sin(a) * d, 40, world.h - 40) };
      }
      this.dest = p;
    }
  }

  // Walked into something on the way to this.dest: plan a way round it (World.navPath). False if there is nowhere to
  // plan to, no way there, or the bot got stuck again while already following a route (then it sidesteps as before).
  route(game) {
    const b = this.bot, d = this.dest, world = game.world;
    if (!d || this.state === 'fight' || !world.navPath) return false;
    if (this.path) { this.path = null; this.noPathUntil = game.time + 1.5; return false; }
    if (game.time < (this.noPathUntil || 0) || U.dist(b.x, b.y, d.x, d.y) > 2200) return false; // far-off goals are not worth a search
    const pts = world.navPath(b.x, b.y, d.x, d.y, false);
    if (!pts || !pts.length) { this.noPathUntil = game.time + 6; return false; }
    this.path = { pts, i: 0, gx: d.x, gy: d.y, until: game.time + 20 };
    return true;
  }
  // The next point of the current route for whoever is moving (the bot, or its tank), or null when there is none.
  waypoint(game, e, reach) {
    const p = this.path, d = this.dest;
    if (!p) return null;
    if (!d || game.time > p.until || U.dist(p.gx, p.gy, d.x, d.y) > 90) { this.path = null; return null; }
    while (p.i < p.pts.length && U.dist(e.x, e.y, p.pts[p.i].x, p.pts[p.i].y) < reach) p.i++;
    if (p.i >= p.pts.length) { this.path = null; return null; }
    return p.pts[p.i];
  }

  chooseWeapon() {
    const b = this.bot;
    if (b.weapons.length <= 1) return;
    const d = this.target ? this.targetD : 500;
    let bi = b.wi, bs = -Infinity;
    b.weapons.forEach((w, i) => {
      if (w.ammo + w.reserve <= 0) return;
      if (w.kind === 'rocket' && d < 260 && b.weapons.length > 1) return; // too close to rocket safely
      const armour = this.target && this.target.car && this.target.car.def.armor;
      if (w.kind === 'rocket' && this.saveRockets && !armour) return; // War: rockets are kept for tanks and nests
      let s = w.tier * 10 + (w.ammo > 0 ? 8 : 0) + (armour && w.kind === 'rocket' ? 40 : 0);
      s -= Math.abs(w.range * 0.55 - d) / 60; // prefer a weapon suited to the engagement range
      if (s > bs) { bs = s; bi = i; }
    });
    const cur = b.weapon;
    if (bi !== b.wi && !(cur && cur.reloading && cur.reloadT < 0.6)) b.switchTo(bi);
  }

  act(dt, game) {
    const b = this.bot, world = game.world;
    let mx = 0, my = 0;
    const t = this.target && this.target.alive ? this.target : null;
    if (b.car) return b.car.def.gun && b.car.driver === b ? this.actTank(dt, game, t) : this.actCar(dt, game, t);

    // --- movement
    if (this.state === 'car' && this.carGoal && U.dist(b.x, b.y, this.carGoal.x, this.carGoal.y) < this.carGoal.r + b.r + 16) {
      if (game.enterVehicle(b, this.carGoal)) { this.carUntil = game.time + U.rand(15, 40); this.lastTargetAt = game.time; this.carFails = 0; this.carStuck = 0; this.reverseT = 0; this.dest = null; this.state = 'drive'; return; }
      this.carGoal = null; this.noCarUntil = game.time + 5;
    }
    if (this.state === 'fight' && t) {
      const d = U.dist(b.x, b.y, t.x, t.y), w = b.weapon, vsZ = !!t.zombie;
      const pref = vsZ ? 280 : w ? Math.min(w.range * 0.5, 450) : 300;
      const ang = U.angle(b.x, b.y, t.x, t.y);
      if (this.retreating && !vsZ) { mx = -Math.cos(ang) * 1.5; my = -Math.sin(ang) * 1.5; }
      else if (d > pref + 80 && !vsZ) { mx = Math.cos(ang); my = Math.sin(ang); }
      else if (d < pref - (vsZ ? 60 : 150)) { mx = -Math.cos(ang) * (vsZ ? 1.4 : 1); my = -Math.sin(ang) * (vsZ ? 1.4 : 1); }
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = U.rand(0.5, 1.5); this.strafe = Math.random() < 0.5 ? -1 : 1; }
      const sw = vsZ ? 0.45 : 0.9;
      mx += -Math.sin(ang) * this.strafe * sw; my += Math.cos(ang) * this.strafe * sw;
      if (w && w.reloading && d < 300) { mx -= Math.cos(ang) * 1.2; my -= Math.sin(ang) * 1.2; }
      if (b.cover > 0 && b.warRole === 'defend' && d > 200 && !this.retreating) { mx = 0; my = 0; } // dug in: stay down and shoot
    } else if (this.state === 'objective' && this.obj && this.obj.act !== 'hold' && U.dist(b.x, b.y, this.obj.x, this.obj.y) < this.obj.r) {
      game.holdAction(b, dt); // planting / defusing / picking up: stand still and work
    } else if (this.dest) {
      const d = U.dist(b.x, b.y, this.dest.x, this.dest.y);
      if (d > 10) { const g = this.waypoint(game, b, 30) || this.dest, ang = U.angle(b.x, b.y, g.x, g.y); mx = Math.cos(ang); my = Math.sin(ang); }
    }

    // --- a car coming straight at us: get out of its line
    if (game.vehicles) for (const v of game.vehicles) {
      if (!v.alive || !v.driver || v.driver.team === b.team) continue;
      const sp = Math.abs(v.speed); if (sp < 200) continue;
      const dx = b.x - v.x, dy = b.y - v.y, d = Math.hypot(dx, dy);
      if (d > 300 || d < 1 || (dx * v.vx + dy * v.vy) / (d * sp) < 0.8) continue;
      const side = v.vx * dy - v.vy * dx > 0 ? 1 : -1;
      mx = -v.vy / sp * side * 2; my = v.vx / sp * side * 2;
      break;
    }

    // --- stuck handling: if we wanted to move but did not, sidestep for a moment
    if (this.detourT > 0) { this.detourT -= dt; mx = this.detour.x; my = this.detour.y; }
    else {
      const moved = U.dist(b.x, b.y, this.lastX, this.lastY);
      const wanted = Math.hypot(mx, my) > 0.1;
      if (wanted && moved < b.speed * dt * 0.35) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
      if (this.stuckT > 0.2 && this.route(game)) this.stuckT = 0;
      if (this.stuckT > 0.2) {
        this.stuckT = 0;
        const len = Math.hypot(mx, my) || 1, s = Math.random() < 0.5 ? -1 : 1;
        this.detour = { x: (-my / len) * s + (mx / len) * 0.3, y: (mx / len) * s + (my / len) * 0.3 };
        this.detourT = U.rand(0.35, 0.8);
      }
    }
    this.lastX = b.x; this.lastY = b.y;
    const len = Math.hypot(mx, my);
    if (len > 0.01) b.move(mx / len, my / len, dt);

    // --- aiming and shooting (also while running to the zone)
    if (t) this.aim(dt, game, t);
    else if (len > 0.01) b.angle = U.lerpAngle(b.angle, Math.atan2(my, mx), dt * 6);
  }

  // ---------------------------------------------------------------- cars
  // Which car (if any) this bot should walk to. Squad members ride with their leader, or grab their own car to
  // keep up; lone bots take one to outrun the circle, and the ones who like driving take any that is close.
  pickCar(game) {
    if (game.war) return War.pickCar(game, this);
    const b = this.bot, zone = game.world.zone, now = game.time;
    const leader = game.teamLeader ? game.teamLeader(b) : null;
    let range;
    if (leader) {
      if (!leader.car) { this.carGoal = null; return null; }
      if (leader.car.hasSeat(b.team) && U.dist(b.x, b.y, leader.x, leader.y) < 600) return this.chaseCar(leader.car, now);
      range = 500;
    } else {
      const far = U.dist(b.x, b.y, zone.goalX, zone.goalY) > zone.goalR + 300;
      if (!far && !this.likesCars) return null;
      range = far ? 750 : 380;
    }
    let g = this.carGoal;
    if (!(g && g.alive && !g.driver && U.dist(b.x, b.y, g.x, g.y) < range + 200)) {
      g = null; let bd = range;
      for (const v of game.vehicles) {
        if (!v.alive || v.driver || v.hp < v.maxHp * 0.4) continue;
        const d = U.dist(b.x, b.y, v.x, v.y);
        if (d < bd) { g = v; bd = d; }
      }
    }
    if (!g) { this.carGoal = null; return null; }
    return this.chaseCar(g, now);
  }
  // Give up on a car that cannot be reached in a few seconds.
  chaseCar(v, now) {
    if (this.carGoal !== v) { this.carGoal = v; this.carSince = now; }
    else if (now - this.carSince > 7) { this.carGoal = null; this.noCarUntil = now + 12; return null; }
    return v;
  }
  bail(game) {
    game.leaveVehicle(this.bot);
    this.noCarUntil = game.time + U.rand(8, 16); this.carGoal = null; this.carFails = 0; this.carStuck = 0; this.reverseT = 0;
    this.state = 'roam'; this.dest = null;
  }

  // Behind the wheel: where to, or is it time to get out?
  decideDrive(game, car, enemy) {
    const b = this.bot, zone = game.world.zone, world = game.world;
    if (car.hp < car.maxHp * 0.3 || this.carFails >= 3) return this.bail(game); // about to blow, or wedged
    const zx = zone.goalX, zy = zone.goalY, zr = zone.goalR;
    const outside = U.dist(b.x, b.y, zx, zy) > zr - 150;
    const ed = enemy ? U.dist(b.x, b.y, enemy.x, enemy.y) : Infinity;
    // run them down, if this bot is the type and the car can take it
    if (enemy && !enemy.car && ed < 650 && car.hp > car.maxHp * 0.5 && this.aggro > 0.6) { this.state = 'ram'; return; }
    if (enemy && ed < 380 && Math.abs(car.speed) < 200 && !outside) return this.bail(game); // caught slow next to a gun
    let leader = game.teamLeader ? game.teamLeader(b) : null;
    if (leader && leader.car === car) leader = null; // the leader is riding with us
    if (leader) {
      const dl = U.dist(b.x, b.y, leader.x, leader.y);
      if (!leader.car && dl < 320) return this.bail(game); // caught up with the squad on foot
      this.state = 'drive'; this.dest = { x: leader.x, y: leader.y, stop: 170 };
      return;
    }
    if (outside) {
      if (!this.zoneDest || U.dist(this.zoneDest.x, this.zoneDest.y, zx, zy) > zr * 0.6) {
        const a = U.rand(0, Math.PI * 2), d = U.rand(0, zr * 0.5);
        this.zoneDest = { x: U.clamp(zx + Math.cos(a) * d, 60, world.w - 60), y: U.clamp(zy + Math.sin(a) * d, 60, world.h - 60) };
      }
      this.state = 'drive'; this.dest = this.zoneDest;
      return;
    }
    // inside the circle with nowhere to be: cruise for a while, then park and get out
    if (game.time > this.carUntil) return this.bail(game);
    if (this.state !== 'drive' || !this.dest || U.dist(b.x, b.y, this.dest.x, this.dest.y) < 240) {
      const a = U.rand(0, Math.PI * 2), d = U.rand(0, zr * 0.8);
      this.dest = { x: U.clamp(zx + Math.cos(a) * d, 60, world.w - 60), y: U.clamp(zy + Math.sin(a) * d, 60, world.h - 60) };
    }
    this.state = 'drive';
  }

  actCar(dt, game, t) {
    const b = this.bot, v = b.car;
    if (v.driver !== b) { if (t) this.aim(dt, game, t); return; } // passengers shoot from the window
    if (this.state === 'ram' && t) {
      const k = U.dist(b.x, b.y, t.x, t.y) / Math.max(250, Math.abs(v.speed)); // aim where they will be
      this.drive(dt, game, v, t.x + t.vx * k * 0.8, t.y + t.vy * k * 0.8, 1);
    } else if (this.dest) {
      const d = U.dist(b.x, b.y, this.dest.x, this.dest.y);
      if (d > (this.dest.stop || 70)) this.drive(dt, game, v, this.dest.x, this.dest.y, d < 380 ? 0.45 : 1);
    }
  }

  // Steer toward a point, swinging around whatever is in the way. Crates do not count: the car goes through them.
  drive(dt, game, v, tx, ty, thr) {
    const world = game.world, sp = Math.abs(v.speed);
    if (this.reverseT > 0) { // wedged: back out with the nose swinging to one side
      this.reverseT -= dt;
      const a = v.angle + Math.PI + this.avoid * 0.5;
      v.steer(Math.cos(a), Math.sin(a), 1);
      return;
    }
    if (sp < 45) this.carStuck += dt; else { this.carStuck = Math.max(0, this.carStuck - dt * 2); if (sp > 250) this.carFails = Math.max(0, this.carFails - dt * 0.3); }
    if (this.carStuck > 1.1) { this.carStuck = 0; this.reverseT = U.rand(0.6, 1); this.avoid = -this.avoid; this.carFails++; return; }
    const want = Math.atan2(ty - v.y, tx - v.x), look = 90 + sp * 0.4, rr = v.r + 8, skip = v.def.crush ? WAR_CRUSH : sp > 230 ? 'crate' : undefined;
    const clear = (ang) => {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let k = 0.25; k <= 1; k += 0.25) {
        const px = v.x + ca * look * k, py = v.y + sa * look * k;
        if (!world.inBounds(px, py, rr) || world.circleBlocked(px, py, rr, skip)) return false;
      }
      return true;
    };
    let dir = null, off = 0;
    for (const o of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]) {
      if (clear(want + o * this.avoid)) { dir = want + o * this.avoid; off = Math.abs(o); break; }
    }
    if (dir === null) { this.reverseT = 0.5; this.avoid = -this.avoid; return; }
    if (off > 0.9) thr *= 0.6;
    if (sp > 200 && Math.abs(U.normAngle(dir - v.angle)) > 0.3 && !clear(v.angle)) thr = Math.min(thr, 0.4); // brake: still pointed at it
    v.steer(Math.cos(dir), Math.sin(dir), thr);
  }

  // ---------------------------------------------------------------- tanks and MG nests (War)
  // A tank rolls to wherever its army is attacking and stops to shoot; a nest gunner stays until the position falls.
  decideTank(game, car, enemy) {
    const b = this.bot;
    if (enemy) this.lastTargetAt = game.time;
    if (!car.def.max) {
      const pt = game.war ? game.war.points[car.pi] : null;
      if ((pt && pt.owner === 1 - b.team) || game.time - (this.lastTargetAt || 0) > 30) { this.bail(game); this.noCarUntil = game.time + 20; return; }
      this.state = 'nest';
      return;
    }
    const goal = game.objectiveFor ? game.objectiveFor(b) : null;
    if (this.carFails >= 2 && goal && game.world.navPath) {
      const pts = game.world.navPath(car.x, car.y, goal.x, goal.y, true);
      if (pts && pts.length) { this.path = { pts, i: 0, gx: goal.x, gy: goal.y, until: game.time + 20 }; this.carFails = 0; this.jink = null; }
      else this.carFails = 3; // no way through: do not search again every tick, jink instead
    }
    if (this.carFails >= 3) { this.carFails = 0; this.jink = { x: car.x + U.rand(-500, 500), y: car.y + U.rand(-500, 500), stop: 90, until: game.time + 4 }; } // wedged: try another way round
    if (this.jink && game.time > this.jink.until) this.jink = null;
    const obj = game.objectiveFor ? game.objectiveFor(b) : null;
    this.state = 'drive';
    this.dest = this.jink || (obj ? { x: obj.x, y: obj.y, stop: 110 } : null);
  }
  actTank(dt, game, t) {
    const b = this.bot, v = b.car, world = game.world;
    let engaged = false;
    if (t) {
      const d = U.dist(v.x, v.y, t.x, t.y), tt = d / 950;
      const desired = U.angle(v.x, v.y, t.x + t.vx * tt * 0.8, t.y + t.vy * tt * 0.8);
      b.angle = U.lerpAngle(b.angle, desired, dt * (2.5 + this.skill * 2));
      this.reaction -= dt;
      if (d < 1100 && world.lineOfSight(v.x, v.y, t.x, t.y)) {
        engaged = d < 620;
        if (this.reaction <= 0 && Math.abs(U.normAngle(desired - v.turret)) < 0.12) War.fireGun(game, v);
      }
    } else if (Math.abs(v.speed) > 20) b.angle = U.lerpAngle(b.angle, v.angle, dt * 2);
    v.turret = U.lerpAngle(v.turret, b.angle, dt * 4);
    if (!v.def.max || engaged || !this.dest) return;
    const dd = U.dist(v.x, v.y, this.dest.x, this.dest.y), wp = this.waypoint(game, v, 70);
    if (wp) this.drive(dt, game, v, wp.x, wp.y, 0.8);
    else if (dd > (this.dest.stop || 70)) this.drive(dt, game, v, this.dest.x, this.dest.y, dd < 300 ? 0.5 : 1);
  }

  aim(dt, game, t) {
    const b = this.bot, world = game.world;
    this.reaction -= dt;
    const w = b.weapon, d = U.dist(b.x, b.y, t.x, t.y);
    const tt = w ? d / w.speed : 0, lead = 0.6 + this.skill * 0.4;
    const px = t.x + t.vx * tt * lead, py = t.y + t.vy * tt * lead;
    const desired = U.angle(b.x, b.y, px, py);
    const wobble = Math.sin(game.time * 2.7 + b.seed) * (0.3 - this.skill * 0.2) * Math.min(1.6, d / 350) * (t.zombie ? 0.4 : this.mult('wobble', t));
    b.angle = U.lerpAngle(b.angle, desired + wobble, dt * (4 + this.skill * 6));
    const onTarget = Math.abs(U.normAngle(desired - b.angle)) < 0.25;
    // burst / pause rhythm so bots do not hose continuously
    if (t.zombie) this.burstT = 1;
    else if (this.burstT > 0) this.burstT -= dt;
    else if (this.pauseT > 0) this.pauseT -= dt;
    else { this.burstT = U.rand(0.25, 0.5 + this.skill * 0.5); this.pauseT = U.rand(0.3, 1.1 - this.skill * 0.5) * this.mult('pause', this.target); }
    const tooClose = w && w.kind === 'rocket' && d < (b.weapons.length > 1 ? 200 : 120); // with only a rocket, fire unless it would hit us too
    if (this.reaction <= 0 && this.burstT > 0 && w && !tooClose && d < w.range * 0.9 && onTarget && world.lineOfSight(b.x, b.y, t.x, t.y)) {
      if (w.auto || Math.random() < 0.7) b.tryShoot(game);
    }
  }
}

// Zombies mode: a zombie always knows where the nearest human is and shambles straight at them,
// weaving a little so a horde spreads out, sliding along walls when blocked, and biting in reach.
class ZombieBrain {
  constructor(z) {
    this.bot = z;
    this.target = null; this.targetD = Infinity;
    this.think = U.rand(0, 0.2);
    this.wander = 0; this.wanderT = 0; this.roamAngle = U.rand(-Math.PI, Math.PI);
    this.stuckT = 0; this.lastX = z.x; this.lastY = z.y; this.detour = null; this.detourT = 0; this.side = Math.random() < 0.5 ? -1 : 1;
  }

  update(dt, game) {
    this.think -= dt;
    if (this.think <= 0) { this.think = 0.15 + Math.random() * 0.15; this.decide(game); }
    this.act(dt, game);
  }

  decide(game) {
    const z = this.bot;
    let best = null, bd = Infinity;
    for (const a of game.actors) {
      if (!a.alive || a.zombie || a.team === z.team) continue;
      const d = U.dist(z.x, z.y, a.x, a.y);
      if (d < bd) { bd = d; best = a; }
    }
    this.target = best; this.targetD = bd;
    if (Math.random() < 0.004) Sound.groan(U.clamp(1 - U.dist(z.x, z.y, game.renderer.camX, game.renderer.camY) / 900, 0, 1));
  }

  act(dt, game) {
    const z = this.bot, t = this.target && this.target.alive ? this.target : null;
    if (z.attackCd > 0) z.attackCd -= dt;
    let mx = 0, my = 0;
    this.wanderT -= dt;
    if (t) {
      const ang = U.angle(z.x, z.y, t.x, t.y), d = U.dist(z.x, z.y, t.x, t.y);
      if (this.wanderT <= 0) { this.wanderT = U.rand(0.4, 1.2); this.wander = U.rand(-0.7, 0.7); }
      const side = d > 110 ? this.wander : 0;
      mx = Math.cos(ang) - Math.sin(ang) * side; my = Math.sin(ang) + Math.cos(ang) * side;
      z.angle = U.lerpAngle(z.angle, ang, dt * 8);
      if (d < z.r + t.r + 14 && z.attackCd <= 0) { z.attackCd = z.zombie.rate; game.zombieAttack(z, t); }
    } else {
      if (this.wanderT <= 0) { this.wanderT = U.rand(1, 2.5); this.roamAngle = U.rand(-Math.PI, Math.PI); }
      mx = Math.cos(this.roamAngle); my = Math.sin(this.roamAngle);
      z.angle = U.lerpAngle(z.angle, this.roamAngle, dt * 4);
    }

    // stuck against a wall: slide sideways for a while, flipping sides if that did not help
    if (this.detourT > 0) { this.detourT -= dt; mx = this.detour.x; my = this.detour.y; }
    else {
      const moved = U.dist(z.x, z.y, this.lastX, this.lastY);
      if (Math.hypot(mx, my) > 0.1 && moved < z.speed * dt * 0.35) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
      if (this.stuckT > 0.2) {
        this.stuckT = 0;
        if (this.lastDetourAt && game.time - this.lastDetourAt < 2) this.side = -this.side;
        this.lastDetourAt = game.time;
        const len = Math.hypot(mx, my) || 1;
        this.detour = { x: (-my / len) * this.side + (mx / len) * 0.2, y: (mx / len) * this.side + (my / len) * 0.2 };
        this.detourT = U.rand(0.6, 1.3);
      }
    }
    this.lastX = z.x; this.lastY = z.y;
    const len = Math.hypot(mx, my);
    if (len > 0.01) z.move(mx / len, my / len, dt);
  }
}
