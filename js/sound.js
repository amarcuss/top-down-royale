'use strict';
// Tiny procedural sound effects via WebAudio. No assets needed.
const Sound = {
  ctx: null, muted: false, _noise: {},
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  },
  noise(dur) {
    const key = Math.round(dur * 100);
    if (this._noise[key]) return this._noise[key];
    const sr = this.ctx.sampleRate, n = Math.floor(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    this._noise[key] = buf;
    return buf;
  },
  shot(key, vol) {
    if (!this.ctx || this.muted || vol <= 0.01) return;
    const c = this.ctx, t = c.currentTime;
    const cfg = { pistol: [0.12, 1600], smg: [0.07, 2200], shotgun: [0.22, 900], rifle: [0.1, 1400], sniper: [0.35, 600], rocket: [0.3, 500], boom: [0.6, 260] }[key] || [0.1, 1500];
    const src = c.createBufferSource(); src.buffer = this.noise(cfg[0]);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cfg[1];
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg[0]);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t);
  },
  tone(freq, dur, vol, type = 'square', slide = 0) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  // Engine hum while the player is in a car: one oscillator whose pitch follows the speed (k = 0..1).
  engine(on, k) {
    if (!this.ctx) return;
    if (!this._eng) {
      if (!on) return;
      const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(c.destination); o.start();
      this._eng = { o, g };
    }
    const t = this.ctx.currentTime;
    this._eng.g.gain.setTargetAtTime(on && !this.muted ? 0.05 + 0.05 * k : 0, t, 0.08);
    if (on) this._eng.o.frequency.setTargetAtTime(52 + 95 * k, t, 0.1);
  },
  boom(vol) { this.shot('boom', vol * 1.4); this.tone(90, 0.35, vol * 0.4, 'sine', 40); },
  pickup() { this.tone(660, 0.09, 0.12, 'square', 1200); },
  hitmarker() { this.tone(1500, 0.04, 0.1, 'square'); },
  hurt() { this.tone(180, 0.12, 0.2, 'sawtooth', 90); },
  kill() { this.tone(440, 0.18, 0.18, 'square', 880); },
  zone() { this.tone(240, 0.25, 0.15, 'triangle', 180); },
  reload() { this.tone(900, 0.05, 0.08, 'square', 600); },
  groan(vol) { if (vol > 0.02) this.tone(U.rand(95, 130), 0.55, vol * 0.22, 'sawtooth', 70); },
  zkill() { this.tone(330, 0.07, 0.1, 'square', 160); },
  wave() { this.tone(160, 0.5, 0.2, 'sawtooth', 60); this.tone(240, 0.4, 0.15, 'triangle', 120); },
};
