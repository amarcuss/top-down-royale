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
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
  }
  // Capture the mouse so it cannot leave the window mid-fight. Must be called from a user gesture.
  lock() {
    if (!this.canvas.requestPointerLock) return;
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
