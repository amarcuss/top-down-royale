'use strict';
// First-match coaching. A short list of prompts shown one at a time in the HUD (#coach); each is ticked off when the
// player actually does the thing (or after a few seconds for the ones that are only information). Finishing or
// skipping it sets Progress.data.tutorialDone; OPTIONS > Replay tutorial clears that again.
const Tutorial = {
  active: false, i: 0, t: null,
  steps(game) {
    const royale = game.mode.type === 'royale';
    return [
      { touch: 'Drag your LEFT thumb on the left half of the screen to move', keys: 'Move with W A S D', done: (t) => t.moved > 220 },
      { touch: 'Hold your RIGHT thumb on the right half to fire. Drag it to aim', keys: 'Aim with the mouse. Hold the left button to fire', done: (t) => t.shots >= 4 },
      { touch: 'Walk over weapons, ammo, shields and medkits to pick them up', keys: 'Walk over weapons, ammo, shields and medkits to pick them up', done: (t) => t.pickups >= 1 || t.stepT > 14 },
      { touch: 'Tap a weapon at the bottom to switch to it. Tap it again to reload', keys: 'Keys 1 2 3 switch weapon. R reloads. F uses a medkit', done: (t) => t.stepT > 7 },
      { touch: 'Tap ' + (game.player.char ? game.player.char.ability.name.toUpperCase() : 'the ability button') + ', top right, to use your ability', keys: 'Q or Space uses your ability: ' + (game.player.char ? game.player.char.ability.name : ''), done: (t) => game.player.abCd > 0 || t.stepT > 10 },
      { touch: 'Hits fill the ring round your right thumb. When it is full, double tap for your special attack', keys: 'Hits charge your special attack. Right-click fires it when it is ready', done: (t) => t.stepT > 8 },
      { touch: royale ? 'Stay inside the white circle. Last one standing wins' : (game.mode.tagline || 'Good luck out there'), keys: royale ? 'Stay inside the white circle. Last one standing wins' : (game.mode.tagline || 'Good luck out there'), done: (t) => t.stepT > 6 },
    ];
  },
  el(id) { return document.getElementById(id); },
  begin(game) {
    this.active = !Progress.data.tutorialDone && !game.camp;
    const box = this.el('coach');
    if (!this.bound && box.addEventListener) { this.bound = true; const skip = () => this.finish(window.game, true); this.el('coach-skip').addEventListener('click', skip); this.el('coach-skip').addEventListener('touchstart', (e) => { e.preventDefault(); skip(); }, { passive: false }); }
    box.classList.toggle('hidden', !this.active);
    if (!this.active) return;
    this.list = this.steps(game); this.i = 0; this.hold = 0;
    this.t = { moved: 0, x: game.player.x, y: game.player.y, shots0: game.shots || 0, shots: 0, pick0: game.ms.pickups, pickups: 0, stepT: 0 };
    this.show(game);
  },
  show(game) {
    const st = this.list[this.i];
    this.el('coach-n').textContent = (this.i + 1) + ' / ' + this.list.length;
    this.el('coach-text').textContent = game.input.touch ? st.touch : st.keys;
    this.el('coach').classList.remove('ok');
  },
  update(game, dt) {
    if (!this.active || game.state !== 'playing') return;
    const p = game.player, t = this.t;
    if (!p.alive) return;
    if (this.hold > 0) { // a beat with the green tick before the next prompt
      this.hold -= dt;
      if (this.hold <= 0) { this.i++; if (this.i >= this.list.length) return this.finish(game, false); t.stepT = 0; this.show(game); }
      return;
    }
    t.moved += Math.min(40, Math.hypot(p.x - t.x, p.y - t.y)); t.x = p.x; t.y = p.y;
    t.shots = (game.shots || 0) - t.shots0; t.pickups = game.ms.pickups - t.pick0; t.stepT += dt;
    if (this.list[this.i].done(t)) { this.hold = 0.7; this.el('coach').classList.add('ok'); Sound.tone(660, 0.08, 0.05, 'square', 990); t.shots0 = game.shots || 0; t.pick0 = game.ms.pickups; }
  },
  finish(game, skipped) {
    if (!this.active) return;
    this.active = false; this.el('coach').classList.add('hidden');
    Progress.data.tutorialDone = true;
    if (!skipped) { Progress.data.gems += 10; if (game && game.notify && game.player) game.notify(game.player, 'Training complete: +10 gems'); }
    Progress.save();
  },
};
