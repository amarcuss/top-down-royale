'use strict';
class Input {
  constructor(canvas) {
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, clicked: false, mx: 0, my: 0 }; // mx/my: movement this frame (for aim assist)
    this.wheel = 0;
    window.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase();
      if (!e.repeat) { this.keys.add(k); this.pressed.add(k); }
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete((e.key || '').toLowerCase()));
    this.canvas = canvas; this.locked = false; this.wantLock = false;
    window.addEventListener('mousemove', (e) => {
      if (this.touch) { if (performance.now() - this.lastTouch < 1200) return; this.setTouch(false); } // a real mouse takes over again
      if (this.locked) {
        // pointer lock: the OS cursor is hidden, we move a virtual cursor by relative motion
        this.mouse.x = U.clamp(this.mouse.x + e.movementX, 0, window.innerWidth);
        this.mouse.y = U.clamp(this.mouse.y + e.movementY, 0, window.innerHeight);
        this.mouse.mx += e.movementX; this.mouse.my += e.movementY;
      } else { this.mouse.mx += e.clientX - this.mouse.x; this.mouse.my += e.clientY - this.mouse.y; this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || (e.target && e.target.closest && e.target.closest('button'))) return; // clicks anywhere on a menu button are not shots
      this.mouse.down = true; this.mouse.clicked = true;
      if (this.wantLock && !this.locked) this.lock();
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked && this.onLockLost) this.onLockLost(); // Esc or alt-tab: let the game pause
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; this.releaseTouches(); });
    this.initTouch(canvas);
  }

  // ---------------------------------------------------------------- touch (phones and tablets)
  // Two floating thumb sticks on the canvas: the left half of the screen moves, the right half aims and, pushed
  // past the inner ring, fires. On-screen buttons (#touch [data-key]) press the same keys the keyboard does.
  initTouch(canvas) {
    const R = this.stickR = 56; // stick travel in CSS px
    this.touch = false; this.lastTouch = -1e9;
    this.stick = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };                                                          // dx,dy: -1..1
    this.aim = { id: null, ox: 0, oy: 0, dx: 0, dy: 0, ax: 1, ay: 0, mag: 0.6, fire: false, t0: 0, moved: false }; // ax,ay: last aim direction, kept after release
    this.heldKeys = new Map(); // touch identifier -> { k, el }
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) this.setTouch(true); // a phone: show its controls and hints from the start
    // iOS ignores user-scalable=no: stop pinch and double-tap zoom, which would leave the game magnified and cropped
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
    let lastEnd = 0;
    document.addEventListener('touchend', (e) => { const t = performance.now(); if (t - lastEnd < 320 && !(e.target && e.target.closest && e.target.closest('button, a'))) e.preventDefault(); lastEnd = t; }, { passive: false });
    const seen = () => { this.lastTouch = performance.now(); if (!this.touch) this.setTouch(true); };
    window.addEventListener('touchstart', seen, { capture: true, passive: true });
    window.addEventListener('touchend', seen, { capture: true, passive: true });
    const set = (st, t) => {
      let dx = t.clientX - st.ox, dy = t.clientY - st.oy; const len = Math.hypot(dx, dy);
      if (len > R) { st.ox += dx * (1 - R / len); st.oy += dy * (1 - R / len); dx *= R / len; dy *= R / len; } // the base follows a thumb that drags past the rim
      st.dx = dx / R; st.dy = dy / R;
      if (st === this.aim) {
        const m = Math.hypot(st.dx, st.dy);
        if (m > 0.2) { st.ax = st.dx / m; st.ay = st.dy / m; st.mag = m; st.moved = true; }
        st.fire = true;
      }
    };
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault(); // no scrolling, zooming or synthetic mouse clicks from the play area
      for (const t of e.changedTouches) {
        const st = t.clientX < window.innerWidth / 2 ? this.stick : this.aim;
        if (st.id !== null) continue;
        st.id = t.identifier; st.ox = t.clientX; st.oy = t.clientY; st.dx = st.dy = 0;
        if (st === this.aim) { st.fire = true; st.moved = false; st.t0 = performance.now(); } // the right thumb is the trigger: touching fires, dragging aims
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) { if (t.identifier === this.stick.id) set(this.stick, t); else if (t.identifier === this.aim.id) set(this.aim, t); }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) { this.stick.id = null; this.stick.dx = this.stick.dy = 0; }
        else if (t.identifier === this.aim.id) {
          const a = this.aim;
          if (e.type === 'touchend' && !a.moved && performance.now() - a.t0 < 300) this.mouse.clicked = true; // a quick tap fires one shot where you already aim
          a.id = null; a.dx = a.dy = 0; a.fire = false;
        }
      }
    };
    canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);

    // on-screen buttons
    const pad = document.getElementById('touch');
    if (pad) {
      pad.addEventListener('touchstart', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('[data-key]') : null; if (!b) return;
        e.preventDefault();
        const k = b.dataset.key;
        if (k === 'wheel') this.wheel += 1; else { this.keys.add(k); this.pressed.add(k); }
        b.classList.add('held');
        for (const t of e.changedTouches) this.heldKeys.set(t.identifier, { k, el: b });
      }, { passive: false });
      const up = (e) => {
        for (const t of e.changedTouches) {
          const h = this.heldKeys.get(t.identifier); if (!h) continue;
          this.heldKeys.delete(t.identifier); this.keys.delete(h.k); h.el.classList.remove('held');
        }
      };
      pad.addEventListener('touchend', up); pad.addEventListener('touchcancel', up);
    }
    // tapping a weapon slot in the HUD selects it
    const slots = document.getElementById('weapons');
    if (slots) slots.addEventListener('touchstart', (e) => {
      const s = e.target && e.target.closest ? e.target.closest('.slot') : null; if (!s) return;
      e.preventDefault();
      const i = Array.prototype.indexOf.call(slots.children, s);
      if (i >= 0) this.pressed.add(String(i + 1));
    }, { passive: false });
  }
  setTouch(on) {
    this.touch = on;
    if (on) this.unlock(); else this.releaseTouches();
    if (document.body && document.body.classList) document.body.classList.toggle('touch', on);
  }
  releaseTouches() {
    if (!this.stick) return;
    this.stick.id = null; this.stick.dx = this.stick.dy = 0;
    this.aim.id = null; this.aim.dx = this.aim.dy = 0; this.aim.fire = false;
    for (const h of this.heldKeys.values()) { this.keys.delete(h.k); h.el.classList.remove('held'); }
    this.heldKeys.clear();
  }
  // Capture the mouse so it cannot leave the window mid-fight. Must be called from a user gesture.
  lock() {
    if (this.touch || !this.canvas.requestPointerLock) return; // fingers need no capture
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { /* denied (needs a gesture, or too soon after Esc); next click retries */ });
    } catch (e) { /* unsupported */ }
  }
  unlock() {
    this.wantLock = false;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  down(k) { return this.keys.has(k); }
  justPressed(k) { return this.pressed.has(k); }
  endFrame() { this.pressed.clear(); this.mouse.clicked = false; this.wheel = 0; this.mouse.mx = 0; this.mouse.my = 0; }
}
