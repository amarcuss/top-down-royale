'use strict';
class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.mm = minimap; this.mctx = minimap.getContext('2d');
    this.scale = 1; this.zoom = 1; this.camX = 0; this.camY = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    // Draw at the screen's real pixel density (phones are 2-3x) so nothing is blurry, within a pixel budget.
    // W and H stay in CSS pixels: all drawing and input use those, and draw() scales the context by dpr.
    // The size comes from the canvas's own box on the page, not from the window: on a phone the two can differ (browser
    // bars, zoom), and drawing for one size into a box of another stretches and blurs everything.
    const W = this.W = this.canvas.clientWidth || window.innerWidth, H = this.H = this.canvas.clientHeight || window.innerHeight;
    this.devDpr = window.devicePixelRatio || 1;
    this.dpr = Math.max(1, Math.min(this.devDpr, this.sharp ? 3 : (this.dprCap || 3), Math.sqrt((this.sharp ? 9e6 : 4.5e6) / Math.max(1, W * H))));
    this.canvas.width = Math.round(W * this.dpr); this.canvas.height = Math.round(H * this.dpr);
    // (the canvas is stretched over the window by CSS, so its on-screen size never depends on these numbers)
    this.scale = U.clamp(Math.min(W / 1500, H / 850), 0.6, 1.4);
    if (H < 500 || W < 700) this.scale = U.clamp(Math.min(W / 1300, H / 700), 0.45, 1); // a phone: pull the camera back so you see about as much of the fight as on a desktop
  }
  kick(w) { this.shake = Math.max(this.shake || 0, { pistol: 3, smg: 2.5, shotgun: 9, rifle: 3.5, sniper: 12 }[w.key] || 3); }
  get s() { return this.scale * this.zoom * (this.vzoom || 1); } // effective scale (Eagle Eye zooms out, and so does driving fast)
  // deterministic 0..1 noise from coordinates, so world detail is stable frame to frame
  hash(x, y, k = 0) { const v = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); }
  // lighten (f > 1) or darken (f < 1) a #rrggbb colour
  shade(hex, f) {
    if (!hex || hex[0] !== '#' || hex.length !== 7) return hex;
    const c = (i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
    return 'rgb(' + c(1) + ',' + c(3) + ',' + c(5) + ')';
  }
  toWorld(sx, sy) {
    return { x: (sx - this.W / 2) / this.s + this.camX, y: (sy - this.H / 2) / this.s + this.camY };
  }

  draw(game) {
    // Phones report the new window size late after a rotation or when the browser bars slide away, and not
    // always with a resize event, so the size is checked every frame.
    if ((this.canvas.clientWidth || window.innerWidth) !== this.W || (this.canvas.clientHeight || window.innerHeight) !== this.H || (window.devicePixelRatio || 1) !== this.devDpr) this.resize();
    // Sharpness is not worth a slideshow: if frames stay slow, step the pixel density down (never back up).
    const tn = performance.now(), ft = tn - (this.lastDrawAt || tn); this.lastDrawAt = tn;
    // "Slow" means under about 22 frames a second for a couple of seconds. (A phone in Low Power Mode runs at a steady
    // 30, which is fine and must not cost it its sharpness.) It never drops below 1.5x on a high-density screen.
    this.slow = ft > 45 && ft < 400 ? (this.slow || 0) + 1 : Math.max(0, (this.slow || 0) - 2);
    const floor = Math.min(window.devicePixelRatio || 1, 1.5);
    if (this.slow > 60 && this.dpr > floor && !this.sharp) { this.dprCap = Math.max(floor, this.dpr - 0.5); this.slow = 0; this.resize(); }
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const m = game.world ? game.world.map : null;
    ctx.fillStyle = m ? m.outside : '#1b2a1c'; ctx.fillRect(0, 0, W, H);
    if (!game.world) return;
    const world = game.world, zone = world.zone;

    const focus = game.cameraTarget();
    // in a car the camera pulls back with speed and looks a little ahead
    const ride = focus.car || null, ck = 1 - Math.pow(0.03, game.dt || 0);
    this.vzoom = U.lerp(this.vzoom || 1, ride ? (ride.def.gun ? 0.8 : 0.92 - 0.2 * Math.min(1, Math.abs(ride.speed) / 520)) : 1, ck);
    this.leadX = U.lerp(this.leadX || 0, ride ? ride.vx * 0.22 : 0, ck); this.leadY = U.lerp(this.leadY || 0, ride ? ride.vy * 0.22 : 0, ck);
    const fx = focus.x + this.leadX, fy = focus.y + this.leadY, s = this.s;
    if (game.player.alive) { this.camX = fx; this.camY = fy; }
    else { const k = 1 - Math.pow(0.002, game.dt); this.camX = U.lerp(this.camX, fx, k); this.camY = U.lerp(this.camY, fy, k); }

    // camera kick from the player's own gunfire
    this.shake = Math.min(20, (this.shake || 0) * Math.pow(0.0001, Math.max(0, game.dt)));
    const shx = (Math.random() - 0.5) * 2 * this.shake, shy = (Math.random() - 0.5) * 2 * this.shake;

    ctx.save();
    ctx.translate(W / 2 + shx, H / 2 + shy); ctx.scale(s, s); ctx.translate(-this.camX, -this.camY);
    const vw = W / s, vh = H / s;
    const vx0 = this.camX - vw / 2, vy0 = this.camY - vh / 2, vx1 = vx0 + vw, vy1 = vy0 + vh;
    const inView = (x, y, m) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;

    // static world: ground, decor, detail, grid, border and obstacles come from cached tiles
    this.treeHighlight = m.treeHighlight;
    this.drawWorldTiles(ctx, world, m, vx0, vy0, vx1, vy1);

    if (game.camp) this.drawCampaign(ctx, game);
    if (game.war) this.drawWar(ctx, game);
    // Bomb mode: sites and the bomb
    if (game.mode.type === 'bomb' && game.sites) this.drawBombWorld(ctx, game);
    // poison clouds left by Toxic zombies
    if (game.hazards) for (const h of game.hazards) {
      if (!inView(h.x, h.y, h.r)) continue;
      const k = Math.min(1, (h.until - game.time) / 0.8);
      const g = ctx.createRadialGradient(h.x, h.y, h.r * 0.2, h.x, h.y, h.r);
      g.addColorStop(0, 'rgba(120,230,60,' + 0.45 * k + ')'); g.addColorStop(1, 'rgba(120,230,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.fill();
    }
    // loot
    for (const l of world.loot) if (l.alive && inView(l.x, l.y, 40)) this.drawLoot(ctx, l, game);


    // cars (and burnt-out wrecks), then everyone on foot
    if (game.vehicles) for (const v of game.vehicles) if (inView(v.x, v.y, 90)) { if (v.def.gun) this.drawArmor(ctx, v, game); else this.drawVehicle(ctx, v, game); }
    for (const a of game.actors) if (a.alive && !a.car && inView(a.x, a.y, 60)) this.drawActor(ctx, a, game);

    // bullets: bright tracer with a trail behind the projectile
    ctx.lineCap = 'round';
    for (const b of game.bullets) {
      if (!inView(b.x, b.y, 80)) continue;
      if (b.kind === 'rocket') {
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.fillStyle = 'rgba(255,170,60,' + (0.5 + 0.5 * Math.random()) + ')';
        ctx.beginPath(); ctx.ellipse(-16, 0, 10 + Math.random() * 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a3a40'; ctx.fillRect(-11, -4, 20, 8);
        ctx.fillStyle = b.color; ctx.beginPath(); ctx.moveTo(9, -4); ctx.lineTo(16, 0); ctx.lineTo(9, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#777'; ctx.fillRect(-11, -7, 4, 3); ctx.fillRect(-11, 4, 4, 3);
        ctx.restore();
        continue;
      }
      const len = Math.min(b.traveled, 48), inv = 1 / b.speed;
      const tx = b.x - b.vx * inv * len, ty = b.y - b.vy * inv * len;
      ctx.strokeStyle = b.color; ctx.globalAlpha = 0.35; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(b.x - b.vx * inv * 12, b.y - b.vy * inv * 12); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // particles
    for (const p of game.particles) {
      if (!inView(p.x, p.y, 20)) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (game.war) this.drawWarTop(ctx, game);

    // zone: shade everything outside the circle (arena modes have no zone)
    if (!zone.fixed) {
      ctx.beginPath();
      ctx.rect(vx0 - 20, vy0 - 20, vw + 40, vh + 40);
      ctx.arc(zone.cx, zone.cy, zone.r, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(110, 40, 170, 0.42)'; ctx.fill();
      ctx.strokeStyle = 'rgba(200,120,255,0.9)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(zone.cx, zone.cy, zone.r, 0, Math.PI * 2); ctx.stroke();
      if (!zone.done) {
        ctx.setLineDash([18, 14]); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(zone.tx, zone.ty, zone.tr, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();

    if (game.camp && game.state === 'playing') this.drawCampaignArrows(ctx, game, W, H, s);
    if (game.war && game.state === 'playing') this.drawCampaignArrows(ctx, game, W, H, s, War.marks(game));
    // Fog mutator: the world fades out a few hundred pixels from whoever the camera follows
    if (game.mut && game.mut.fog) this.drawFog(ctx, game, W, H, s);
    else if (game.war && game.war.fogK > 0) this.drawFog(ctx, game, W, H, s, game.war.fogK); // War: fog that rolls in and lifts again
    if (game.war && game.war.sky.tint) { ctx.fillStyle = game.war.sky.tint; ctx.fillRect(0, 0, W, H); } // dusk, night, overcast
    // outside-zone vignette
    if (game.player.alive && !zone.contains(game.player.x, game.player.y)) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      const a = 0.35 + 0.15 * Math.sin(game.time * 6);
      g.addColorStop(0, 'rgba(180,0,40,0)'); g.addColorStop(1, 'rgba(180,0,40,' + a + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // hit flash
    if (game.player.alive && game.player.flash > 0) {
      ctx.fillStyle = 'rgba(255,0,0,' + (game.player.flash * 1.2) + ')'; ctx.fillRect(0, 0, W, H);
    }
    // crosshair (always drawn; with pointer lock the OS cursor is hidden)
    if (game.state === 'playing' && game.input.touch) this.drawSticks(game.input, W, H); // touchscreens: thumb sticks, and no cursor
    else if (game.state === 'playing') {
      const mx = game.input.mouse.x, my = game.input.mouse.y;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(mx + dx * 4, my + dy * 4); ctx.lineTo(mx + dx * 14, my + dy * 14); }
      ctx.stroke();
    }

    this.drawMinimap(game);
  }

  // Touch thumb sticks: where the thumbs are, or faint markers where they go.
  drawSticks(inp, W, H) {
    const ctx = this.ctx, R = inp.stickR;
    const one = (st, hx, label, aim) => {
      const on = st.id !== null, x = on ? st.ox : hx, y = on ? st.oy : H - R - 30;
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,' + (on ? 0.45 : 0.2) + ')'; ctx.fillStyle = 'rgba(10,12,16,' + (on ? 0.28 : 0.14) + ')';
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = aim && st.fire ? 'rgba(255,110,90,0.85)' : 'rgba(255,255,255,' + (on ? 0.7 : 0.25) + ')';
      ctx.beginPath(); ctx.arc(x + st.dx * R, y + st.dy * R, 22, 0, Math.PI * 2); ctx.fill();
      if (!on) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '700 10px system-ui, sans-serif'; ctx.save(); ctx.textAlign = 'center'; ctx.fillText(label, x, y + R + 14); ctx.restore(); }
    };
    one(inp.stick, R + 46, 'MOVE', false);
    one(inp.aim, W - R - 46, 'FIRE · DRAG TO AIM', true);
  }

  rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  // Cars from above, nose toward +x: wheels, body, glass or roll cage, lights, and the heads of whoever is inside.
  drawVehicle(ctx, v, game) {
    const d = v.def, L = d.len, Wd = d.wid, dead = !v.alive;
    ctx.save(); ctx.translate(v.x, v.y);
    if (dead) ctx.globalAlpha = U.clamp(v.wreckT / 2, 0, 1);
    ctx.save(); ctx.translate(5, 8); ctx.rotate(v.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; this.rr(ctx, -L / 2, -Wd / 2, L, Wd, 9); ctx.fill();
    ctx.restore();
    ctx.rotate(v.angle);
    ctx.fillStyle = '#15161a';
    for (const wx of [-L * 0.3, L * 0.28]) for (const s of [-1, 1]) ctx.fillRect(wx - 9, s * (Wd / 2) - 4, 18, 8);
    const body = dead ? '#2b2b2e' : v.flash > 0 ? '#ffffff' : v.color;
    ctx.fillStyle = body; this.rr(ctx, -L / 2, -Wd / 2, L, Wd, d.id === 'truck' ? 6 : 10); ctx.fill();
    ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.13)'; ctx.fillRect(L * 0.2, -Wd / 2 + 4, L * 0.22, Wd - 8); // hood catching the light
    const glass = dead ? 'rgba(10,10,12,0.8)' : 'rgba(22,32,46,0.88)';
    let seats;
    if (d.id === 'buggy') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; this.rr(ctx, -L * 0.3, -Wd / 2 + 5, L * 0.5, Wd - 10, 5); ctx.fill();
      seats = [[-L * 0.02, -Wd * 0.2], [-L * 0.02, Wd * 0.2]];
    } else if (d.id === 'truck') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-L / 2 + 5, -Wd / 2 + 5, L * 0.42, Wd - 10);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 2; ctx.strokeRect(-L / 2 + 5, -Wd / 2 + 5, L * 0.42, Wd - 10);
      ctx.fillStyle = glass; this.rr(ctx, -L * 0.02, -Wd / 2 + 5, L * 0.3, Wd - 10, 4); ctx.fill();
      seats = [[L * 0.12, -Wd * 0.2], [L * 0.12, Wd * 0.2], [-L * 0.25, -Wd * 0.2], [-L * 0.25, Wd * 0.2]];
    } else {
      ctx.fillStyle = glass; this.rr(ctx, -L * 0.27, -Wd / 2 + 5, L * 0.5, Wd - 10, 6); ctx.fill();
      seats = [[L * 0.08, -Wd * 0.2], [L * 0.08, Wd * 0.2], [-L * 0.15, -Wd * 0.2], [-L * 0.15, Wd * 0.2]];
    }
    // occupants: driver first, then passengers
    if (!dead) {
      const who = v.driver ? [v.driver].concat(v.passengers) : v.passengers;
      who.forEach((a, i) => {
        const st = seats[i]; if (!st) return;
        ctx.fillStyle = a.color; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(st[0], st[1], 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }
    if (d.id === 'buggy') { // roll cage over the heads
      ctx.strokeStyle = dead ? '#1c1c1e' : '#2a2c33'; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(-L * 0.3, -Wd / 2 + 6); ctx.lineTo(L * 0.2, -Wd / 2 + 6); ctx.moveTo(-L * 0.3, Wd / 2 - 6); ctx.lineTo(L * 0.2, Wd / 2 - 6);
      ctx.moveTo(-L * 0.3, -Wd / 2 + 6); ctx.lineTo(-L * 0.3, Wd / 2 - 6); ctx.moveTo(L * 0.2, -Wd / 2 + 6); ctx.lineTo(L * 0.2, Wd / 2 - 6); ctx.stroke();
    } else if (d.id === 'sedan') { ctx.fillStyle = body; this.rr(ctx, -L * 0.17, -Wd / 2 + 8, L * 0.2, Wd - 16, 4); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fill(); }
    if (!dead) {
      ctx.fillStyle = '#fff3b0'; for (const s of [-1, 1]) ctx.fillRect(L / 2 - 5, s * (Wd / 2 - 9) - 3.5, 4, 7);
      ctx.fillStyle = v.speed < -5 ? '#ffffff' : '#d8362c'; for (const s of [-1, 1]) ctx.fillRect(-L / 2 + 1, s * (Wd / 2 - 9) - 3.5, 3, 7);
    }
    ctx.restore();
    if (dead) return;
    const p = game.player, mine = v.driver && v.driver.team === p.team;
    if (mine && p.car !== v) { ctx.strokeStyle = 'rgba(127,245,122,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(v.x, v.y, v.r + 9, 0, Math.PI * 2); ctx.stroke(); }
    const top = v.y - Math.max(L, Wd) / 2 - 6;
    if (v.hp < v.maxHp && (v.driver || game.time - v.lastDamaged < 5)) {
      const bw = 52, bx = v.x - bw / 2, k = v.hp / v.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, top - 5, bw, 5);
      ctx.fillStyle = k > 0.4 ? '#e8c94a' : '#e05a4a'; ctx.fillRect(bx, top - 5, bw * k, 5);
    }
    if (v.driver) this.label(ctx, v.driver.isPlayer ? 'You' : v.driver.name + (v.passengers.length ? ' +' + v.passengers.length : ''), v.x, top - 10, '12px', mine && !v.driver.isPlayer ? '#9dff98' : null);
    else if (p.alive && !p.car && U.dist(v.x, v.y, p.x, p.y) < 200) this.label(ctx, v.name, v.x, top - 4, '12px', '#ffe08a');
  }
  drawRoads(ctx, world, m, x0, y0, x1, y1) {
    const hit = world.roads.filter((r) => r.x < x1 + 8 && r.x + r.w > x0 - 8 && r.y < y1 + 8 && r.y + r.h > y0 - 8);
    if (!hit.length) return;
    ctx.save();
    if (world.shape === 'circle') { ctx.beginPath(); ctx.arc(world.w / 2, world.h / 2, world.islandR + 5, 0, Math.PI * 2); ctx.clip(); }
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; // verge, then the surface on top so junctions come out clean
    for (const r of hit) ctx.fillRect(r.x - (r.horiz ? 0 : 6), r.y - (r.horiz ? 6 : 0), r.w + (r.horiz ? 0 : 12), r.h + (r.horiz ? 12 : 0));
    ctx.fillStyle = m.road || '#56585e';
    for (const r of hit) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = m.roadLine || 'rgba(255,255,255,0.38)'; ctx.lineWidth = 4; ctx.lineCap = 'butt'; ctx.setLineDash([36, 32]);
    ctx.beginPath();
    for (const r of hit) { if (r.horiz) { ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2); } else { ctx.moveTo(r.x + r.w / 2, r.y); ctx.lineTo(r.x + r.w / 2, r.y + r.h); } }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  // Campaign objective markers: a pulsing ring on the ground at each one.
  drawCampaign(ctx, game) {
    const t = game.time, st = Campaign.stage(game);
    if (st && st.type === 'survive' && game.world.sites.beacon) {
      const b = game.world.sites.beacon, a = t * 1.4;
      for (const d of [0, Math.PI]) {
        const g = ctx.createRadialGradient(b.x, b.y, 10, b.x, b.y, 620);
        g.addColorStop(0, 'rgba(255,240,170,0.5)'); g.addColorStop(1, 'rgba(255,240,170,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, 620, a + d - 0.16, a + d + 0.16); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,244,190,0.95)'; ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.fill();
    }
    for (const m of Campaign.marks(game)) {
      const col = m.hot ? '255,90,80' : '242,182,50', pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.fillStyle = 'rgba(' + col + ',' + (0.06 + 0.05 * pulse) + ')'; ctx.strokeStyle = 'rgba(' + col + ',0.9)'; ctx.lineWidth = 3.5;
      ctx.setLineDash([14, 10]); ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r + pulse * 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      if (m.label) this.label(ctx, m.label, m.x, m.y - m.r - 12, 'bold 14px', m.hot ? '#ff8a80' : '#ffd98a');
    }
  }
  // ...and an arrow on the edge of the screen for any that are out of view.
  drawCampaignArrows(ctx, game, W, H, s, marks) {
    const f = game.cameraTarget();
    for (const m of marks || Campaign.marks(game)) {
      const sx = (m.x - this.camX) * s + W / 2, sy = (m.y - this.camY) * s + H / 2, pad = 70, padT = 125, padB = 205; // clear of the top bar and the weapon slots
      if (sx > pad && sx < W - pad && sy > padT && sy < H - padB) continue;
      const ang = Math.atan2(sy - H / 2, sx - W / 2);
      const k = Math.min((W / 2 - pad) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - (sy < H / 2 ? padT : padB)) / Math.abs(Math.sin(ang) || 1e-6));
      const x = W / 2 + Math.cos(ang) * k, y = H / 2 + Math.sin(ang) * k;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = m.hot ? '#ff6b5e' : '#f2b632'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      this.label(ctx, (m.label ? m.label + ' ' : '') + Math.round(U.dist(f.x, f.y, m.x, m.y) / 50) + 'm', x - Math.cos(ang) * 34, y - Math.sin(ang) * 34 + 4, '12px', m.hot ? '#ff8a80' : '#ffd98a');
    }
  }
  // Compound walls and the gate a breaching charge takes off.
  drawWall(ctx, o) {
    const { x, y, w, h } = o;
    ctx.fillStyle = o.color; ctx.fillRect(x, y, w, h);
    if (o.kind === 'gate') {
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 7; ctx.beginPath();
      for (let i = -h; i < w + h; i += 22) { ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); }
      ctx.stroke(); ctx.restore();
    } else { ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(x + 4, y + 4, w - 8, h - 8); }
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
  }

  // ---- custom-map pieces (campaign)
  drawTent(ctx, o) {
    const { x, y, w, h } = o, horiz = w >= h;
    ctx.fillStyle = o.color; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; if (horiz) ctx.fillRect(x, y, w, h / 2); else ctx.fillRect(x, y, w / 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; if (horiz) ctx.fillRect(x, y + h / 2, w, h / 2); else ctx.fillRect(x + w / 2, y, w / 2, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2.5; ctx.strokeRect(x, y, w, h);
    ctx.beginPath(); if (horiz) { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); } else { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); } ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { ctx.moveTo(cx, cy); ctx.lineTo(cx + (cx === x ? -10 : 10), cy + (cy === y ? -10 : 10)); }
    ctx.stroke();
  }
  drawConsole(ctx, o) {
    const { x, y, w, h } = o;
    ctx.fillStyle = '#23262d'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#0c0d10'; ctx.lineWidth = 2.5; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#3ddc84'; ctx.fillRect(x + 6, y + 5, w * 0.5, h - 10);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 9, y + 8 + i * 5, w * 0.5 - 6 - i * 6, 2);
    ctx.fillStyle = '#f2b632'; ctx.fillRect(x + w - 16, y + 6, 5, 5); ctx.fillStyle = '#ff5252'; ctx.fillRect(x + w - 16, y + h - 11, 5, 5);
  }
  drawSandbag(ctx, o) {
    const { x, y, w, h } = o, horiz = w >= h, n = Math.max(1, Math.round((horiz ? w : h) / 30));
    ctx.fillStyle = '#b39a6b'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const bx = horiz ? x + (w / n) * i : x, by = horiz ? y : y + (h / n) * i, bw = horiz ? w / n : w, bh = horiz ? h : h / n;
      this.rr(ctx, bx + 1, by + 1, bw - 2, bh - 2, 7); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; if (horiz) ctx.fillRect(x + 4, y + 3, w - 8, h * 0.3); else ctx.fillRect(x + 3, y + 4, w * 0.3, h - 8);
  }
  // Radio mast / watch tower: a concrete pad, a braced lattice and a warning light.
  drawTower(ctx, o) {
    const { x, y, r } = o;
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x - r + 8, y - r + 10, r * 2, r * 2);
    ctx.fillStyle = '#8d9197'; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2.5; ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    const k = r * 0.68;
    ctx.strokeStyle = '#2a2d33'; ctx.lineWidth = 4; ctx.strokeRect(x - k, y - k, k * 2, k * 2);
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke();
    ctx.strokeStyle = 'rgba(42,45,51,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(x - k * 0.5, y - k * 0.5, k, k);
    ctx.fillStyle = 'rgba(255,60,60,0.35)'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  drawTank(ctx, o) {
    const { x, y, r } = o;
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.35, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9aa1a8'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d4a017'; ctx.fillRect(x - r * 0.55, y + r * 0.25, r * 1.1, r * 0.22);
    ctx.fillStyle = '#3a3d44'; ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }
  drawBeacon(ctx, o) {
    const { x, y, r } = o;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.35, r * 1.05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e4da'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(x, y, r * 0.76, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e4da'; ctx.beginPath(); ctx.arc(x, y, r * 0.52, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2d33'; ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a8f96'; ctx.beginPath(); ctx.arc(x, y, r * 0.18, 0, Math.PI * 2); ctx.fill();
  }
  drawFountain(ctx, o) {
    const { x, y, r } = o;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + 5, y + 7, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a7a9ad'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#4f9fd0'; ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a7a9ad'; ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // Floors, flat props (helipads, campfires) and the place names painted on the ground.
  drawGroundExtras(ctx, world, m, x0, y0, x1, y1) {
    for (const p of world.pads) { if (p.x > x1 || p.x + p.w < x0 || p.y > y1 || p.y + p.h < y0) continue; ctx.fillStyle = p.color || 'rgba(40,42,48,0.55)'; ctx.fillRect(p.x, p.y, p.w, p.h); }
    for (const p of world.props) {
      if (p.x - p.r > x1 || p.x + p.r < x0 || p.y - p.r > y1 || p.y + p.r < y0) continue;
      if (p.kind === 'helipad') {
        ctx.fillStyle = 'rgba(50,52,58,0.75)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.82, 0, Math.PI * 2); ctx.stroke();
        const k = p.r * 0.34; ctx.lineWidth = 9; ctx.lineCap = 'butt'; ctx.beginPath();
        ctx.moveTo(p.x - k, p.y - k * 1.25); ctx.lineTo(p.x - k, p.y + k * 1.25); ctx.moveTo(p.x + k, p.y - k * 1.25); ctx.lineTo(p.x + k, p.y + k * 1.25); ctx.moveTo(p.x - k, p.y); ctx.lineTo(p.x + k, p.y); ctx.stroke();
      } else if (p.kind === 'crater') {
        this.drawCrater(ctx, p.x, p.y, p.r);
      } else if (p.kind === 'fire') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7d7f84'; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r, 6, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ff8a2a'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.32, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = m.labelColor || 'rgba(255,255,255,0.22)';
    for (const l of world.labels) {
      const half = l.text.length * l.size * 0.38;
      if (l.x - half > x1 || l.x + half < x0 || l.y - l.size > y1 || l.y + l.size < y0) continue;
      ctx.font = '900 ' + l.size + 'px "Segoe UI", sans-serif'; ctx.fillText(l.text, l.x, l.y);
    }
  }
  // Briefing screen: the mission's map with its place names and the start marker.
  drawBriefMap(canvas, world) {
    const c = canvas.getContext && canvas.getContext('2d'); if (!c) return;
    const S = canvas.width, k = S / world.w;
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.drawMinimapBase(c, world, S);
    c.fillStyle = 'rgba(120,125,135,0.5)'; for (const p of world.pads) c.fillRect(p.x * k, p.y * k, p.w * k, p.h * k);
    c.fillStyle = '#2c2f36'; for (const o of world.obstacles) if (o.type === 'rect' && o.kind !== 'crate') c.fillRect(o.x * k, o.y * k, Math.max(1.5, o.w * k), Math.max(1.5, o.h * k));
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 11px "Segoe UI", sans-serif'; c.lineWidth = 3;
    for (const l of world.labels) {
      const x = U.clamp(l.x * k, 46, S - 46), y = U.clamp(l.y * k, 10, S - 10);
      c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(l.text, x, y); c.fillStyle = '#ffd98a'; c.fillText(l.text, x, y);
    }
    const s = world.sites && world.sites.start;
    if (s) { c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(s.x * k, s.y * k, 5.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
  }

  drawRect(ctx, o) {
    const { x, y, w, h } = o;
    // soft drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + 12, y + 14, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + 6, y + 8, w, h);
    if (o.kind === 'building') this.drawBuilding(ctx, o); else if (o.kind === 'wall' || o.kind === 'gate') this.drawWall(ctx, o);
    else if (o.kind === 'tent') this.drawTent(ctx, o); else if (o.kind === 'console') this.drawConsole(ctx, o); else if (o.kind === 'sandbag') this.drawSandbag(ctx, o);
    else this.drawCrate(ctx, o);
  }
  drawBuilding(ctx, o) {
    const { x, y, w, h } = o, seed = this.hash(x, y, 1), wall = o.color;
    // walls (what you see from above is a thin band of wall around the roof)
    ctx.fillStyle = this.shade(wall, 0.72); ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
    const in_ = 9, rx = x + in_, ry = y + in_, rw = w - in_ * 2, rh = h - in_ * 2;
    const gable = seed < 0.6 && Math.min(w, h) > 90;
    if (gable) {
      // pitched roof: two slopes meeting at a ridge along the long axis
      const horiz = w >= h;
      const light = this.shade(wall, 1.18), dark = this.shade(wall, 0.9);
      ctx.beginPath();
      if (horiz) { ctx.moveTo(rx, ry); ctx.lineTo(rx + rw, ry); ctx.lineTo(rx + rw, ry + rh / 2); ctx.lineTo(rx, ry + rh / 2); }
      else { ctx.moveTo(rx, ry); ctx.lineTo(rx + rw / 2, ry); ctx.lineTo(rx + rw / 2, ry + rh); ctx.lineTo(rx, ry + rh); }
      ctx.closePath(); ctx.fillStyle = light; ctx.fill();
      ctx.beginPath();
      if (horiz) { ctx.moveTo(rx, ry + rh / 2); ctx.lineTo(rx + rw, ry + rh / 2); ctx.lineTo(rx + rw, ry + rh); ctx.lineTo(rx, ry + rh); }
      else { ctx.moveTo(rx + rw / 2, ry); ctx.lineTo(rx + rw, ry); ctx.lineTo(rx + rw, ry + rh); ctx.lineTo(rx + rw / 2, ry + rh); }
      ctx.closePath(); ctx.fillStyle = dark; ctx.fill();
      // ridge and shingle lines
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.beginPath();
      if (horiz) { ctx.moveTo(rx, ry + rh / 2); ctx.lineTo(rx + rw, ry + rh / 2); } else { ctx.moveTo(rx + rw / 2, ry); ctx.lineTo(rx + rw / 2, ry + rh); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.beginPath();
      if (horiz) for (let yy = ry + 14; yy < ry + rh - 4; yy += 14) { if (Math.abs(yy - (ry + rh / 2)) < 7) continue; ctx.moveTo(rx, yy); ctx.lineTo(rx + rw, yy); }
      else for (let xx = rx + 14; xx < rx + rw - 4; xx += 14) { if (Math.abs(xx - (rx + rw / 2)) < 7) continue; ctx.moveTo(xx, ry); ctx.lineTo(xx, ry + rh); }
      ctx.stroke();
    } else {
      // flat roof with a parapet, a vent unit and a skylight
      ctx.fillStyle = this.shade(wall, 1.05); ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(rx, ry, rw, rh * 0.5);
      const ux = rx + rw * (0.15 + this.hash(x, y, 2) * 0.5), uy = ry + rh * (0.15 + this.hash(x, y, 3) * 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(ux + 4, uy + 5, 26, 18);
      ctx.fillStyle = this.shade(wall, 0.8); ctx.fillRect(ux, uy, 26, 18); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.strokeRect(ux, uy, 26, 18);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(ux + 13, uy + 9, 5, 0, Math.PI * 2); ctx.fill();
      if (rw > 80 && rh > 80) {
        const kx = rx + rw * (0.55 + this.hash(x, y, 4) * 0.25), ky = ry + rh * (0.55 + this.hash(x, y, 5) * 0.25);
        ctx.fillStyle = 'rgba(150,200,240,0.55)'; ctx.fillRect(kx, ky, 22, 22); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.strokeRect(kx, ky, 22, 22);
      }
    }
    // a door on one wall
    const side = Math.floor(this.hash(x, y, 6) * 4), dw = 16, dd = 7;
    ctx.fillStyle = 'rgba(30,25,20,0.85)';
    if (side === 0) ctx.fillRect(x + w * 0.3 + this.hash(x, y, 7) * w * 0.4, y + h - dd, dw, dd);
    else if (side === 1) ctx.fillRect(x + w * 0.3 + this.hash(x, y, 7) * w * 0.4, y, dw, dd);
    else if (side === 2) ctx.fillRect(x, y + h * 0.3 + this.hash(x, y, 7) * h * 0.4, dd, dw);
    else ctx.fillRect(x + w - dd, y + h * 0.3 + this.hash(x, y, 7) * h * 0.4, dd, dw);
  }
  drawCrate(ctx, o) {
    const { x, y, w, h } = o;
    ctx.fillStyle = o.color; ctx.fillRect(x, y, w, h);
    // planks
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo(x, y + (h * i) / 4); ctx.lineTo(x + w, y + (h * i) / 4); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, h / 4);
    // metal band and corner bolts
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (const [bx, by] of [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) { ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, Math.PI * 2); ctx.fill(); }
  }
  drawCircleOb(ctx, o) {
    if (o.kind === 'tree') this.drawTree(ctx, o); else if (o.kind === 'tower') this.drawTower(ctx, o); else if (o.kind === 'tank') this.drawTank(ctx, o);
    else if (o.kind === 'beacon') this.drawBeacon(ctx, o); else if (o.kind === 'fountain') this.drawFountain(ctx, o); else this.drawRock(ctx, o);
  }
  // Trees: a cluster of canopy clumps outlined once, a darker core, and a highlight catching the light.
  drawTree(ctx, o) {
    if (!o.shape) {
      const n = 5 + Math.floor(this.hash(o.x, o.y, 1) * 3), clumps = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + this.hash(o.x, o.y, 10 + i) * 0.6, d = o.r * (0.45 + this.hash(o.x, o.y, 20 + i) * 0.2); clumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: o.r * (0.5 + this.hash(o.x, o.y, 30 + i) * 0.15) }); }
      o.shape = clumps;
    }
    const r = o.r, sx = o.x + r * 0.35, sy = o.y + r * 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.arc(sx, sy, r * 1.02, 0, Math.PI * 2); ctx.fill();
    // outline pass, then fill pass: overlapping clumps read as one organic canopy
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 5;
    for (const c of o.shape) { ctx.beginPath(); ctx.arc(o.x + c.x, o.y + c.y, c.r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = o.color;
    for (const c of o.shape) { ctx.beginPath(); ctx.arc(o.x + c.x, o.y + c.y, c.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.arc(o.x, o.y, r * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.arc(o.x + r * 0.12, o.y + r * 0.15, r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.treeHighlight || 'rgba(120,200,110,0.35)';
    for (const c of o.shape) { ctx.beginPath(); ctx.arc(o.x + c.x - c.r * 0.25, o.y + c.y - c.r * 0.3, c.r * 0.42, 0, Math.PI * 2); ctx.fill(); }
  }
  // Rocks: an irregular polygon with a lit top-left facet and a crack.
  drawRock(ctx, o) {
    if (!o.shape) {
      const n = 6 + Math.floor(this.hash(o.x, o.y, 1) * 3), pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, d = o.r * (0.8 + this.hash(o.x, o.y, 40 + i) * 0.25); pts.push({ x: Math.cos(a) * d, y: Math.sin(a) * d }); }
      o.shape = pts;
    }
    const r = o.r, pts = o.shape;
    const poly = (ox, oy, k) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(o.x + ox + p.x * k, o.y + oy + p.y * k) : ctx.moveTo(o.x + ox + p.x * k, o.y + oy + p.y * k))); ctx.closePath(); };
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; poly(r * 0.3, r * 0.4, 1); ctx.fill();
    ctx.fillStyle = o.color; poly(0, 0, 1); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; poly(-r * 0.12, -r * 0.14, 0.62); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; poly(r * 0.18, r * 0.2, 0.55); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(o.x - r * 0.1, o.y - r * 0.6); ctx.lineTo(o.x + r * 0.1, o.y - r * 0.15); ctx.lineTo(o.x - r * 0.05, o.y + r * 0.25); ctx.stroke();
  }
  // Sparse grass tufts, pebbles or sparkles, one or two per 100px cell, stable per cell.
  drawGroundDetail(ctx, m, world, vx0, vy0, vx1, vy1) {
    if (!m.tuft) return;
    ctx.strokeStyle = m.tuft; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath();
    const cx0 = Math.max(0, Math.floor(vx0 / 100)), cx1 = Math.min(Math.floor(world.w / 100), Math.floor(vx1 / 100));
    const cy0 = Math.max(0, Math.floor(vy0 / 100)), cy1 = Math.min(Math.floor(world.h / 100), Math.floor(vy1 / 100));
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const h0 = this.hash(cx, cy, 0); if (h0 < 0.45) continue;
      const x = cx * 100 + this.hash(cx, cy, 1) * 90 + 5, y = cy * 100 + this.hash(cx, cy, 2) * 90 + 5;
      if (x < 10 || y < 10 || x > world.w - 10 || y > world.h - 10 || !world.inBounds(x, y, 20)) continue;
      const k = 1 + this.hash(cx, cy, 3);
      if (m.tuftKind === 'dots') { // pebbles on sand and pavement, sparkle on snow
        for (let i = 0; i < 3; i++) { const dx = (this.hash(cx, cy, 10 + i) - 0.5) * 24, dy = (this.hash(cx, cy, 20 + i) - 0.5) * 24, rr = 1.2 + this.hash(cx, cy, 30 + i) * 1.6; ctx.moveTo(x + dx + rr, y + dy); ctx.arc(x + dx, y + dy, rr, 0, Math.PI * 2); }
      } else {
        ctx.moveTo(x, y + 3 * k); ctx.lineTo(x - 3 * k, y - 4 * k);
        ctx.moveTo(x, y + 3 * k); ctx.lineTo(x + 1 * k, y - 5 * k);
        ctx.moveTo(x, y + 3 * k); ctx.lineTo(x + 4 * k, y - 3 * k);
      }
    }
    if (m.tuftKind === 'dots') { ctx.fillStyle = m.tuft; ctx.fill(); } else ctx.stroke();
  }
  // Fog mutator: a tinted haze with two layers of drifting cloud, cut open around the camera with a soft edge
  // that is dented by slow-moving holes so the clearing breathes instead of being a hard disc.
  drawFog(ctx, game, W, H, s, k = 1) {
    if (!this.fogSprite) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext && c.getContext('2d'); if (!g) return;
      const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      this.fogSprite = c;
      this.fogBlobs = []; for (let i = 0; i < 70; i++) this.fogBlobs.push({ x: Math.random() * 2400, y: Math.random() * 1600, r: 140 + Math.random() * 260, a: 0.25 + Math.random() * 0.5, l: i % 2 });
      this.fogHoles = []; for (let i = 0; i < 7; i++) this.fogHoles.push({ a: (i / 7) * Math.PI * 2, sp: 0.15 + Math.random() * 0.25, r: 90 + Math.random() * 90, ph: Math.random() * 7 });
    }
    if (!this.fogLayer || this.fogLayer.width !== W || this.fogLayer.height !== H) { this.fogLayer = document.createElement('canvas'); this.fogLayer.width = W; this.fogLayer.height = H; }
    const f = this.fogLayer.getContext && this.fogLayer.getContext('2d'); if (!f) return;
    const m = game.world.map, tint = m.fog || '#c9d1d8', t = game.time;
    f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = 'source-over'; f.globalAlpha = 1;
    f.fillStyle = tint; f.fillRect(0, 0, W, H);
    // drifting cloud layers, parallax against the camera so the mist feels anchored to the world
    const spr = this.fogSprite;
    for (const b of this.fogBlobs) {
      const par = b.l ? 0.35 : 0.6, drift = b.l ? 18 : 30;
      let x = (b.x + t * drift - this.camX * s * par) % 2400, y = (b.y + Math.sin(t * 0.2 + b.x) * 20 - this.camY * s * par) % 1600;
      if (x < 0) x += 2400; if (y < 0) y += 1600;
      x -= 400; y -= 350;
      if (x < -b.r || y < -b.r || x > W + b.r || y > H + b.r) continue;
      f.globalAlpha = b.a * (b.l ? 0.6 : 1);
      f.drawImage(spr, x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
    // clear the visible pocket around the camera
    f.globalCompositeOperation = 'destination-out'; f.globalAlpha = 1;
    const cx = W / 2, cy = H / 2, r0 = 190 * s, r1 = 480 * s;
    const g = f.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = g; f.fillRect(0, 0, W, H);
    for (const h of this.fogHoles) {
      const a = h.a + t * h.sp, d = r1 * (0.55 + 0.25 * Math.sin(t * 0.7 + h.ph));
      const hx = cx + Math.cos(a) * d, hy = cy + Math.sin(a) * d, hr = h.r * s;
      const hg = f.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hg.addColorStop(0, 'rgba(0,0,0,0.9)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = hg; f.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    }
    // far away it is solid; the layer is composited at slightly under full strength so shapes still ghost through
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = 0.93 * k; ctx.drawImage(this.fogLayer, 0, 0); ctx.globalAlpha = 1;
  }

  drawLoot(ctx, l, game) {
    const y = l.y + Math.sin(game.time * 3 + l.seed) * 2;
    const gr = ctx.createRadialGradient(l.x, y, l.r * 0.6, l.x, y, l.r + 14);
    gr.addColorStop(0, l.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.28 + 0.1 * Math.sin(game.time * 4 + l.seed); ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(l.x, y, l.r + 14, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(l.x + 2, y + 3, l.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(22,24,30,0.92)'; ctx.strokeStyle = l.color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(l.x, y, l.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.translate(l.x, y); ctx.fillStyle = l.color;
    switch (l.kind) {
      case 'weapon': ctx.rotate(-0.6); ctx.fillRect(-10, -2, 20, 4); ctx.fillRect(-4, 0, 4, 7); ctx.fillRect(5, -5, 3, 3); break;
      case 'ammo': for (const i of [-6, 0, 6]) ctx.fillRect(i - 2, -6, 4, 12); break;
      case 'medkit': ctx.fillRect(-3, -8, 6, 16); ctx.fillRect(-8, -3, 16, 6); break;
      case 'shield':
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(8, -5); ctx.lineTo(7, 3); ctx.lineTo(0, 9); ctx.lineTo(-7, 3); ctx.lineTo(-8, -5); ctx.closePath(); ctx.fill();
        break;
    }
    ctx.restore();
    if (game.player.alive && U.dist(l.x, l.y, game.player.x, game.player.y) < 130) {
      this.label(ctx, l.label, l.x, y - l.r - 8, '12px');
    }
  }

  label(ctx, text, x, y, size, color) {
    ctx.font = 'bold ' + size + ' "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color || 'rgba(255,255,255,0.95)'; ctx.fillText(text, x, y);
  }

  drawActor(ctx, a, game, preview) {
    const w = a.weapon, sk = a.skin;
    const u = a.r / 18; // everything is drawn relative to the body, so a big preview is as clean as the in-match sprite
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.ellipse(a.x + 4 * u, a.y + 7 * u, a.r * 1.08, a.r * 0.88, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(a.x + 4 * u, a.y + 7 * u, a.r * 0.92, a.r * 0.74, 0, 0, Math.PI * 2); ctx.fill();
    if (sk && sk.aura) {
      const pulse = Math.sin(game.time * 5);
      ctx.strokeStyle = sk.aura; ctx.lineWidth = 4 * u; ctx.globalAlpha = 0.55 + 0.3 * pulse;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r + (5 + pulse * 2) * u, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.angle);
    if (w) { // a gun with a shape: receiver, barrel, muzzle and a stripe in the weapon's colour
      const len = ({ pistol: 22, smg: 28, shotgun: 34, rifle: 36, sniper: 48, rocket: 40, lmg: 42 }[w.key] || 28) * u;
      const thick = (w.key === 'rocket' ? 14 : 8) * u, x0 = a.r * 0.4, body = w.key === 'rocket' ? len : len * 0.62;
      ctx.strokeStyle = '#0e0f13'; ctx.lineWidth = 2 * u;
      if (w.key !== 'rocket') { this.rr(ctx, x0 + body - 2 * u, -thick * 0.28, len - body + 2 * u, thick * 0.56, thick * 0.2); ctx.fillStyle = '#16171c'; ctx.fill(); ctx.stroke(); }
      this.rr(ctx, x0, -thick / 2, body, thick, thick * 0.3); ctx.fillStyle = '#2a2d35'; ctx.fill(); ctx.stroke();
      this.rr(ctx, x0 + body * 0.34, -thick / 2 + 1.4 * u, body * 0.4, thick - 2.8 * u, thick * 0.2); ctx.fillStyle = w.color; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x0 + 2 * u, -thick / 2 + 1.2 * u, body - 4 * u, thick * 0.2);
      if (w.key === 'rocket') { ctx.fillStyle = '#c62828'; this.rr(ctx, x0 + len - 5 * u, -thick * 0.38, 7 * u, thick * 0.76, thick * 0.3); ctx.fill(); ctx.stroke(); }
    }
    const z = a.zombie;
    ctx.fillStyle = a.color; ctx.strokeStyle = z ? '#1a2416' : '#15171c'; ctx.lineWidth = 2.5 * u;
    // zombies reach forward with clawed hands and lunge when they bite
    const hand = a.r * 0.85 + (z ? (a.lunge > 0 ? 13 : 6) * u : 0), hr = z ? a.r * 0.38 : 6.2 * u;
    for (const side of [-1, 1]) {
      ctx.fillStyle = a.color; ctx.beginPath(); ctx.arc(hand, side * a.r * 0.55, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(hand - hr * 0.25, side * a.r * 0.55 - hr * 0.3, hr * 0.38, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, a.r, 0, Math.PI * 2);
    ctx.fillStyle = a.flash > 0 ? '#ff7070' : a.color; ctx.fill();
    // Layers, bottom to top: body colour, the skin's pattern, shading (a highlight up and to the left that does not turn
    // with the body), one clean outline, and only then the face, hat, ears and horns, so nothing is drawn across them.
    if (sk && !z) this.drawSkin(ctx, a, sk, 'pattern');
    const gl = this.glossSprite();
    if (gl) { ctx.save(); ctx.rotate(-a.angle); ctx.drawImage(gl, -a.r, -a.r, a.r * 2, a.r * 2); ctx.restore(); }
    ctx.strokeStyle = z ? '#1a2416' : '#15171c'; ctx.lineWidth = 2.6 * u; ctx.beginPath(); ctx.arc(0, 0, a.r, 0, Math.PI * 2); ctx.stroke();
    if (z) {
      ctx.fillStyle = z.eyes || '#ff3030';
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(a.r * 0.45, side * a.r * 0.28, a.r * 0.13, 0, Math.PI * 2); ctx.fill(); }
    } else if (sk) {
      this.drawSkin(ctx, a, sk, 'hat');
      if (!sk.eyes && !sk.hat) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(a.r * 0.45, 0, a.r * 0.28, 0, Math.PI * 2); ctx.fill(); }
    } else { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(a.r * 0.45, 0, 5 * u, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    if (preview) return;

    // progress rings: reload (white) / heal (green)
    if (w && w.reloading) this.ring(ctx, a, 1 - w.reloadT / (w.reloadTotal || w.reload), 'rgba(255,255,255,0.9)');
    if (a.healing > 0) this.ring(ctx, a, 1 - a.healing / 2.5, 'rgba(120,255,120,0.9)');
    if (game.mode && (game.mode.type === 'bomb' || game.mode.type === 'campaign')) this.drawActionRing(ctx, a, game);
    if (a.invuln > 0) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(game.time * 30); this.ring(ctx, a, 1, '#ffd84d'); ctx.globalAlpha = 1; }

    const mate = !a.isPlayer && a.team === game.player.team;
    if (mate) { ctx.strokeStyle = 'rgba(127,245,122,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 5, 0, Math.PI * 2); ctx.stroke(); }
    if (a.poison > 0) { ctx.strokeStyle = 'rgba(140,255,60,' + (0.5 + 0.4 * Math.sin(game.time * 9)) + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 3, 0, Math.PI * 2); ctx.stroke(); }
    const brute = (z && z.id === 'brute') || !!a.boss; // bosses get the same always-on name and health bar
    const army = !!game.war && !a.isPlayer && !brute; // 80 soldiers: no name tags, health bars only when hit
    if ((!z || brute) && !army) this.label(ctx, a.isPlayer ? 'You' : a.name, a.x, a.y - a.r - 16, '12px', mate ? '#9dff98' : brute ? '#ff8a80' : null);
    if (!a.isPlayer && ((mate && !army) || brute || game.time - a.lastDamaged < 4)) {
      const bw = brute ? 60 : 44, bx = a.x - bw / 2, by = a.y - a.r - 12;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = z ? '#e05a4a' : '#5ee05a'; ctx.fillRect(bx, by, bw * (a.hp / a.maxHp), 5);
      if (a.shield > 0) { ctx.fillStyle = '#5fb3ff'; ctx.fillRect(bx, by - 4, bw * (a.shield / a.maxShield), 3); }
    }
  }
  // A cached shading overlay for round bodies: highlight, falloff toward the rim.
  glossSprite() {
    if (this._gloss !== undefined) return this._gloss;
    this._gloss = null;
    try {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext && c.getContext('2d'); if (!g || !g.createRadialGradient || !c.toDataURL) return null;
      g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.clip();
      let gr = g.createRadialGradient(64, 64, 34, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.32)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      gr = g.createRadialGradient(84, 90, 10, 84, 90, 80); gr.addColorStop(0, 'rgba(0,0,0,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      gr = g.createRadialGradient(44, 40, 2, 44, 40, 52); gr.addColorStop(0, 'rgba(255,255,255,0.42)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      this._gloss = c;
    } catch (e) { this._gloss = null; }
    return this._gloss;
  }
  // Skin layers in the actor's local space (facing +x), drawn over the body fill.
  drawSkin(ctx, a, s, part) { // part: 'pattern' (under the shading), 'hat' (face and features, on top), or both
    const r = a.r, u = r / 18;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const fr = (x, y, w, h) => { this.rr(ctx, x, y, w, h, Math.min(Math.abs(w), Math.abs(h)) * 0.3); ctx.fill(); };
    // An ear, horn or wing growing out of the rim: th = angle from straight ahead, half = half its width (both radians),
    // len = how far it stands out (in radii). Curved sides, no seam where it joins the head.
    const ear = (side, th, half, len, fill, inner, tip) => {
      const at = (ang, rad) => [Math.cos(side * ang) * r * rad, Math.sin(side * ang) * r * rad];
      const shape = (hw, ln, base) => {
        const [x0, y0] = at(th - hw, base), [x1, y1] = at(th + hw, base), [xt, yt] = at(th, 1 + ln), [ax, ay] = at(th - hw * 0.55, 1 + ln * 0.62), [bx, by] = at(th + hw * 0.55, 1 + ln * 0.62);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(ax, ay, xt, yt); ctx.quadraticCurveTo(bx, by, x1, y1);
      };
      shape(half, len, 0.93); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5 * u; ctx.stroke();
      if (inner) { shape(half * 0.5, len * 0.62, 0.99); ctx.fillStyle = inner; ctx.fill(); }
      if (tip) { const [x0, y0] = at(th - half * 0.34, 1 + len * 0.5), [x1, y1] = at(th + half * 0.34, 1 + len * 0.5), [xt, yt] = at(th, 1 + len * 0.9); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(xt, yt); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fillStyle = tip; ctx.fill(); }
    };
    if (s.pattern && part !== 'hat') {
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = s.accent; ctx.strokeStyle = s.accent;
      switch (s.pattern) {
        case 'stripes': for (const x of [-0.55, 0, 0.55]) ctx.fillRect(x * r - r * 0.13, -r, r * 0.26, r * 2); break;
        case 'halves': ctx.fillRect(-r, 0, r * 2, r); break;
        case 'ring': ctx.lineWidth = r * 0.18; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke(); break;
        case 'target': ctx.lineWidth = r * 0.16; for (const k of [0.35, 0.75]) { ctx.beginPath(); ctx.arc(0, 0, r * k, 0, Math.PI * 2); ctx.stroke(); } break;
        case 'spots': for (const [x, y, k] of [[-0.45, -0.4, 0.28], [0.2, -0.55, 0.22], [-0.1, 0.15, 0.3], [0.5, 0.35, 0.24], [-0.55, 0.5, 0.2]]) { ctx.beginPath(); ctx.arc(x * r, y * r, k * r, 0, Math.PI * 2); ctx.fill(); } break;
        case 'stars': for (const [x, y, k] of [[-0.5, -0.3, 0.09], [0.1, -0.6, 0.07], [-0.2, 0.2, 0.1], [0.45, 0.4, 0.06], [-0.6, 0.55, 0.07], [0.3, -0.1, 0.05]]) { ctx.beginPath(); ctx.arc(x * r, y * r, k * r, 0, Math.PI * 2); ctx.fill(); } break;
      }
      ctx.restore();
    }
    if (part === 'pattern') return;
    switch (s.hat) {
      case 'crown': {
        ctx.fillStyle = s.accent; ctx.beginPath();
        for (let i = 0; i < 10; i++) { const ang = (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.3 : r * 0.55; ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
        ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 1.5 * u; ctx.stroke(); break;
      }
      case 'helmet':
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.arc(0, 0, r - 1, Math.PI * 0.35, Math.PI * 1.65); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; fr(r * 0.25, -r * 0.55, r * 0.3, r * 1.1); break;
      case 'horns':
        ctx.fillStyle = s.accent;
        for (const side of [-1, 1]) ear(side, 1.05, 0.2, 0.5, '#e9dfc8');
        break;
      case 'halo':
        ctx.strokeStyle = s.accent; ctx.lineWidth = 3 * u; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(-r * 0.15, 0, r * 0.72, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; break;
      case 'smile': {
        ctx.fillStyle = s.accent; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.38, side * r * 0.32, r * 0.11, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = s.accent; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(r * 0.3, 0, r * 0.46, -Math.PI * 0.38, Math.PI * 0.38); ctx.stroke(); break;
      }
      case 'angry': {
        ctx.fillStyle = s.accent; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.4, side * r * 0.3, r * 0.11, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = s.accent; ctx.lineWidth = r * 0.11; ctx.lineCap = 'round'; ctx.beginPath();
        for (const side of [-1, 1]) { ctx.moveTo(r * 0.22, side * r * 0.5); ctx.lineTo(r * 0.52, side * r * 0.2); }
        ctx.stroke();
        ctx.beginPath(); ctx.arc(r * 1.05, 0, r * 0.4, Math.PI - 0.55, Math.PI + 0.55); ctx.stroke(); break;
      }
      case 'cat': {
        ctx.fillStyle = a.color; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5 * u;
        for (const side of [-1, 1]) ear(side, 1.3, 0.36, 0.4, a.color, '#f4a6b7');
        ctx.fillStyle = s.accent; for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r * 0.38, side * r * 0.3, r * 0.1, r * 0.17, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(r * 0.75, 0); ctx.lineTo(r * 0.62, -r * 0.08); ctx.lineTo(r * 0.62, r * 0.08); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = s.accent; ctx.lineWidth = 1.5 * u; ctx.beginPath();
        for (const side of [-1, 1]) for (const y of [0.52, 0.66]) { ctx.moveTo(r * 0.7, side * r * 0.14); ctx.lineTo(r * 0.78, side * r * y * 0.6); }
        ctx.stroke(); break;
      }
      case 'panda': {
        ctx.fillStyle = s.accent;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(-r * 0.5, side * r * 0.72, r * 0.3, 0, Math.PI * 2); ctx.fill(); }
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r * 0.36, side * r * 0.32, r * 0.2, r * 0.26, side * 0.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ffffff'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.42, side * r * 0.3, r * 0.07, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.ellipse(r * 0.74, 0, r * 0.1, r * 0.14, 0, 0, Math.PI * 2); ctx.fill(); break;
      }
      case 'ninja': {
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = s.accent; fr(r * 0.22, -r, r * 0.34, r * 2); ctx.restore();
        ctx.strokeStyle = s.accent; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.3); ctx.lineTo(-r * 1.3, -r * 0.55); ctx.moveTo(-r * 0.6, -r * 0.3); ctx.lineTo(-r * 1.25, -r * 0.15); ctx.stroke(); break;
      }
      case 'clown': {
        ctx.fillStyle = '#1c1c1c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.36, side * r * 0.32, r * 0.1, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 2 * u; ctx.beginPath(); for (const side of [-1, 1]) { ctx.moveTo(r * 0.36, side * r * 0.32 - r * 0.2); ctx.lineTo(r * 0.36, side * r * 0.32 + r * 0.2); } ctx.stroke();
        ctx.strokeStyle = s.accent; ctx.lineWidth = r * 0.13; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(r * 0.25, 0, r * 0.55, -Math.PI * 0.4, Math.PI * 0.4); ctx.stroke();
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.arc(r * 0.6, 0, r * 0.16, 0, Math.PI * 2); ctx.fill(); break;
      }
      case 'robot': {
        ctx.fillStyle = s.accent; fr(r * 0.2, -r * 0.5, r * 0.32, r);
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; fr(r * 0.2, -r * 0.5, r * 0.32, r * 0.2);
        ctx.fillStyle = s.accent; for (const y of [-0.22, -0.07, 0.08]) fr(r * 0.66, y * r, r * 0.24, r * 0.07);
        ctx.strokeStyle = s.accent; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.95); ctx.lineTo(-r * 0.2, -r * 1.3); ctx.stroke();
        ctx.fillStyle = s.eyes || '#00e5ff'; ctx.beginPath(); ctx.arc(-r * 0.2, -r * 1.32, r * 0.09, 0, Math.PI * 2); ctx.fill(); break;
      }
      case 'pumpkin': {
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2 * u; ctx.beginPath(); for (const y of [-0.55, -0.2, 0.2, 0.55]) { ctx.moveTo(-r, y * r); ctx.quadraticCurveTo(0, y * r * 1.6, r, y * r); } ctx.stroke();
        ctx.restore();
        const tri = (x, y, side) => { ctx.beginPath(); ctx.moveTo(x * r, y * r); ctx.lineTo((x - 0.22) * r, (y + side * 0.2) * r); ctx.lineTo((x + 0.1) * r, (y + side * 0.22) * r); ctx.closePath(); };
        ctx.fillStyle = s.glow || '#ffcc33'; for (const side of [-1, 1]) { tri(0.42, side * 0.22, side); ctx.fill(); }
        ctx.strokeStyle = s.accent; ctx.lineWidth = 2 * u; for (const side of [-1, 1]) { tri(0.42, side * 0.22, side); ctx.stroke(); }
        ctx.fillStyle = s.glow || '#ffcc33'; ctx.beginPath(); ctx.moveTo(r * 0.68, -r * 0.3); ctx.lineTo(r * 0.78, -r * 0.18); ctx.lineTo(r * 0.7, -r * 0.06); ctx.lineTo(r * 0.8, 0.06 * r); ctx.lineTo(r * 0.7, r * 0.18); ctx.lineTo(r * 0.78, r * 0.3); ctx.lineTo(r * 0.62, r * 0.2); ctx.lineTo(r * 0.62, -r * 0.2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = s.accent; ctx.stroke();
        ctx.fillStyle = '#4b7a2a'; fr(-r * 1.05, -r * 0.12, r * 0.3, r * 0.24); break;
      }
      // ---- second roster. The actor faces +x; "side" is left/right of that.
      case 'bear': {
        ctx.fillStyle = a.color; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5 * u;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(-r * 0.25, side * r * 0.85, r * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = s.accent; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(-r * 0.25, side * r * 0.85, r * 0.15, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.ellipse(r * 0.62, 0, r * 0.3, r * 0.36, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#15171c'; ctx.beginPath(); ctx.ellipse(r * 0.82, 0, r * 0.1, r * 0.13, 0, 0, Math.PI * 2); ctx.fill();
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.3, side * r * 0.36, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'bunny': {
        ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5 * u;
        for (const side of [-1, 1]) { ctx.fillStyle = a.color; ctx.beginPath(); ctx.ellipse(-r * 0.95, side * r * 0.42, r * 0.62, r * 0.2, side * -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = s.accent; ctx.beginPath(); ctx.ellipse(-r * 0.95, side * r * 0.42, r * 0.42, r * 0.09, side * -0.3, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#15171c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.38, side * r * 0.34, r * 0.1, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.arc(r * 0.72, 0, r * 0.11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; fr(r * 0.84, -r * 0.1, r * 0.14, r * 0.2);
        break;
      }
      case 'frog': {
        ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5 * u;
        for (const side of [-1, 1]) { ctx.fillStyle = a.color; ctx.beginPath(); ctx.arc(r * 0.45, side * r * 0.62, r * 0.33, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(r * 0.5, side * r * 0.62, r * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#15171c'; ctx.beginPath(); ctx.arc(r * 0.56, side * r * 0.62, r * 0.1, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = s.accent; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(r * 0.25, 0, r * 0.55, -Math.PI * 0.3, Math.PI * 0.3); ctx.stroke();
        break;
      }
      case 'alien': {
        ctx.fillStyle = '#0b0c10';
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r * 0.4, side * r * 0.36, r * 0.34, r * 0.2, side * 0.55, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.52, side * r * 0.3, r * 0.06, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = s.accent; ctx.lineWidth = 2 * u; ctx.beginPath(); for (const side of [-1, 1]) { ctx.moveTo(-r * 0.3, side * r * 0.8); ctx.lineTo(-r * 0.55, side * r * 1.3); } ctx.stroke();
        ctx.fillStyle = s.accent; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(-r * 0.55, side * r * 1.32, r * 0.12, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'pirate': {
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = s.accent; fr(-r, -r, r * 0.95, r * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (const [x, y] of [[-0.7, -0.45], [-0.4, 0.1], [-0.75, 0.5], [-0.3, -0.6]]) { ctx.beginPath(); ctx.arc(x * r, y * r, r * 0.07, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = '#15171c'; ctx.lineWidth = r * 0.09; ctx.beginPath(); ctx.moveTo(-r * 0.05, -r); ctx.lineTo(r * 0.6, r * 0.9); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#15171c'; ctx.beginPath(); ctx.ellipse(r * 0.4, r * 0.33, r * 0.2, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.42, -r * 0.33, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = s.accent; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.55); ctx.lineTo(-r * 1.25, -r * 0.75); ctx.moveTo(-r * 0.7, -r * 0.55); ctx.lineTo(-r * 1.2, -r * 0.35); ctx.stroke();
        break;
      }
      case 'cyclops': {
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.arc(r * 0.4, 0, r * 0.34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.arc(r * 0.48, 0, r * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#15171c'; ctx.beginPath(); ctx.arc(r * 0.52, 0, r * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#15171c'; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(r * 0.05, -r * 0.42); ctx.lineTo(r * 0.05, r * 0.42); ctx.stroke();
        break;
      }
      case 'shark': {
        ctx.fillStyle = s.accent; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.moveTo(r * 0.15, 0); ctx.lineTo(-r * 0.75, -r * 0.2); ctx.lineTo(-r * 0.75, r * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(r * 0.6, -r * 0.6);
        for (let i = 0; i <= 6; i++) ctx.lineTo(r * (i % 2 ? 0.62 : 0.86), -r * 0.6 + (i / 6) * r * 1.2);
        ctx.lineTo(r * 1.1, r * 0.6); ctx.lineTo(r * 1.1, -r * 0.6); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#15171c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.32, side * r * 0.5, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'fox': {
        ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2.5 * u;
        for (const side of [-1, 1]) ear(side, 1.3, 0.36, 0.46, a.color, null, '#15171c');
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.moveTo(r * 0.25, 0); ctx.lineTo(r * 1.1, -r * 0.7); ctx.lineTo(r * 1.1, r * 0.7); ctx.closePath(); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#15171c'; ctx.beginPath(); ctx.arc(r * 0.84, 0, r * 0.1, 0, Math.PI * 2); ctx.fill();
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r * 0.34, side * r * 0.36, r * 0.07, r * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'wizard': {
        ctx.fillStyle = s.accent; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.arc(-r * 0.1, 0, r * 0.78, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = this.shade(s.accent, 1.35); ctx.beginPath(); ctx.arc(-r * 0.22, -r * 0.06, r * 0.46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = this.shade(s.accent, 1.7); ctx.beginPath(); ctx.arc(-r * 0.4, -r * 0.14, r * 0.17, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd34d'; for (const [x, y] of [[0.3, -0.42], [0.2, 0.48], [-0.62, 0.42], [-0.7, -0.4]]) { ctx.beginPath(); ctx.arc(x * r, y * r, r * 0.07, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(r * 0.82, 0, r * 0.2, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'cowboy': {
        ctx.fillStyle = s.accent; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.ellipse(-r * 0.08, 0, r * 1.02, r * 1.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = this.shade(s.accent, 0.78); ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.56, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#3a1d0a'; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.6, r * 0.54, 0, -Math.PI * 0.4, Math.PI * 0.4); ctx.stroke();
        ctx.strokeStyle = this.shade(s.accent, 0.6); ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.moveTo(-r * 0.45, 0); ctx.lineTo(r * 0.2, 0); ctx.stroke();
        break;
      }
      case 'viking': {
        ctx.fillStyle = '#efe6cf'; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-r * 0.2, side * r * 0.8); ctx.quadraticCurveTo(-r * 0.1, side * r * 1.55, r * 0.75, side * r * 1.35); ctx.quadraticCurveTo(r * 0.2, side * r * 1.2, r * 0.2, side * r * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.arc(0, 0, r - 1, Math.PI * 0.32, Math.PI * 1.68); ctx.closePath(); ctx.fill();
        ctx.fillStyle = this.shade(s.accent, 1.5); fr(-r * 0.95, -r * 0.09, r * 1.45, r * 0.18);
        ctx.fillStyle = '#15171c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.62, side * r * 0.3, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'astronaut': {
        ctx.fillStyle = s.accent; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        fr(-r * 1.2, -r * 0.42, r * 0.34, r * 0.84); ctx.strokeRect(-r * 1.2, -r * 0.42, r * 0.34, r * 0.84);
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#0d1b33'; ctx.beginPath(); ctx.ellipse(r * 0.55, 0, r * 0.5, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = s.eyes || '#5fd0ff'; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(r * 0.62, 0, r * 0.36, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.ellipse(r * 0.66, -r * 0.26, r * 0.08, r * 0.16, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'bee': {
        ctx.fillStyle = 'rgba(220,240,255,0.55)'; ctx.strokeStyle = 'rgba(21,23,28,0.6)'; ctx.lineWidth = 1.5 * u;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(-r * 0.3, side * r * 1.1, r * 0.5, r * 0.3, side * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = s.accent; for (const x of [-0.75, -0.25, 0.25]) fr(x * r - r * 0.12, -r, r * 0.24, r * 2);
        ctx.restore();
        ctx.strokeStyle = s.accent; ctx.lineWidth = 2 * u; ctx.beginPath(); for (const side of [-1, 1]) { ctx.moveTo(r * 0.7, side * r * 0.3); ctx.lineTo(r * 1.25, side * r * 0.55); } ctx.stroke();
        ctx.fillStyle = s.accent; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 1.27, side * r * 0.56, r * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.62, side * r * 0.3, r * 0.1, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'dragon': {
        ctx.fillStyle = s.accent; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 1.5 * u;
        for (const x of [-0.95, -0.55, -0.15, 0.25]) { ctx.beginPath(); ctx.moveTo(x * r + r * 0.3, 0); ctx.lineTo(x * r - r * 0.08, -r * 0.2); ctx.lineTo(x * r - r * 0.08, r * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        for (const side of [-1, 1]) ear(side, 2.0, 0.34, 0.5, s.accent);
        ctx.fillStyle = '#15171c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.8, side * r * 0.14, r * 0.06, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'unicorn': {
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ['#ff5d8f', '#ffb84d', '#fff06a', '#6fe26a', '#5fb8ff', '#b388ff'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-r, -r * 0.42 + i * r * 0.14, r * 0.85, r * 0.15); });
        ctx.restore();
        ctx.fillStyle = s.accent; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        ctx.beginPath(); ctx.moveTo(r * 1.5, 0); ctx.lineTo(r * 0.55, -r * 0.17); ctx.lineTo(r * 0.55, r * 0.17); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#15171c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.36, side * r * 0.42, r * 0.1, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'ghost': {
        ctx.fillStyle = s.accent;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r * 0.36, side * r * 0.32, r * 0.16, r * 0.22, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.ellipse(r * 0.72, 0, r * 0.12, r * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = a.color; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 2 * u;
        for (const y of [-0.55, 0, 0.55]) { ctx.beginPath(); ctx.arc(-r * 1.02, y * r, r * 0.26, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        break;
      }
      case 'penguin': {
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = s.accent; ctx.beginPath(); ctx.ellipse(r * 0.55, 0, r * 0.62, r * 0.7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#ff9a2e'; ctx.strokeStyle = '#15171c'; ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.moveTo(r * 1.2, 0); ctx.lineTo(r * 0.72, -r * 0.16); ctx.lineTo(r * 0.72, r * 0.16); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#15171c'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.45, side * r * 0.32, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'mummy': {
        ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.strokeStyle = s.accent; ctx.lineWidth = 2 * u;
        for (const [x0, y0, x1, y1] of [[-1, -0.6, 1, -0.3], [-1, -0.15, 1, -0.35], [-1, 0.2, 1, 0.05], [-1, 0.6, 1, 0.35], [-1, 0.3, 1, 0.75], [-0.4, -1, -0.1, 1]]) { ctx.beginPath(); ctx.moveTo(x0 * r, y0 * r); ctx.lineTo(x1 * r, y1 * r); ctx.stroke(); }
        ctx.fillStyle = '#15171c'; fr(r * 0.18, -r * 0.55, r * 0.34, r * 1.1);
        ctx.restore();
        ctx.fillStyle = s.eyes || '#b6ff3a'; for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.36, side * r * 0.28, r * 0.11, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'skull':
        ctx.fillStyle = s.accent;
        for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r * 0.35, side * r * 0.32, r * 0.2, r * 0.26, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(r * 0.72, 0); ctx.lineTo(r * 0.56, -r * 0.1); ctx.lineTo(r * 0.56, r * 0.1); ctx.closePath(); ctx.fill();
        for (const y of [-0.3, -0.1, 0.1, 0.3]) ctx.fillRect(r * 0.78, y * r - u, r * 0.16, 2 * u);
        break;
    }
    if (s.eyes) {
      ctx.fillStyle = s.eyes; ctx.globalAlpha = 0.35;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.45, side * r * 0.28, r * 0.24, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.45, side * r * 0.28, r * 0.13, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // Shop preview: one actor facing up on a small canvas.
  drawSkinPreview(canvas, skin, weapon = null) {
    const ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const a = { x: canvas.width / 2, y: canvas.height / 2 + 2, r: canvas.width * 0.3, angle: -Math.PI / 2, color: skin.color, skin, flash: 0, weapon, isPlayer: true, healing: 0, invuln: 0, lastDamaged: -99, hp: 1, maxHp: 1, shield: 0, team: 0, zombie: null, lunge: 0 };
    this.drawActor(ctx, a, { time: 1, player: a }, true);
  }

  drawBombWorld(ctx, game) {
    const rd = game.round;
    for (const st of game.sites) {
      const hot = rd && rd.bomb.planted && rd.bomb.site === st;
      ctx.setLineDash([14, 10]); ctx.lineWidth = 4; ctx.strokeStyle = hot ? 'rgba(255,70,70,0.9)' : 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = hot ? 'rgba(255,70,70,0.12)' : 'rgba(255,255,255,0.07)'; ctx.fill();
      ctx.font = 'bold 56px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(st.name, st.x, st.y);
    }
    if (!rd || rd.state === 'over') return;
    const b = rd.bomb;
    if (b.planted || !b.carrier) {
      const pulse = 0.5 + 0.5 * Math.sin(game.time * (b.planted ? 4 + (1 - b.fuse / game.mode.fuse) * 14 : 3));
      ctx.fillStyle = 'rgba(255,60,60,' + (0.15 + pulse * 0.25) + ')'; ctx.beginPath(); ctx.arc(b.x, b.y, 26 + pulse * 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a2a30'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(b.x - 14, b.y - 10, 28, 20, 4) : ctx.rect(b.x - 14, b.y - 10, 28, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = pulse > 0.5 ? '#ff3b3b' : '#5a1010'; ctx.beginPath(); ctx.arc(b.x + 7, b.y - 3, 3, 0, Math.PI * 2); ctx.fill();
      if (b.planted) this.label(ctx, Math.ceil(b.fuse) + '', b.x, b.y - 24, 'bold 14px', '#ff6b6b');
      else this.label(ctx, 'Bomb', b.x, b.y - 24, '12px', '#ff6b6b');
    }
  }
  // bomb carrier marker and plant/defuse progress ring (called from drawActor)
  drawActionRing(ctx, a, game) {
    if (a.actionProgress > 0) this.ring(ctx, a, a.actionProgress, 'rgba(255,170,60,0.95)');
    const rd = game.round;
    if (rd && rd.bomb && rd.bomb.carrier === a && !rd.bomb.planted) {
      ctx.fillStyle = '#ff3b3b'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(a.x + a.r * 0.7, a.y - a.r * 0.9, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  // Menu background: the scene's world with a slowly drifting camera.
  drawMenu(scene, now) {
    const t = (now - scene.t0) / 1000, w = scene.world;
    scene.time = t; scene.dt = 1 / 60;
    const r = Math.min(w.w, w.h) * 0.22;
    scene.focus.x = w.w / 2 + Math.cos(t * 0.045) * r; scene.focus.y = w.h / 2 + Math.sin(t * 0.045 * 1.3) * r * 0.7;
    scene.player.x = scene.focus.x; scene.player.y = scene.focus.y;
    const z = this.zoom; this.zoom = 1.15;
    this.draw(scene);
    this.zoom = z;
  }
  // Map thumbnail for the picker: ground, a few blocks and trees in the map's palette; null = random (question mark).
  drawMapThumb(canvas, m) {
    const ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!m) {
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2d3442'); g.addColorStop(1, '#1b1f27');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', W / 2, H / 2 + 2);
      return;
    }
    const h = (i, k) => this.hash(i * 3.1, k * 7.7, m.id.length);
    if (m.shape === 'circle') { ctx.fillStyle = m.water; ctx.fillRect(0, 0, W, H); ctx.fillStyle = m.sand; ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W * 0.42, H * 0.44, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = m.ground; ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W * 0.37, H * 0.39, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = m.ground; ctx.fillRect(0, 0, W, H); }
    const inside = (x, y) => m.shape !== 'circle' || ((x - W / 2) ** 2) / ((W * 0.34) ** 2) + ((y - H / 2) ** 2) / ((H * 0.36) ** 2) < 1;
    for (let i = 0; i < 6; i++) { const x = h(i, 1) * W, y = h(i, 2) * H, r = 10 + h(i, 3) * 16; ctx.fillStyle = m.decor[i % m.decor.length]; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
    if (m.layout === 'grid') {
      ctx.fillStyle = m.buildings[0];
      for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < 3; gy++) { if (h(gx, gy + 20) < 0.2) continue; ctx.fillStyle = m.buildings[(gx + gy) % m.buildings.length]; ctx.fillRect(10 + gx * 36, 10 + gy * 36, 26, 26); }
    } else {
      for (let i = 0; i < 7; i++) { const x = 8 + h(i, 4) * (W - 40), y = 6 + h(i, 5) * (H - 34), bw = 14 + h(i, 6) * 20, bh = 12 + h(i, 7) * 16; if (!inside(x + bw / 2, y + bh / 2)) continue; ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 2, y + 3, bw, bh); ctx.fillStyle = m.buildings[i % m.buildings.length]; ctx.fillRect(x, y, bw, bh); }
    }
    const trees = m.layout === 'grid' ? 6 : 16;
    for (let i = 0; i < trees; i++) { const x = h(i, 8) * W, y = h(i, 9) * H, r = 3 + h(i, 10) * 5; if (!inside(x, y)) continue; ctx.fillStyle = h(i, 11) < m.treeRatio ? m.treeColors[i % m.treeColors.length] : m.rock; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
  // Small vector icons for the mode cards.
  drawModeIcon(canvas, id) {
    const ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return;
    const W = canvas.width, H = canvas.height, c = W / 2, gold = '#f2b632', ink = '#e8eaf0';
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const dot = (x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    switch (id) {
      case 'online': // a globe
        ctx.strokeStyle = gold; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(c, c, 21, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(c, c, 9, 21, 0, 0, Math.PI * 2); ctx.moveTo(c - 21, c); ctx.lineTo(c + 21, c); ctx.stroke();
        break;
      case 'solo':
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(c, c, 26, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        dot(c, c, 10, gold); break;
      case 'duos': dot(c - 11, c, 10, gold); dot(c + 11, c, 10, ink); break;
      case 'squads': dot(c - 12, c - 12, 9, gold); dot(c + 12, c - 12, 9, ink); dot(c - 12, c + 12, 9, ink); dot(c + 12, c + 12, 9, ink); break;
      case 'campaign': {
        ctx.fillStyle = gold; ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 11 : 25; ctx.lineTo(c + Math.cos(a) * r, c + 2 + Math.sin(a) * r); }
        ctx.closePath(); ctx.fill(); break;
      }
      case 'war': // a tank, gun to the right
        ctx.fillStyle = '#15161a'; this.rr(ctx, c - 27, c - 20, 50, 9, 3); ctx.fill(); this.rr(ctx, c - 27, c + 11, 50, 9, 3); ctx.fill();
        ctx.fillStyle = gold; this.rr(ctx, c - 24, c - 14, 44, 28, 5); ctx.fill();
        ctx.fillStyle = ink; ctx.fillRect(c + 2, c - 3, 30, 6);
        dot(c - 3, c, 10, ink); dot(c - 3, c, 4, '#1b2330'); break;
      case 'mega':
        ctx.fillStyle = '#15161a'; for (const x of [c - 19, c + 7]) for (const y of [c - 17, c + 11]) ctx.fillRect(x, y, 12, 6);
        ctx.fillStyle = gold; this.rr(ctx, c - 26, c - 13, 52, 26, 8); ctx.fill();
        ctx.fillStyle = '#1b2330'; this.rr(ctx, c - 9, c - 9, 20, 18, 4); ctx.fill();
        ctx.fillStyle = ink; ctx.fillRect(c + 21, c - 9, 3, 6); ctx.fillRect(c + 21, c + 3, 3, 6); break;
      case 'deathmatch':
        ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(c - 20, c + 20); ctx.lineTo(c + 20, c - 20); ctx.moveTo(c - 20, c - 20); ctx.lineTo(c + 20, c + 20); ctx.stroke();
        ctx.strokeStyle = gold; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(c - 20, c + 20); ctx.lineTo(c + 2, c - 2); ctx.stroke(); break;
      case 'gungame':
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i === 3 ? gold : ink; ctx.fillRect(c - 24 + i * 13, c + 18 - i * 11, 10, 8 + i * 11); } break;
      case 'zombies':
        dot(c, c - 2, 20, '#8fae76'); dot(c - 7, c - 6, 4.5, '#1b1b1b'); dot(c + 7, c - 6, 4.5, '#1b1b1b');
        ctx.fillStyle = '#1b1b1b'; ctx.fillRect(c - 9, c + 6, 18, 6); ctx.fillStyle = '#8fae76'; for (const x of [-6, -1, 4]) ctx.fillRect(c + x, c + 6, 3, 3); break;
      case 'bomb':
        dot(c, c + 5, 19, '#2a2d36'); ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(c + 6, c - 12); ctx.quadraticCurveTo(c + 14, c - 22, c + 22, c - 18); ctx.stroke();
        dot(c + 23, c - 19, 4, gold); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(c - 6, c - 1, 7, 0, Math.PI * 2); ctx.fill(); break;
      default: dot(c, c, 12, ink);
    }
  }
  // Everything that never moves is rendered once per 512px tile and blitted afterwards. Falls back to direct
  // drawing where offscreen canvases are unavailable (the Node test harness).
  drawWorldTiles(ctx, world, m, vx0, vy0, vx1, vy1) {
    const T = 512;
    // The cached map tiles are drawn at the density they will be shown at (in half steps up to 2x), so the ground,
    // buildings and trees are as sharp as the characters on a phone screen.
    const TS = Math.min(2, Math.max(1, Math.round(this.scale * this.zoom * (this.dpr || 1) * 2) / 2));
    if (this.tileWorld !== world || this.tileScale !== TS) { this.tileWorld = world; this.tileScale = TS; this.tiles = new Map(); this.tilesOk = true; }
    while (world.dirty && world.dirty.length) { // something static went away (a smashed crate): redraw its tiles
      const b = world.dirty.pop();
      for (let ty = Math.floor((b.y - 30) / T); ty <= Math.floor((b.y + b.h + 30) / T); ty++) for (let tx = Math.floor((b.x - 30) / T); tx <= Math.floor((b.x + b.w + 30) / T); tx++) this.tiles.delete(tx + ',' + ty);
    }
    const tx0 = Math.max(0, Math.floor(vx0 / T)), tx1 = Math.min(Math.ceil(world.w / T) - 1, Math.floor(vx1 / T));
    const ty0 = Math.max(0, Math.floor(vy0 / T)), ty1 = Math.min(Math.ceil(world.h / T) - 1, Math.floor(vy1 / T));
    if (this.tilesOk) {
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const key = tx + ',' + ty;
        let tile = this.tiles.get(key);
        if (!tile) {
          tile = this.renderTile(world, m, tx, ty, T, TS);
          if (!tile) { this.tilesOk = false; break; }
          this.tiles.set(key, tile);
          const keep = TS > 1 ? Math.max(20, (tx1 - tx0 + 2) * (ty1 - ty0 + 2) + 6) : 60; // bigger tiles, fewer kept
          if (this.tiles.size > keep) this.tiles.delete(this.tiles.keys().next().value); // oldest out
        }
        ctx.drawImage(tile, tx * T, ty * T, T, T);
      }
      if (this.tilesOk) return;
    }
    this.drawStatic(ctx, world, m, vx0, vy0, vx1, vy1);
  }
  renderTile(world, m, tx, ty, T, TS = 1) {
    const c = document.createElement('canvas'); if (!c || !c.getContext) return null;
    c.width = T * TS; c.height = T * TS;
    const g = c.getContext('2d'); if (!g || typeof g.translate !== 'function') return null;
    g.scale(TS, TS); g.translate(-tx * T, -ty * T);
    this.drawStatic(g, world, m, tx * T, ty * T, tx * T + T, ty * T + T);
    return c;
  }
  // Draws the static world for the given world-space rectangle (used per tile, or per frame as the fallback).
  drawStatic(ctx, world, m, x0, y0, x1, y1) {
    const inR = (x, y, r) => x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r;
    if (world.shape === 'circle') {
      ctx.fillStyle = m.water; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = m.sand; ctx.beginPath(); ctx.arc(world.w / 2, world.h / 2, world.islandR + 55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = m.ground; ctx.beginPath(); ctx.arc(world.w / 2, world.h / 2, world.islandR + 5, 0, Math.PI * 2); ctx.fill();
    } else { ctx.fillStyle = m.ground; ctx.fillRect(Math.max(0, x0), Math.max(0, y0), Math.min(world.w, x1) - Math.max(0, x0), Math.min(world.h, y1) - Math.max(0, y0)); }
    for (const d of world.decor) {
      if (!inR(d.x, d.y, d.r)) continue;
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    this.drawGroundDetail(ctx, m, world, x0, y0, x1, y1);
    if (world.roads && world.roads.length) this.drawRoads(ctx, world, m, x0, y0, x1, y1);
    if (world.pads) this.drawGroundExtras(ctx, world, m, x0, y0, x1, y1);
    if (world.trenches && (world.trenches.length || world.wire.length)) this.drawWarGround(ctx, world, x0, y0, x1, y1);
    ctx.strokeStyle = m.grid; ctx.lineWidth = 1; ctx.beginPath();
    const gx0 = Math.max(0, Math.floor(x0 / 100) * 100), gx1 = Math.min(world.w, x1);
    const gy0 = Math.max(0, Math.floor(y0 / 100) * 100), gy1 = Math.min(world.h, y1);
    for (let x = gx0; x <= gx1; x += 100) { ctx.moveTo(x, Math.max(0, y0)); ctx.lineTo(x, Math.min(world.h, y1)); }
    for (let y = gy0; y <= gy1; y += 100) { ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(Math.min(world.w, x1), y); }
    ctx.stroke();
    if (m.border) { ctx.strokeStyle = m.border; ctx.lineWidth = 8; ctx.strokeRect(0, 0, world.w, world.h); }
    for (const o of world.obstacles) {
      if (o.type === 'rect') { if (inR(o.x + o.w / 2, o.y + o.h / 2, Math.max(o.w, o.h) / 2 + 20)) this.drawRect(ctx, o); }
      else if (inR(o.x, o.y, o.r * 1.3 + 12)) this.drawCircleOb(ctx, o);
    }
  }
  ring(ctx, a, t, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * U.clamp(t, 0, 1)); ctx.stroke();
  }

  // The part of the minimap that never changes (ground, roads, obstacles) is drawn once per world and reused.
  minimapBase(world, S) {
    if (this.mmBase && this.mmWorld === world && this.mmVersion === world.version) return this.mmBase;
    const c = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
    if (!c || !c.getContext) return null;
    c.width = S; c.height = S;
    const g = c.getContext('2d'); if (!g) return null;
    this.drawMinimapBase(g, world, S);
    this.mmBase = c; this.mmWorld = world; this.mmVersion = world.version;
    return c;
  }
  drawMinimapBase(c, world, S) {
    const k = S / world.w, oy = (S - world.h * k) / 2, wide = oy > 0.5; // a wide battlefield sits letterboxed in the square
    if (wide) { c.fillStyle = '#0d0f13'; c.fillRect(0, 0, S, S); c.save(); c.translate(0, oy); }
    if (world.shape === 'circle') {
      c.fillStyle = world.map.water; c.fillRect(0, 0, S, S);
      c.fillStyle = world.map.minimap; c.beginPath(); c.arc(S / 2, S / 2, world.islandR * k, 0, Math.PI * 2); c.fill();
    } else { c.fillStyle = world.map.minimap; c.fillRect(0, 0, S, wide ? world.h * k : S); }
    if (world.roads.length) {
      c.save();
      if (world.shape === 'circle') { c.beginPath(); c.arc(S / 2, S / 2, world.islandR * k, 0, Math.PI * 2); c.clip(); }
      c.fillStyle = 'rgba(0,0,0,0.25)';
      for (const r of world.roads) c.fillRect(r.x * k, r.y * k, Math.max(2, r.w * k), Math.max(2, r.h * k));
      c.restore();
    }
    c.fillStyle = '#2c2f36';
    for (const o of world.obstacles) {
      if (o.type === 'rect') c.fillRect(o.x * k, o.y * k, Math.max(1.5, o.w * k), Math.max(1.5, o.h * k));
      else if (o.r > 30) { c.beginPath(); c.arc(o.x * k, o.y * k, Math.max(1, o.r * k), 0, Math.PI * 2); c.fill(); }
    }
    if (world.trenches && world.trenches.length) { c.fillStyle = '#3a2c1c'; for (const t of world.trenches) c.fillRect(t.x * k, t.y * k, Math.max(1.5, t.w * k), Math.max(1.5, t.h * k)); }
    if (wide) c.restore();
  }

  drawMinimap(game) {
    const c = this.mctx, S = this.mm.width, world = game.world, zone = world.zone, k = S / world.w;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const base = this.minimapBase(world, S);
    if (base) c.drawImage(base, 0, 0); else this.drawMinimapBase(c, world, S);
    const oy = (S - world.h * k) / 2; if (oy > 0.5) c.translate(0, oy);
    if (game.camp) for (const m of Campaign.marks(game)) { // objectives
      c.fillStyle = m.hot ? '#ff6b5e' : '#f2b632'; c.strokeStyle = '#000'; c.lineWidth = 1;
      c.save(); c.translate(m.x * k, m.y * k); c.rotate(Math.PI / 4); c.fillRect(-3.5, -3.5, 7, 7); c.strokeRect(-3.5, -3.5, 7, 7); c.restore();
    }
    // empty cars
    if (game.vehicles) { c.fillStyle = '#ffd24a'; for (const v of game.vehicles) if (v.alive && !v.driver && v.def.max) c.fillRect(v.x * k - 1.5, v.y * k - 1.5, 3, 3); }
    if (!zone.fixed) {
      c.beginPath(); c.rect(0, 0, S, S); c.arc(zone.cx * k, zone.cy * k, zone.r * k, 0, Math.PI * 2, true);
      c.fillStyle = 'rgba(110,40,170,0.5)'; c.fill();
      c.strokeStyle = 'rgba(200,120,255,0.95)'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(zone.cx * k, zone.cy * k, zone.r * k, 0, Math.PI * 2); c.stroke();
      if (!zone.done) {
        c.setLineDash([4, 3]); c.strokeStyle = '#fff'; c.lineWidth = 1.2;
        c.beginPath(); c.arc(zone.tx * k, zone.ty * k, zone.tr * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      }
    }
    // zombies (red) then teammates (green)
    for (const a of game.actors) {
      if (!a.alive || !a.zombie) continue;
      c.fillStyle = '#ff4a3a'; c.beginPath(); c.arc(a.x * k, a.y * k, a.zombie.id === 'brute' ? 3.2 : 2, 0, Math.PI * 2); c.fill();
    }
    for (const a of game.actors) {
      if (!a.alive || a.isPlayer || a.team !== game.player.team) continue;
      c.fillStyle = '#7ff57a'; c.strokeStyle = '#000'; c.lineWidth = 1;
      c.beginPath(); c.arc(a.x * k, a.y * k, 3.2, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    if (game.mode.type === 'bomb' && game.sites) {
      c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const st of game.sites) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillText(st.name, st.x * k, st.y * k); }
      const rd = game.round;
      if (rd && rd.state !== 'over' && (rd.bomb.planted || !rd.bomb.carrier)) { c.fillStyle = '#ff3b3b'; c.beginPath(); c.arc(rd.bomb.x * k, rd.bomb.y * k, 3.5 + Math.sin(game.time * 8) * 1.2, 0, Math.PI * 2); c.fill(); }
    }
    if (game.war) this.drawWarMinimap(c, game, k);
    const f = game.cameraTarget();
    c.fillStyle = f.isPlayer ? '#fff' : f.color; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(f.x * k, f.y * k, 4, 0, Math.PI * 2); c.fill(); c.stroke();
    c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(f.x * k, f.y * k); c.lineTo(f.x * k + Math.cos(f.angle) * 9, f.y * k + Math.sin(f.angle) * 9); c.stroke();
  }
}
