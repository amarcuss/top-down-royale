'use strict';
// dmg per pellet, rate = seconds between shots, spread in radians, range in px
const WEAPONS = {
  pistol:  { name: 'Pistol',  dmg: 14, rate: 0.26, speed: 850,  spread: 0.035, mag: 12, reload: 1.1, range: 650,  pellets: 1, auto: false, color: '#dddddd', tier: 1, ammoPickup: 24 },
  smg:     { name: 'SMG',     dmg: 9,  rate: 0.07, speed: 880,  spread: 0.09,  mag: 30, reload: 1.6, range: 520,  pellets: 1, auto: true,  color: '#f6c344', tier: 2, ammoPickup: 60 },
  shotgun: { name: 'Shotgun', dmg: 9,  rate: 0.85, speed: 780,  spread: 0.2,   mag: 6,  reload: 2.2, range: 340,  pellets: 7, auto: false, color: '#e07a3f', tier: 2, ammoPickup: 12 },
  rifle:   { name: 'Rifle',   dmg: 18, rate: 0.12, speed: 980,  spread: 0.045, mag: 25, reload: 1.9, range: 820,  pellets: 1, auto: true,  color: '#5fd38a', tier: 3, ammoPickup: 50 },
  sniper:  { name: 'Sniper',  dmg: 72, rate: 1.4,  speed: 1600, spread: 0.004, mag: 5,  reload: 2.6, range: 1400, pellets: 1, auto: false, color: '#7ab8ff', tier: 4, ammoPickup: 10 },
  // Light machine gun: issued to gunners in War (not in the royale loot table). Big belt, long reload.
  lmg:     { name: 'Machine Gun', short: 'MG', dmg: 13, rate: 0.085, speed: 950, spread: 0.075, mag: 60, reload: 3.4, range: 780, pellets: 1, auto: true, color: '#c9a0ff', tier: 3, ammoPickup: 120 },
  // Rockets: slow, visible projectile that detonates on anything. Splash hurts the shooter too.
  rocket:  { name: 'Rocket Launcher', short: 'Rocket', dmg: 90, rate: 1.6, speed: 520, spread: 0.01, mag: 1, reload: 2.4, range: 900, pellets: 1, auto: false, color: '#ff5252', tier: 4, ammoPickup: 4, kind: 'rocket', splash: 70, radius: 110 },
};

function makeWeapon(key) {
  const d = WEAPONS[key];
  return { key, ...d, ammo: d.mag, reserve: d.ammoPickup, cooldown: 0, reloading: false, reloadT: 0 };
}

// Rough desirability score used by bots and for "is this an upgrade" checks.
function weaponValue(w) {
  if (!w) return -1;
  return w.tier * 10 + Math.min(w.ammo + w.reserve, 40) / 8;
}
