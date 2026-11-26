'use strict';
// Persistent progression: XP earned per match, spent in the shop on permanent unlocks.
// Saved in localStorage so it survives reloads.

// Difficulty: L is bot lethality 0..1.2. Adaptive starts at Normal and climbs with every win.
const DIFFICULTIES = {
  easy:      { id: 'easy', name: 'Easy', L: 0.1, desc: 'Slow, wobbly bots. A warm-up.' },
  normal:    { id: 'normal', name: 'Normal', L: 0.45, desc: 'Quick, accurate bots. They will punish standing still.' },
  hard:      { id: 'hard', name: 'Hard', L: 0.75, desc: 'Sharp bots that hunt the sound of your gun.' },
  nightmare: { id: 'nightmare', name: 'Nightmare', L: 1.05, desc: 'Near-perfect aim, instant reactions, armour, and they all want you.' },
  adaptive:  { id: 'adaptive', name: 'Adaptive', L: null, desc: 'Starts at Normal. Every win makes the next match harder, every loss eases it.' },
};
const DIFF_ORDER = ['easy', 'normal', 'hard', 'nightmare', 'adaptive'];

const XP_RULES = {
  match: 20,
  kill: 25,
  survivalPer10s: 2,
  placement: (p) => (p === 1 ? 150 : p <= 3 ? 90 : p <= 5 ? 60 : p <= 10 ? 35 : p <= 15 ? 15 : 5),
};

// type 'start': exclusive starting weapon (equip one). 'perk': always active once owned. 'skin': exclusive player look (see the skin items).
// Gems: the second currency. Earned by winning, finishing contracts, levelling up and the daily reward; spent on the
// 'gem' items below (gems: price). Consumables are bought again and again and never owned.
const GEM_RULES = { win: 10, contract: 10, levelUp: 15, daily: [5, 8, 10, 12, 15, 20, 30] };
const SHOP_ITEMS = [
  { id: 'gem_xp',      type: 'gem', name: 'XP Crate',         desc: '+400 XP, straight into your wallet.',            gems: 30, consumable: true },
  { id: 'gem_reroll',  type: 'gem', name: 'New Contracts',    desc: 'Swap all three contracts for fresh ones.',       gems: 5,  consumable: true },
  { id: 'skin_crystal', type: 'skin', name: 'Crystal', desc: 'Cut gemstone, glittering trail. Gems only.',        gems: 60,  value: { color: '#35e0d0', accent: '#eaffff', pattern: 'stars', eyes: '#ffffff', aura: 'rgba(60,230,215,0.6)', trail: 'rgba(120,255,240,0.7)' } },
  { id: 'skin_phantom', type: 'skin', name: 'Phantom', desc: 'Midnight shell, violet eyes and aura. Gems only.',  gems: 80,  value: { color: '#2a2f45', accent: '#b9a7ff', pattern: 'ring', eyes: '#b9a7ff', aura: 'rgba(150,120,255,0.55)' } },
  { id: 'skin_magma',   type: 'skin', name: 'Magma',   desc: 'Molten rock that leaves fire behind. Gems only.',    gems: 100, value: { color: '#ff5a1f', accent: '#3a0d00', pattern: 'spots', eyes: '#ffe36b', aura: 'rgba(255,90,20,0.5)', trail: 'rgba(255,120,30,0.7)' } },
  { id: 'start_smg',     type: 'start', name: 'SMG Drop',       desc: 'Drop in holding an SMG as well as the pistol.',   cost: 300, value: 'smg' },
  { id: 'start_shotgun', type: 'start', name: 'Shotgun Drop',   desc: 'Drop in holding a Shotgun as well as the pistol.', cost: 400, value: 'shotgun' },
  { id: 'start_rifle',   type: 'start', name: 'Rifle Drop',     desc: 'Drop in holding a Rifle as well as the pistol.',   cost: 900, value: 'rifle' },
  { id: 'start_rocket',  type: 'start', name: 'Rocket Drop',    desc: 'Drop in holding a Rocket Launcher. Mind your feet.', cost: 1600, value: 'rocket' },
  { id: 'perk_hp',       type: 'perk',  name: 'Tough',          desc: '+25 max health.',                                 cost: 500 },
  { id: 'perk_shield',   type: 'perk',  name: 'Armored Drop',   desc: 'Spawn with 50 shield.',                           cost: 450 },
  { id: 'perk_speed',    type: 'perk',  name: 'Sprinter',       desc: '+10% movement speed.',                            cost: 600 },
  { id: 'perk_reload',   type: 'perk',  name: 'Quick Hands',    desc: 'Reload 25% faster.',                              cost: 500 },
  { id: 'perk_medkit',   type: 'perk',  name: 'Field Medic',    desc: 'Spawn with 2 medkits.',                           cost: 300 },
  { id: 'perk_ammo',     type: 'perk',  name: 'Deep Pockets',   desc: '+50% ammo from every pickup.',                    cost: 350 },
  { id: 'pow_homing',    type: 'power', name: 'Tracking Bullets', desc: 'Your bullets steer toward the nearest enemy in front of them.', down: 'Heavy guidance pack: -12% movement speed.', cost: 1200 },
  { id: 'pow_explosive', type: 'power', name: 'Explosive Rounds', desc: 'Bullets burst on impact, damaging everything nearby.',           down: 'Every shot costs you 2 health (never below 1).', cost: 1500 },
  { id: 'pow_pierce',    type: 'power', name: 'Piercing Rounds',  desc: 'Bullets pass through the first enemy they hit.',                 down: '-15% bullet damage.', cost: 1000 },
  { id: 'pow_mags',      type: 'power', name: 'Big Mags',         desc: '+50% magazine size on every weapon.',                            down: 'Reloads take 40% longer.', cost: 600 },
  { id: 'pow_rapid',     type: 'power', name: 'Rapid Fire',       desc: '+25% fire rate.',                                                down: '+60% bullet spread.', cost: 900 },
  { id: 'pow_vampire',   type: 'power', name: 'Vampire',          desc: 'Heal 20% of the damage you deal.',                               down: '-25 max health.', cost: 800 },
  { id: 'pow_secondwind',type: 'power', name: 'Second Wind',      desc: 'Once per match, survive a killing blow with 50 health and 1.5s of invulnerability.', down: '-20 max health.', cost: 1000 },
  { id: 'pow_zone',      type: 'power', name: 'Zone Suit',        desc: 'Take half damage from the zone.',                                down: 'Heavy suit: -8% movement speed.', cost: 500 },
  { id: 'pow_eagle',     type: 'power', name: 'Eagle Eye',        desc: 'See 15% further in every direction.',                            cost: 400 },
  // skins: color = body, accent = pattern/hat color, pattern = stripes|halves|ring|target|spots|stars,
  // hat = crown|helmet|horns|halo|skull, eyes = glow color, aura = pulsing ring, trail = particle color while moving
  { id: 'skin_blue',   type: 'skin', name: 'Cobalt',  desc: 'Blue with white racing stripes.',            cost: 150, value: { color: '#4da3ff', accent: '#ffffff', pattern: 'stripes' } },
  { id: 'skin_red',    type: 'skin', name: 'Crimson', desc: 'Red, half dipped in black.',                 cost: 150, value: { color: '#ff5252', accent: '#2b0d0d', pattern: 'halves' } },
  { id: 'skin_candy',  type: 'skin', name: 'Candy',   desc: 'Pink and white rings. Very visible.',        cost: 250, value: { color: '#ff7ac8', accent: '#ffffff', pattern: 'target' } },
  { id: 'skin_black',  type: 'skin', name: 'Shadow',  desc: 'Near-black with violet eyes and a dark wake.', cost: 250, value: { color: '#2b2f3a', accent: '#141720', eyes: '#b388ff', trail: 'rgba(70,50,110,0.5)' } },
  { id: 'skin_tiger',  type: 'skin', name: 'Tiger',   desc: 'Orange with black stripes.',                 cost: 300, value: { color: '#ff9a2e', accent: '#1a1a1a', pattern: 'stripes' } },
  { id: 'skin_camo',   type: 'skin', name: 'Camo',    desc: 'Woodland blotches.',                         cost: 300, value: { color: '#6b7f3a', accent: '#3f4a24', pattern: 'spots' } },
  { id: 'skin_bone',   type: 'skin', name: 'Bone',    desc: 'Bleached white with a skull face.',          cost: 350, value: { color: '#efe9dc', accent: '#1c1c1c', hat: 'skull' } },
  { id: 'skin_grin',   type: 'skin', name: 'Grin',    desc: 'Sunny yellow with a big dumb smile.',          cost: 300, value: { color: '#ffd93b', accent: '#1c1c1c', hat: 'smile' } },
  { id: 'skin_scowl',  type: 'skin', name: 'Scowl',   desc: 'Brick red and permanently furious.',           cost: 300, value: { color: '#c0392b', accent: '#1c1c1c', hat: 'angry' } },
  { id: 'skin_kitten', type: 'skin', name: 'Kitten',  desc: 'Grey tabby with ears and whiskers.',           cost: 350, value: { color: '#9e9e9e', accent: '#2b2b2b', hat: 'cat' } },
  { id: 'skin_panda',  type: 'skin', name: 'Panda',   desc: 'Black and white and round all over.',          cost: 350, value: { color: '#f4f4f4', accent: '#111111', hat: 'panda' } },
  { id: 'skin_ninja',  type: 'skin', name: 'Ninja',   desc: 'Black mask, white eyes, no mercy.',            cost: 400, value: { color: '#222630', accent: '#0a0c10', hat: 'ninja', eyes: '#ffffff' } },
  { id: 'skin_jester', type: 'skin', name: 'Jester',  desc: 'White face, red nose, unsettling grin.',       cost: 400, value: { color: '#f7f7f7', accent: '#e53935', hat: 'clown' } },
  { id: 'skin_unit07', type: 'skin', name: 'Unit-07', desc: 'Steel chassis with a cyan visor.',             cost: 500, value: { color: '#7f8a99', accent: '#232a33', hat: 'robot', eyes: '#00e5ff' } },
  { id: 'skin_pumpkin', type: 'skin', name: 'Pumpkin', desc: 'Carved, and lit from inside.',                cost: 550, value: { color: '#ff8a1f', accent: '#2a1200', hat: 'pumpkin', glow: '#ffcc33', trail: 'rgba(255,170,40,0.5)' } },
  { id: 'skin_gold',   type: 'skin', name: 'Gold',    desc: 'Shiny, with a golden glow and sparkle trail.', cost: 400, value: { color: '#ffd34d', accent: '#fff7c0', pattern: 'ring', aura: 'rgba(255,220,80,0.6)', trail: 'rgba(255,230,130,0.8)' } },
  { id: 'skin_knight', type: 'skin', name: 'Knight',  desc: 'Steel plate with a visored helm.',           cost: 450, value: { color: '#9aa3ad', accent: '#3b4149', hat: 'helmet' } },
  { id: 'skin_toxic',  type: 'skin', name: 'Toxic',   desc: 'Radioactive green, leaves a glowing slick.',  cost: 450, value: { color: '#8bff3a', accent: '#2f6b12', pattern: 'spots', eyes: '#e8ff66', trail: 'rgba(140,255,60,0.5)' } },
  { id: 'skin_neon',   type: 'skin', name: 'Neon',    desc: 'Black with a cyan circuit glow.',            cost: 500, value: { color: '#101418', accent: '#00f0ff', pattern: 'ring', eyes: '#00f0ff', aura: 'rgba(0,240,255,0.6)' } },
  { id: 'skin_frost',  type: 'skin', name: 'Frost',   desc: 'Ice blue with snowflakes, sheds frost as you move.', cost: 500, value: { color: '#bfe9ff', accent: '#ffffff', pattern: 'stars', trail: 'rgba(225,245,255,0.8)' } },
  { id: 'skin_royal',  type: 'skin', name: 'Royal',   desc: 'Purple with a gold crown.',                  cost: 600, value: { color: '#7b3fe4', accent: '#ffd34d', hat: 'crown' } },
  { id: 'skin_saint',  type: 'skin', name: 'Saint',   desc: 'White with a halo and a trail of light.',    cost: 700, value: { color: '#ffffff', accent: '#ffd34d', hat: 'halo', trail: 'rgba(255,240,180,0.6)' } },
  { id: 'skin_demon',  type: 'skin', name: 'Demon',   desc: 'Horns, burning eyes, embers in your wake.',  cost: 800, value: { color: '#5a0f0f', accent: '#1a0505', hat: 'horns', eyes: '#ff3d00', trail: 'rgba(255,100,0,0.6)' } },
  { id: 'skin_galaxy', type: 'skin', name: 'Galaxy',  desc: 'Deep space, starlight eyes, stardust trail, violet aura.', cost: 900, value: { color: '#241a4a', accent: '#ffffff', pattern: 'stars', eyes: '#9be7ff', aura: 'rgba(160,120,255,0.5)', trail: 'rgba(190,160,255,0.7)' } },
  { id: 'skin_prestige', type: 'skin', name: 'Prestige', desc: 'Black and gold, crowned. Reward for your first prestige.', cost: 0, prestige: 1, value: { color: '#141414', accent: '#ffd34d', pattern: 'ring', hat: 'crown', eyes: '#ffd34d', aura: 'rgba(255,211,77,0.55)', trail: 'rgba(255,211,77,0.6)' } },
];

// Every skin is its own hero in the lobby and shop (Renderer.drawPortrait): build, head, headgear, face, weapon and extras.
// DEFAULT_HERO is the unskinned recruit. Colours not given here come from the skin's own colour and accent.
const DEFAULT_HERO = { body: 'std', top: 'helmet', face: 'eyes', gun: 'rifle', extra: ['pack'], outfit: '#5d6b3c' };
const HEROES = {
  skin_crystal:  { body: 'slim', head: 'gem', top: 'none', face: 'glow', gun: 'smg', outfit: '#1c8f88', extra: ['cape'], capeCol: '#eaffff' },
  skin_phantom:  { body: 'ghost', head: 'hood', top: 'none', face: 'glow', gun: 'pistols', outfit: '#3a3f5e' },
  skin_magma:    { body: 'wide', top: 'spikes', face: 'glow', gun: 'rocket', outfit: '#3a0d00', hatCol: '#2a0a00', trim: '#ff8a3a' },
  skin_blue:     { body: 'std', top: 'beret', face: 'eyes', gun: 'rifle', outfit: '#1f4f8f', hatCol: '#12305c', extra: ['scarf'], scarfCol: '#ffffff', chest: 'star' },
  skin_red:      { body: 'std', top: 'bandana', face: 'angry', gun: 'shotgun', outfit: '#3a1010', hatCol: '#16181d' },
  skin_candy:    { body: 'slim', top: 'cap', face: 'smile', gun: 'smg', outfit: '#ffffff', hatCol: '#ff4fa3' },
  skin_black:    { body: 'slim', head: 'hood', top: 'none', face: 'glow', gun: 'pistols', outfit: '#1a1d26', extra: ['cape'], capeCol: '#2a1f44' },
  skin_tiger:    { body: 'wide', head: 'cat', top: 'none', face: 'cat', gun: 'shotgun', outfit: '#ff9a2e', trim: '#ffb85c', extra: ['tail'], chest: 'stripes' },
  skin_camo:     { body: 'std', top: 'boonie', face: 'cool', gun: 'rifle', outfit: '#4d5c2a', extra: ['pack'] },
  skin_bone:     { body: 'slim', head: 'skull', top: 'none', face: 'skull', gun: 'rifle', outfit: '#1c1c1c', chest: 'ribs' },
  skin_grin:     { body: 'std', top: 'cap', face: 'smile', gun: 'pistols', outfit: '#2a6fd6', hatCol: '#e53935' },
  skin_scowl:    { body: 'wide', top: 'mohawk', face: 'angry', gun: 'shotgun', outfit: '#1c1c1c', hatCol: '#16181d', trim: '#8f8f8f' },
  skin_kitten:   { body: 'slim', head: 'cat', top: 'none', face: 'cat', gun: 'smg', outfit: '#f4a6b7', extra: ['tail'] },
  skin_panda:    { body: 'wide', head: 'panda', top: 'none', face: 'panda', gun: 'rocket', outfit: '#111111', trim: '#f4f4f4' },
  skin_ninja:    { body: 'slim', head: 'hood', top: 'none', face: 'mask', gun: 'pistols', outfit: '#1b1e27', extra: ['scarf'], scarfCol: '#c62828' },
  skin_jester:   { body: 'slim', top: 'jester', face: 'clown', gun: 'smg', outfit: '#3949ab', hatCol: '#e53935' },
  skin_unit07:   { body: 'bot', head: 'square', top: 'antenna', face: 'visor', gun: 'rifle' },
  skin_pumpkin:  { body: 'slim', head: 'pumpkin', top: 'none', face: 'pumpkin', gun: 'shotgun', outfit: '#2a1200', extra: ['cape'], capeCol: '#16181d' },
  skin_gold:     { body: 'std', top: 'tophat', face: 'cool', gun: 'pistols', outfit: '#b8860b', hatCol: '#ffd34d' },
  skin_knight:   { body: 'wide', top: 'plume', face: 'slit', gun: 'shotgun', outfit: '#6b7480', trim: '#c9d1da', hatCol: '#c62828', extra: ['cape'], capeCol: '#1f4f8f' },
  skin_toxic:    { body: 'std', top: 'none', head: 'hood', face: 'gasmask', gun: 'smg', outfit: '#d8c21a', chest: 'tank' },
  skin_neon:     { body: 'slim', top: 'mohawk', face: 'visor', gun: 'smg', outfit: '#1b2230', hatCol: '#00f0ff' },
  skin_frost:    { body: 'std', top: 'spikes', face: 'eyes', gun: 'rifle', outfit: '#5b9fc7', hatCol: '#ffffff', extra: ['scarf'], scarfCol: '#ffffff' },
  skin_royal:    { body: 'robe', top: 'crown', face: 'eyes', gun: 'pistols', outfit: '#5a2bb5', trim: '#ffd34d', extra: ['cape'], capeCol: '#c62828' },
  skin_saint:    { body: 'robe', top: 'halo', face: 'serene', gun: 'rifle', outfit: '#f3ead2', trim: '#ffd34d', extra: ['wings'] },
  skin_demon:    { body: 'wide', top: 'horns', face: 'glow', gun: 'rocket', outfit: '#2a0808', trim: '#7a1414', extra: ['batwings', 'tail'], tailCol: '#7a1414' },
  skin_galaxy:   { body: 'ghost', top: 'orbit', face: 'glow', gun: 'smg', outfit: '#3b2a7a', hatCol: '#ffd34d' },
  skin_prestige: { body: 'wide', top: 'crown', face: 'glow', gun: 'rocket', outfit: '#1c1c1c', trim: '#ffd34d', extra: ['cape'], capeCol: '#ffd34d' },
};
for (const it of SHOP_ITEMS) if (it.type === 'skin') it.value.hero = HEROES[it.id] || DEFAULT_HERO;

// Challenges: three are active at a time; a finished one pays XP and is replaced from the pool.
// count(stats) returns how much progress one finished match adds; goal is the total needed.
const CHALLENGES = [
  { id: 'c_win_solo', name: 'Win a Solo match', goal: 1, xp: 250, count: (s) => (s.mode === 'solo' && s.win ? 1 : 0) },
  { id: 'c_kills3', name: 'Get 3 kills in one match', goal: 1, xp: 120, count: (s) => (s.mode !== 'zombies' && s.kills >= 3 ? 1 : 0) },
  { id: 'c_kills25', name: 'Get 25 kills in total', goal: 25, xp: 150, count: (s) => (s.mode !== 'zombies' ? s.kills : 0) },
  { id: 'c_shotgun', name: 'Kill 8 enemies with the shotgun', goal: 8, xp: 150, count: (s) => s.weaponKills.shotgun || 0 },
  { id: 'c_sniper', name: 'Kill 6 enemies with the sniper', goal: 6, xp: 200, count: (s) => s.weaponKills.sniper || 0 },
  { id: 'c_rocket', name: 'Kill 5 enemies with the rocket launcher', goal: 5, xp: 200, count: (s) => s.weaponKills.rocket || 0 },
  { id: 'c_pistol', name: 'Kill 10 enemies with the pistol', goal: 10, xp: 150, count: (s) => s.weaponKills.pistol || 0 },
  { id: 'c_top5', name: 'Finish top 5 three times', goal: 3, xp: 200, count: (s) => (s.royale && s.placement > 0 && s.placement <= 5 ? 1 : 0) },
  { id: 'c_squadwin', name: 'Win a Duos or Squads match', goal: 1, xp: 250, count: (s) => ((s.mode === 'duos' || s.mode === 'squads') && s.win ? 1 : 0) },
  { id: 'c_gungame', name: 'Win Gun Game', goal: 1, xp: 300, count: (s) => (s.mode === 'gungame' && s.win ? 1 : 0) },
  { id: 'c_dm12', name: '12 kills in one Deathmatch', goal: 1, xp: 200, count: (s) => (s.mode === 'deathmatch' && s.kills >= 12 ? 1 : 0) },
  { id: 'c_wave5', name: 'Clear wave 5 in Zombies', goal: 1, xp: 200, count: (s) => (s.mode === 'zombies' && s.waves >= 5 ? 1 : 0) },
  { id: 'c_zkills', name: 'Kill 150 zombies', goal: 150, xp: 250, count: (s) => (s.mode === 'zombies' ? s.kills : 0) },
  { id: 'c_naked', name: 'Win with no power-ups equipped', goal: 1, xp: 400, count: (s) => (s.win && s.powers === 0 ? 1 : 0) },
  { id: 'c_hard', name: 'Win on Hard or above', goal: 1, xp: 400, count: (s) => (s.win && s.L >= 0.5 ? 1 : 0) },
  { id: 'c_nomeds', name: 'Win without using a medkit', goal: 1, xp: 300, count: (s) => (s.win && s.medsUsed === 0 ? 1 : 0) },
  { id: 'c_loot', name: 'Pick up 25 items in one match', goal: 1, xp: 100, count: (s) => (s.pickups >= 25 ? 1 : 0) },
  { id: 'c_bomb', name: 'Win a Bomb match', goal: 1, xp: 300, count: (s) => (s.mode === 'bomb' && s.win ? 1 : 0) },
  { id: 'c_plant', name: 'Complete 3 objectives (bombs or War positions)', goal: 3, xp: 150, count: (s) => s.objectives || 0 },
  { id: 'c_mutator', name: 'Win a match with a mutator on', goal: 1, xp: 300, count: (s) => (s.win && s.mutator !== 'none' ? 1 : 0) },
];
const POWER_SLOTS_BASE = 3, POWER_SLOTS_MAX = 6;

const Progress = {
  KEY: 'tdr_save_v1',
  data: null,

  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { d = null; }
    this.data = Object.assign({ xp: 0, totalXp: 0, owned: [], equipped: { start: null, skin: null }, stats: { matches: 0, kills: 0, wins: 0, best: 0 }, prefs: { mode: 'solo', map: 'random', difficulty: 'adaptive', mutator: 'none', aimAssist: true, mission: 0 }, adaptive: 0.45, powers: [], prestige: 0, challenges: { active: [], progress: {}, done: [] }, gems: 0, daily: { last: '', streak: 0 } }, d || {});
    if (typeof this.data.gems !== 'number') this.data.gems = 0;
    this.data.daily = Object.assign({ last: '', streak: 0 }, this.data.daily || {});
    this.data.equipped = Object.assign({ start: null, skin: null }, this.data.equipped || {});
    this.data.prefs = Object.assign({ mode: 'solo', map: 'random', difficulty: 'adaptive', mutator: 'none', aimAssist: true, mission: 0 }, this.data.prefs || {});
    if (typeof this.data.adaptive !== 'number' || this.data.adaptive < 0.45) this.data.adaptive = 0.45; // Normal is the floor
    if (!Array.isArray(this.data.powers)) this.data.powers = [];
    if (typeof this.data.prestige !== 'number') this.data.prestige = 0;
    this.data.challenges = Object.assign({ active: [], progress: {}, done: [] }, this.data.challenges || {});
    this.data.campaign = Object.assign({ unlocked: 0, done: [] }, this.data.campaign || {}); // story missions: highest playable index, ids cleared
    if (!Array.isArray(this.data.campaign.done)) this.data.campaign.done = [];
    this.refillChallenges();
    this.data.stats = Object.assign({ matches: 0, kills: 0, wins: 0, best: 0 }, this.data.stats || {});
    return this.data;
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* storage unavailable */ } },

  get level() { return 1 + Math.floor(Math.sqrt(this.data.totalXp / 150)); },
  xpForLevel(l) { return Math.ceil(((l - 1) ** 2) * 150); },

  // Returns the breakdown lines and total, and banks the XP.
  // opts (used by Zombies): killXp / killLabel override the per-kill reward, noPlacement skips the placement
  // line and best-placement stat, extra adds mode-specific lines [{label, xp}].
  // Current bot lethality and a label for it.
  lethality() {
    const d = DIFFICULTIES[this.data.prefs.difficulty] || DIFFICULTIES.adaptive;
    return d.L === null ? this.data.adaptive : d.L;
  },
  lethalityName(L = this.lethality()) { return L < 0.15 ? 'Easy' : L < 0.5 ? 'Normal' : L < 0.85 ? 'Hard' : L < 1.1 ? 'Nightmare' : 'Nightmare+'; },
  // Adaptive difficulty moves after every match: wins push it up fast, losses ease it slowly.
  adapt(win) {
    if (this.data.prefs.difficulty !== 'adaptive') return null;
    this.data.adaptive = Math.round(U.clamp(this.data.adaptive + (win ? 0.2 : -0.08), 0.45, 1.2) * 100) / 100;
    this.save();
    return this.lethalityName();
  },
  award(kills, placement, survived, win, opts = {}) {
    const lines = [{ label: 'Match played', xp: XP_RULES.match }];
    const killXp = opts.killXp || XP_RULES.kill, unit = opts.killLabel || 'kill';
    if (kills > 0) lines.push({ label: kills + ' ' + unit + (kills === 1 ? '' : 's'), xp: kills * killXp });
    if (!opts.noPlacement) lines.push({ label: 'Placed #' + placement, xp: XP_RULES.placement(placement) });
    for (const l of opts.extra || []) if (l) lines.push(l);
    const surv = Math.floor(survived / 10) * XP_RULES.survivalPer10s;
    if (surv > 0) lines.push({ label: (opts.survLabel || 'Survived') + ' ' + U.fmtTime(survived), xp: surv });
    if (opts.mutator && opts.mutator.xpBonus > 0) { const base = lines.reduce((s, l) => s + l.xp, 0); lines.push({ label: 'Mutator: ' + opts.mutator.name, xp: Math.round(base * opts.mutator.xpBonus) }); }
    const L = opts.L !== undefined ? opts.L : this.lethality();
    if (L > 0.5) { const base = lines.reduce((s, l) => s + l.xp, 0); lines.push({ label: this.lethalityName(L) + ' difficulty', xp: Math.round(base * 0.6 * Math.min(1, (L - 0.45) / 0.6)) }); } // up to +60% at Nightmare
    if (this.data.prestige > 0) { const base = lines.reduce((s, l) => s + l.xp, 0); lines.push({ label: 'Prestige ' + this.data.prestige + ' bonus', xp: Math.round(base * 0.1 * this.data.prestige) }); }
    const gemLines = [];
    if (win) gemLines.push({ label: 'Victory', n: GEM_RULES.win });
    if (opts.stats) for (const c of this.applyChallenges(opts.stats)) { lines.push({ label: 'Contract: ' + c.name, xp: c.xp }); gemLines.push({ label: 'Contract', n: GEM_RULES.contract }); }
    const total = lines.reduce((s, l) => s + l.xp, 0);
    const d = this.data;
    const before = this.level;
    d.xp += total; d.totalXp += total;
    d.stats.matches++; d.stats.kills += kills; if (win) d.stats.wins++;
    if (!opts.noPlacement && (!d.stats.best || placement < d.stats.best)) d.stats.best = placement;
    if (this.level > before) gemLines.push({ label: 'Level up', n: GEM_RULES.levelUp });
    const gems = gemLines.reduce((t, l) => t + l.n, 0); d.gems += gems;
    this.save();
    return { lines, total, leveledUp: this.level > before, level: this.level, gems, gemLines };
  },

  item(id) { return SHOP_ITEMS.find((i) => i.id === id); },
  owns(id) { return this.data.owned.includes(id); },
  alwaysOn(type) { return type === 'perk'; },
  slots() { return Math.min(POWER_SLOTS_MAX, POWER_SLOTS_BASE + this.data.prestige); },
  isEquipped(item) {
    if (item.type === 'power') return this.owns(item.id) && this.data.powers.includes(item.id);
    return this.alwaysOn(item.type) ? this.owns(item.id) : this.data.equipped[item.type] === item.id;
  },
  // Owning everything (prestige rewards excluded) unlocks prestige.
  canPrestige() { return SHOP_ITEMS.filter((i) => !i.prestige && !i.gems).every((i) => this.owns(i.id)); },
  // Prestige: the shop resets, you keep stats, level and prestige rewards, and gain a slot, an XP bonus and a skin.
  doPrestige() {
    if (!this.canPrestige()) return false;
    const d = this.data;
    d.prestige++;
    d.xp = 0; d.owned = d.owned.filter((id) => { const it = this.item(id); return it && (it.prestige || it.gems); }); // gem purchases are for keeps
    for (const it of SHOP_ITEMS) if (it.prestige && it.prestige <= d.prestige && !this.owns(it.id)) d.owned.push(it.id);
    d.equipped = { start: null, skin: this.owns('skin_prestige') ? 'skin_prestige' : null }; d.powers = [];
    this.save();
    return true;
  },
  // Backup codes: the whole save as text, to copy off the device and paste back later (or on another device).
  exportCode() { try { return 'TDR1.' + btoa(unescape(encodeURIComponent(JSON.stringify(this.data)))); } catch (e) { return ''; } },
  importCode(code) {
    try {
      const m = /TDR1\.([A-Za-z0-9+/=]+)/.exec(String(code || '').replace(/\s+/g, '')); if (!m) return false;
      const d = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      if (!d || typeof d !== 'object' || typeof d.totalXp !== 'number' || !Array.isArray(d.owned)) return false;
      localStorage.setItem(this.KEY, JSON.stringify(d)); this.data = null; this.load(); this.save();
      return true;
    } catch (e) { return false; }
  },
  reset() { try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ } this.data = null; this.load(); },
  buy(id) {
    const it = this.item(id);
    if (!it || this.owns(id)) return false;
    if (it.gems) {
      if (this.data.gems < it.gems) return false;
      this.data.gems -= it.gems;
      if (it.consumable) {
        if (id === 'gem_xp') { this.data.xp += 400; this.data.totalXp += 400; }
        else if (id === 'gem_reroll') { const c = this.data.challenges; for (const a of c.active) delete c.progress[a]; c.done = c.done.concat(c.active); c.active = []; this.refillChallenges(); }
        this.save(); return true;
      }
    } else { if (this.data.xp < it.cost) return false; this.data.xp -= it.cost; }
    this.data.owned.push(id);
    if (it.type === 'power') { if (this.data.powers.length < this.slots()) this.data.powers.push(id); }
    else if (!this.alwaysOn(it.type)) this.data.equipped[it.type] = id; // auto-equip new gear
    this.save();
    return true;
  },
  equip(id) {
    const it = this.item(id);
    if (!it || !this.owns(id) || this.alwaysOn(it.type)) return false;
    if (it.type === 'power') {
      const i = this.data.powers.indexOf(id);
      if (i >= 0) this.data.powers.splice(i, 1);
      else if (this.data.powers.length < this.slots()) this.data.powers.push(id);
      else return false; // slots full
      this.save(); return true;
    }
    this.data.equipped[it.type] = this.data.equipped[it.type] === id ? null : id; // toggle
    this.save();
    return true;
  },

  // Daily reward: one claim per calendar day; consecutive days climb a 7-day ladder, a missed day starts it again.
  dayKey(t = Date.now()) { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },
  dailyState() {
    const dl = this.data.daily, today = this.dayKey(), kept = dl.last === this.dayKey(Date.now() - 864e5) || dl.last === today;
    const streak = kept ? dl.streak : 0, ready = dl.last !== today;
    return { ready, day: ready ? streak % 7 : (streak + 6) % 7, reward: GEM_RULES.daily[streak % 7] }; // day: the tile to light up (0-6)
  },
  claimDaily() {
    const st = this.dailyState(); if (!st.ready) return 0;
    const dl = this.data.daily, kept = dl.last === this.dayKey(Date.now() - 864e5);
    dl.streak = (kept ? dl.streak : 0) + 1; dl.last = this.dayKey();
    this.data.gems += st.reward; this.save();
    return st.reward;
  },
  dailyHtml() {
    const st = this.dailyState();
    let h = '<div class="picker-label">DAILY REWARD</div><div class="daily-row">';
    GEM_RULES.daily.forEach((n, i) => { h += '<div class="day' + (i < st.day || (!st.ready && i === st.day) ? ' got' : '') + (st.ready && i === st.day ? ' now' : '') + '"><small>DAY ' + (i + 1) + '</small><i class="gem"></i><b>' + n + '</b></div>'; });
    return h + '</div><p class="picker-desc">' + (st.ready ? 'Come back every day: the reward grows for seven days in a row.' : 'Claimed. Come back tomorrow to keep the streak going.') + '</p>';
  },

  // Everything the match needs to know about the player's loadout.
  perks() {
    const has = (id) => (id.startsWith('pow_') ? this.isEquipped(this.item(id)) : this.owns(id));
    const start = this.data.equipped.start ? this.item(this.data.equipped.start) : null;
    const skin = this.data.equipped.skin ? this.item(this.data.equipped.skin) : null;
    return {
      // power-ups carry a downside each (see `down` on the items)
      hpBonus: (has('perk_hp') ? 25 : 0) - (has('pow_vampire') ? 25 : 0) - (has('pow_secondwind') ? 20 : 0),
      startShield: has('perk_shield') ? 50 : 0,
      speedMult: (has('perk_speed') ? 1.1 : 1) * (has('pow_homing') ? 0.88 : 1) * (has('pow_zone') ? 0.92 : 1),
      reloadMult: (has('perk_reload') ? 0.75 : 1) * (has('pow_mags') ? 1.4 : 1),
      meds: has('perk_medkit') ? 2 : 0,
      ammoMult: has('perk_ammo') ? 1.5 : 1,
      startWeapon: start && this.owns(start.id) ? start.value : null,
      color: skin && this.owns(skin.id) ? skin.value.color : '#f2f2f2',
      skin: skin && this.owns(skin.id) ? skin.value : null,
      homing: has('pow_homing'),
      explosive: has('pow_explosive'),
      pierce: has('pow_pierce') ? 1 : 0,
      magMult: has('pow_mags') ? 1.5 : 1,
      rateMult: has('pow_rapid') ? 0.8 : 1,
      lifesteal: has('pow_vampire') ? 0.2 : 0,
      secondWind: has('pow_secondwind') ? 1 : 0,
      zoneResist: has('pow_zone') ? 0.5 : 1,
      zoom: has('pow_eagle') ? 0.85 : 1,
      dmgMult: has('pow_pierce') ? 0.85 : 1,
      spreadMult: has('pow_rapid') ? 1.6 : 1,
      shotCost: has('pow_explosive') ? 2 : 0,
      activeNames: SHOP_ITEMS.filter((i) => i.type === 'power' && has(i.id)).map((i) => i.name),
      threat: this.threat(),
    };
  },
  // Difficulty multiplier for the current loadout (bots get tougher in every mode, the horde grows in Zombies): combat power-ups count most, perks a little,
  // a strong starting gun some. Zone Resist and Eagle Eye do nothing against the horde and are free.
  threat() {
    const has = (id) => (id.startsWith('pow_') ? this.isEquipped(this.item(id)) : this.owns(id));
    const powers = ['pow_homing', 'pow_explosive', 'pow_pierce', 'pow_mags', 'pow_rapid', 'pow_vampire', 'pow_secondwind'].filter(has).length;
    const perks = ['perk_hp', 'perk_shield', 'perk_speed', 'perk_reload', 'perk_medkit', 'perk_ammo'].filter(has).length;
    const start = this.data.equipped.start;
    const gun = { start_smg: 0.1, start_shotgun: 0.1, start_rifle: 0.2, start_rocket: 0.35 }[start && this.owns(start) ? start : ''] || 0;
    return Math.round((1 + powers * 0.15 + perks * 0.08 + gun) * 10) / 10;
  },

  refillChallenges() {
    const c = this.data.challenges;
    c.active = c.active.filter((id) => CHALLENGES.some((x) => x.id === id));
    while (c.active.length < 3) {
      let pool = CHALLENGES.filter((x) => !c.active.includes(x.id) && !c.done.includes(x.id));
      if (!pool.length) { c.done = []; pool = CHALLENGES.filter((x) => !c.active.includes(x.id)); } // everything done: cycle
      if (!pool.length) break;
      c.active.push(pool[Math.floor(Math.random() * pool.length)].id);
    }
  },
  // Feed one finished match into the active challenges; returns the ones completed.
  applyChallenges(stats) {
    const c = this.data.challenges, finished = [];
    for (const id of c.active.slice()) {
      const ch = CHALLENGES.find((x) => x.id === id); if (!ch) continue;
      const add = ch.count(stats) || 0;
      if (add <= 0) continue;
      c.progress[id] = (c.progress[id] || 0) + add;
      if (c.progress[id] >= ch.goal) { finished.push(ch); c.done.push(id); c.active.splice(c.active.indexOf(id), 1); delete c.progress[id]; }
    }
    if (finished.length) this.refillChallenges();
    return finished;
  },
  challengesHtml() {
    const c = this.data.challenges;
    let h = '<div class="picker-label">CONTRACTS</div><div class="ch-grid">';
    for (const id of c.active) {
      const ch = CHALLENGES.find((x) => x.id === id); if (!ch) continue;
      const p = Math.min(ch.goal, c.progress[id] || 0);
      h += '<div class="challenge"><span class="cname">' + ch.name + '</span><span class="cprog">' + (ch.goal > 1 ? p + '/' + ch.goal : '') + '</span><span class="cxp">+' + ch.xp + ' XP &middot; <i class="gem"></i>' + GEM_RULES.contract + '</span><div class="cbar"><div style="width:' + Math.round((p / ch.goal) * 100) + '%"></div></div></div>';
    }
    return h + '</div>';
  },
  rankName() { return ['Recruit', 'Private', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'General', 'Warlord'][Math.min(9, Math.floor((this.level - 1) / 3))]; },
  summaryHtml() {
    const d = this.data, lvl = this.level, next = this.xpForLevel(lvl + 1), cur = this.xpForLevel(lvl);
    const pct = Math.round(((d.totalXp - cur) / Math.max(1, next - cur)) * 100);
    const stars = d.prestige > 0 ? ' <span class="stars" title="Prestige ' + d.prestige + '">' + '\u2605'.repeat(Math.min(6, d.prestige)) + '</span>' : '';
    const prestige = this.canPrestige() ? '<div class="prof-prestige">Everything owned. <button class="prestige" data-prestige="1">PRESTIGE ' + (d.prestige + 1) + '</button> resets the shop for +1 power-up slot, +10% XP and an exclusive skin.</div>' : '';
    return '<div class="prof-badge"><i>LVL</i><b>' + lvl + '</b></div><div class="prof-top"><span class="lvl">' + this.rankName() + stars + '</span><span class="xp">' + d.xp.toLocaleString() + ' XP</span></div>'
      + '<div class="prof-bar"><div style="width:' + pct + '%"></div></div>'
      + '<div class="prof-stats">' + d.stats.matches + ' matches &middot; ' + d.stats.wins + ' wins &middot; ' + d.stats.kills + ' kills' + (d.stats.best ? ' &middot; best #' + d.stats.best : '') + ' &middot; ' + this.data.powers.length + '/' + this.slots() + ' power-up slots</div>' + prestige;
  },

  shopHtml(only) {
    let h = '';
    const groups = [['gem', 'Gem store'], ['start', 'Starting weapon'], ['perk', 'Perks'], ['power', 'Power-ups'], ['skin', 'Skins']];
    for (const [type, title] of groups) {
      if (only && only !== type) continue;
      h += '<div class="shop-group">' + title + (type === 'power' ? ' &middot; ' + this.data.powers.length + '/' + this.slots() + ' slots equipped' : '') + '</div>';
      for (const it of SHOP_ITEMS.filter((i) => i.type === type)) {
        const owned = this.owns(it.id), eq = this.isEquipped(it), afford = it.gems ? this.data.gems >= it.gems : this.data.xp >= it.cost;
        let btn;
        if (it.prestige && !owned) btn = '<span class="tag locked">PRESTIGE ' + it.prestige + ' REWARD</span>';
        else if (!owned) btn = '<button class="buy' + (afford ? '' : ' disabled') + '" data-buy="' + it.id + '">' + (it.gems ? 'BUY &middot; <i class="gem"></i>' + it.gems : 'BUY &middot; ' + it.cost + ' XP') + '</button>';
        else if (it.type === 'power' && !eq && this.data.powers.length >= this.slots()) btn = '<button class="equip disabled" data-equip="' + it.id + '">SLOTS FULL</button>';
        else if (this.alwaysOn(it.type)) btn = '<span class="tag owned">ACTIVE</span>';
        else btn = '<button class="' + (eq ? 'equipped' : 'equip') + '" data-equip="' + it.id + '">' + (eq ? 'EQUIPPED' : 'EQUIP') + '</button>';
        const swatch = it.type === 'skin' ? '<canvas class="skin-preview" width="144" height="144" data-skin="' + it.id + '"></canvas>' : '';
        h += '<div class="shop-item' + (owned ? ' owned' : '') + '"><div class="lead">' + swatch + '<div class="info"><b>' + it.name + '</b><span>' + it.desc + '</span>' + (it.down ? '<span class="down">' + it.down + '</span>' : '') + '</div></div>' + btn + '</div>';
      }
    }
    return h;
  },
};
