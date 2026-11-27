'use strict';
// Map themes drive world generation and rendering colors. Counts are for a 3800x3800 map and scale with area.
const MAPS = {
  grass: {
    id: 'grass', name: 'Grasslands', desc: 'Rolling fields, small towns, plenty of trees.',
    ground: '#5a8f4a', outside: '#1b2a1c', grid: 'rgba(0,0,0,0.07)', border: '#223322', minimap: '#4b7a40',
    decor: ['rgba(0,0,0,0.07)', 'rgba(255,255,255,0.05)', 'rgba(70,130,50,0.25)', 'rgba(120,110,60,0.18)'],
    buildings: ['#4d525c', '#585d68', '#625850', '#4f5a66'], crate: '#8a6a3d',
    treeColors: ['#2e6b3a', '#2a5f33', '#357a3f'], treeHighlight: 'rgba(120,200,110,0.35)', rock: '#777169', treeRatio: 0.72,
    towns: 14, crates: 95, trees: 330, layout: 'towns', fog: '#c8d2cc', tuft: 'rgba(40,90,35,0.35)', road: '#56585e',
  },
  desert: {
    id: 'desert', name: 'Dunes', desc: 'Open sand, adobe towns, little cover. Long sightlines.',
    ground: '#d2b069', outside: '#3a2f1c', grid: 'rgba(0,0,0,0.05)', border: '#5a4a2a', minimap: '#b89a58',
    decor: ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.06)', 'rgba(200,150,80,0.25)', 'rgba(160,120,60,0.2)'],
    buildings: ['#9c7b55', '#8a6d4a', '#a88a63', '#7d6246'], crate: '#6d4f2e',
    treeColors: ['#5d8a3a', '#4e7a2f'], treeHighlight: 'rgba(200,230,120,0.3)', rock: '#8d7a62', treeRatio: 0.35,
    towns: 16, crates: 70, trees: 200, layout: 'towns', fog: '#e0d3b4', tuft: 'rgba(120,90,40,0.3)', tuftKind: 'dots', road: '#b08f5c', roadLine: 'rgba(90,65,30,0.35)', labelColor: 'rgba(70,45,10,0.3)',
  },
  snow: {
    id: 'snow', name: 'Frostline', desc: 'Dense pine forest and frozen ground. Close-quarters ambushes.',
    ground: '#dfe8ee', outside: '#1d2730', grid: 'rgba(0,0,0,0.05)', border: '#5a6a78', minimap: '#c7d3da',
    decor: ['rgba(255,255,255,0.35)', 'rgba(120,160,200,0.18)', 'rgba(0,0,0,0.04)'],
    buildings: ['#55606e', '#4a5563', '#6b5a50', '#5b6a7a'], crate: '#7a5a3a',
    treeColors: ['#1f4d33', '#245a3b', '#1a4530'], treeHighlight: 'rgba(255,255,255,0.55)', rock: '#8a929a', treeRatio: 0.8,
    towns: 12, crates: 90, trees: 380, layout: 'towns', fog: '#e6ecf1', tuft: 'rgba(255,255,255,0.9)', tuftKind: 'dots', road: '#8f9ba5', labelColor: 'rgba(30,50,70,0.3)',
  },
  city: {
    id: 'city', name: 'Gridlock', desc: 'City blocks and streets. Corners everywhere.',
    ground: '#5e6066', outside: '#15161a', grid: 'rgba(255,255,255,0.06)', border: '#2a2b30', minimap: '#4a4c52',
    decor: ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.04)'],
    buildings: ['#3c4250', '#48505f', '#5a5048', '#424a58', '#353b47'], crate: '#7d6a4b',
    treeColors: ['#3f7a45'], treeHighlight: 'rgba(120,200,110,0.35)', rock: '#7a7a7a', treeRatio: 0.9,
    towns: 0, crates: 140, trees: 90, layout: 'grid', fog: '#bfc3c9', tuft: 'rgba(0,0,0,0.22)', tuftKind: 'dots',
  },
  island: {
    id: 'island', name: 'Atoll', desc: 'A round island. The sea is the edge of the world.',
    ground: '#79a85a', outside: '#2b6f9e', water: '#2b6f9e', sand: '#d9c58a', grid: 'rgba(0,0,0,0.06)', border: null, minimap: '#5f8e4a',
    decor: ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)', 'rgba(90,140,60,0.25)'],
    buildings: ['#6d5d4a', '#7a6a55', '#5c5a60'], crate: '#8a6a3d',
    treeColors: ['#2f7a3f', '#3b8a48', '#2a6b38'], treeHighlight: 'rgba(140,220,120,0.35)', rock: '#8a8378', treeRatio: 0.85,
    towns: 9, crates: 80, trees: 300, layout: 'towns', shape: 'circle', fog: '#cbd8da', tuft: 'rgba(50,110,40,0.35)', road: '#c9b47c', roadLine: 'rgba(110,90,50,0.35)',
  },
};
const MAP_ORDER = ['grass', 'desert', 'snow', 'city', 'island'];

// type 'royale': zone + last team standing. 'dm': timed free-for-all with respawns. 'gungame': kill to upgrade, first rocket kill wins.
// 'zombies': co-op waves of melee undead; downed humans return at the next wave; clearing every wave wins.
// 'bomb': round-based 5v5 plant/defuse on the arena; see Game.startRound / updateBomb / objectiveFor.
// Royale options: cars = vehicles on the map, roads = lay a road grid, size = map side in px, zoneScale = slower circle.
const MODES = {
  solo:       { id: 'solo', netplay: true, name: 'Solo', tagline: '32 drop in. One walks out.', desc: '32 players. Last one standing.', type: 'royale', teamSize: 1, players: 32, cars: 5, roads: true },
  duos:       { id: 'duos', netplay: true, name: 'Duos', tagline: '16 squads of two. One walks out.', desc: '16 teams of 2. Last team standing. No friendly fire.', type: 'royale', teamSize: 2, players: 32, cars: 5, roads: true },
  squads:     { id: 'squads', netplay: true, name: 'Squads', tagline: 'Eight squads of four. One walks out.', desc: '8 teams of 4. Last team standing. No friendly fire.', type: 'royale', teamSize: 4, players: 32, cars: 5, roads: true },
  mega:       { id: 'mega', netplay: true, name: 'Mega', tagline: 'A hundred drop in. Grab a car.', desc: '100 players in 25 squads on a map four times the size. Roads, cars on every corner, and a long way to the circle.', type: 'royale', teamSize: 4, players: 100, size: 9000, cars: 46, roads: true, zoneScale: 2 },
  deathmatch: { id: 'deathmatch', netplay: true, name: 'Deathmatch', tagline: 'Four minutes. Most kills wins.', desc: '12 players, respawns, 4 minutes. Most kills wins.', type: 'dm', teamSize: 1, players: 12, duration: 240, respawn: true, arena: true },
  gungame:    { id: 'gungame', netplay: true, name: 'Gun Game', tagline: 'Climb the ladder. The rocket ends it.', desc: 'Every kill upgrades your gun. First kill with the rocket launcher wins.', type: 'gungame', teamSize: 1, players: 12, respawn: true, arena: true, ladder: ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'rocket'] },
  bomb:       { id: 'bomb', name: 'Bomb', tagline: 'Plant it. Or stop it.', desc: '5v5 Demolition. Attackers plant the bomb at A or B and hold it for 35s; defenders defuse, hold, or run the clock. Sides swap every round, first to 4.', type: 'bomb', teamSize: 5, players: 10, arena: true, lootRespawn: true, rounds: 4, roundTime: 80, plantTime: 3, defuseTime: 5, fuse: 35 },
  zombies:    { id: 'zombies', name: 'Zombies', tagline: 'Ten waves. Hold the line.', desc: 'Co-op survival. You and 3 squadmates against 10 waves of the undead. Downed players return next wave.', type: 'zombies', teamSize: 4, players: 4, arena: true, lootRespawn: true, waves: 10, intermission: 12, firstWave: 8 },
};
// 'campaign': story missions with staged objectives; the mission list and rules live in js/campaign.js.
MODES.campaign = { id: 'campaign', name: 'Campaign', tagline: 'Six missions. One valley to take back.', desc: 'Story missions with objectives: recon, breaching, assassination, escort and defence.', type: 'campaign', teamSize: 1, players: 1, noZone: true };
// 'war': two armies, five positions, trenches, tanks and artillery on one long battlefield; the rules live in js/war.js.
MODES.war = { id: 'war', name: 'War', tagline: 'Two armies. Five positions. One front line.', desc: '40 v 40 across a trench battlefield. Capture the five positions in order, or bleed the enemy out of reinforcements. Tanks, machine-gun nests, barbed wire, grenades and artillery. Trenches shield you from distant fire.', type: 'war', teamSize: 40, players: 80, respawn: true, respawnTime: 5, noZone: true, width: 7600, height: 4200, tickets: 550, duration: 900 };
// Match mutators: optional rule twists picked on the start screen. xpBonus is a fraction added to match XP.
const MUTATORS = {
  none:    { id: 'none', name: 'None', desc: 'Standard rules.', xpBonus: 0 },
  random:  { id: 'random', name: 'Random', desc: 'A surprise every match.', xpBonus: 0 },
  pistols: { id: 'pistols', name: 'Pistols Only', desc: 'Everyone gets a pistol and nothing else drops.', xpBonus: 0.25, weapon: 'pistol' },
  rockets: { id: 'rockets', name: 'Rockets Only', desc: 'Rocket launchers for all. Mind your feet.', xpBonus: 0.25, weapon: 'rocket' },
  glass:   { id: 'glass', name: 'Glass Cannon', desc: 'Half health, no shields. Every hit matters.', xpBonus: 0.25, hpMult: 0.5, noShield: true },
  overdrive: { id: 'overdrive', name: 'Overdrive', desc: 'Everyone moves 40% faster.', xpBonus: 0.2, speedMult: 1.4 },
  fog:     { id: 'fog', name: 'Fog', desc: 'Nobody sees further than a stone\'s throw. Listen for gunfire.', xpBonus: 0.3, fog: true },
};
const MUT_ORDER = ['none', 'random', 'pistols', 'rockets', 'glass', 'overdrive', 'fog'];

// War and Campaign are retired (their definitions stay only because old code paths still name them).
// netplay: DROP IN joins an online match when a game server is configured; the others are played against bots on the device.
const MODE_ORDER = ['solo', 'duos', 'squads', 'mega', 'deathmatch', 'gungame', 'zombies', 'bomb'];

// Zombies mode horde. Stats are for wave 1; hp scales up each wave (see Game.spawnZombie).
const ZOMBIE_TYPES = {
  walker: { id: 'walker', name: 'Walker', hp: 60, speed: [115, 150], r: 18, dmg: 12, rate: 0.9, color: '#6f8a5a', weight: 10, minWave: 1 },
  runner: { id: 'runner', name: 'Runner', hp: 45, speed: [238, 262], r: 15, dmg: 8, rate: 0.55, color: '#a0744f', weight: 5, minWave: 2 },
  toxic:  { id: 'toxic', name: 'Toxic', hp: 55, speed: [150, 180], r: 17, dmg: 6, rate: 0.7, color: '#7bd34a', eyes: '#eaff5a', weight: 3.5, minWave: 3, poison: { dps: 4, time: 5 }, cloud: { r: 75, time: 4 } },
  brute:  { id: 'brute', name: 'Brute', hp: 260, speed: [92, 108], r: 28, dmg: 32, rate: 1.4, color: '#46553f', weight: 1.2, minWave: 4 },
};
