'use strict';
// Seasons and events.
//
// A season is always running (three months each). It dresses the home screen (a themed map behind the menu, weather
// drifting across it), and it has one event of its own and a skin to earn.
//
// An event is a featured match with its own rules: a mode, a map, a twist, bonus XP and gems. One event is live at a
// time and it changes every eight hours (midnight, 08:00 and 16:00 by the phone's clock); every third one is the
// season's own event. Events are played against bots on the device, so they work with no connection.
//
// Playing events earns season stars (1 for a match, 3 for a win); ten stars earn the season's Mega Box.
const SEASONS = [
  { id: 'bloom', name: 'Bloom', months: [2, 3, 4], color: '#ff8fc7', weather: 'petals', map: 'grass', skin: 'skin_s_bloom',
    palette: { ground: '#6aa554', minimap: '#5c9448', treeColors: ['#f29ac0', '#e87aa8', '#3f8a48', '#f7b6d2'], treeHighlight: 'rgba(255,230,240,0.45)', tuft: 'rgba(230,120,170,0.4)' } },
  { id: 'heatwave', name: 'Heatwave', months: [5, 6, 7], color: '#ff7a2e', weather: 'dust', map: 'desert', skin: 'skin_s_heatwave', tint: 'rgba(255,150,40,0.07)', palette: null },
  { id: 'harvest', name: 'Harvest', months: [8, 9, 10], color: '#ff9a3c', weather: 'leaves', map: 'grass', skin: 'skin_s_harvest', tint: 'rgba(255,170,60,0.05)',
    palette: { ground: '#8d8f48', minimap: '#7d8243', decor: ['rgba(0,0,0,0.07)', 'rgba(255,220,140,0.07)', 'rgba(170,110,40,0.22)', 'rgba(120,90,40,0.18)'], treeColors: ['#c8632a', '#d98e2e', '#a3472b', '#b8862e'], treeHighlight: 'rgba(255,215,130,0.4)', tuft: 'rgba(120,80,30,0.38)' } },
  { id: 'frostfall', name: 'Frostfall', months: [11, 0, 1], color: '#8fd8ff', weather: 'snow', map: 'snow', skin: 'skin_s_frostfall', tint: 'rgba(120,170,255,0.06)', palette: null },
];
// twist: the rule change, in the same terms as a mutator (see Game.applyMutator). xp: bonus XP as a fraction.
const EVENTS = [
  { id: 'longshot', name: 'Long Shot', tagline: 'Snipers only. Open sand. Do not miss.', mode: 'solo', map: 'desert', xp: 0.5, rules: 'Everyone carries a sniper rifle and nothing else drops.', twist: { weapon: 'sniper' } },
  { id: 'boomtown', name: 'Boomtown', tagline: 'Every bullet goes off like a firework.', mode: 'deathmatch', map: 'city', xp: 0.5, rules: 'All bullets explode where they land.', twist: { explosive: true }, tint: 'rgba(255,120,30,0.05)' },
  { id: 'rushhour', name: 'Rush Hour', tagline: 'The ladder, at a sprint.', mode: 'gungame', map: 'city', xp: 0.4, rules: 'Everyone moves 40% faster.', twist: { speedMult: 1.4 } },
  { id: 'closequarters', name: 'Close Quarters', tagline: 'Shotguns in the pines. Bring your squad.', mode: 'squads', map: 'snow', xp: 0.5, rules: 'Shotguns only. Nothing else drops.', twist: { weapon: 'shotgun' } },
  { id: 'glasshouse', name: 'Glass House', tagline: 'Half the health. Twice the trigger.', mode: 'deathmatch', map: 'island', xp: 0.5, rules: 'Half health, no shields, and every gun fires much faster.', twist: { hpMult: 0.5, noShield: true, rateMult: 0.6 } },
  { id: 'bloodmoon', name: 'Blood Moon', tagline: 'Under a red sky, every hit feeds you.', mode: 'solo', map: 'grass', xp: 0.5, rules: 'Damage you deal heals you. So does theirs.', twist: { lifesteal: 0.4 }, tint: 'rgba(150,0,30,0.16)', weather: 'embers' },
  { id: 'titans', name: 'Titans', tagline: 'Double health. Long fights. One partner.', mode: 'duos', map: 'island', xp: 0.4, rules: 'Everyone has double health.', twist: { hpMult: 2 } },
  { id: 'nightwatch', name: 'Night Watch', tagline: 'Ten waves you can hear before you see.', mode: 'zombies', map: 'city', xp: 0.6, rules: 'Thick fog: you see the horde late.', twist: { fog: true }, tint: 'rgba(10,20,60,0.2)' },
  { id: 'seekers', name: 'Seekers', tagline: 'The bullets do the aiming. All of them.', mode: 'deathmatch', map: 'desert', xp: 0.4, rules: 'Every bullet curves toward the nearest target.', twist: { homing: true } },
];
// one per season, live every third slot while that season runs
const SEASON_EVENTS = {
  bloom: { id: 's_bloom', name: 'Spring Sprint', tagline: 'Petals in the air, boots off the ground.', mode: 'gungame', map: 'grass', xp: 0.6, rules: 'Everyone moves 35% faster, in the blossom.', twist: { speedMult: 1.35 } },
  heatwave: { id: 's_heatwave', name: 'Scorcher', tagline: 'It is too hot for subtlety.', mode: 'deathmatch', map: 'desert', xp: 0.6, rules: 'Rocket launchers for all, in the midday heat.', twist: { weapon: 'rocket' } },
  harvest: { id: 's_harvest', name: 'Harvest Hunt', tagline: 'Last one standing in the falling leaves.', mode: 'solo', map: 'grass', xp: 0.6, rules: 'Autumn fields. Every gun fires faster.', twist: { rateMult: 0.65 } },
  frostfall: { id: 's_frostfall', name: 'Whiteout', tagline: 'Snow so thick you fight by ear.', mode: 'solo', map: 'snow', xp: 0.6, rules: 'A blizzard: nobody sees far.', twist: { fog: true } },
};

const Events = {
  SLOT_MS: 8 * 3600 * 1000, STARS: 10, force: {}, // force: { season, ev } from test hooks (?season= ?ev=)
  season(t) {
    if (this.force.season) { const s = SEASONS.find((x) => x.id === this.force.season); if (s) return s; }
    const m = new Date(t || Date.now()).getMonth();
    return SEASONS.find((s) => s.months.includes(m)) || SEASONS[0];
  },
  // Days until the season changes.
  seasonDaysLeft(t) {
    const now = new Date(t || Date.now()), s = this.season(t);
    let d = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 4 && s.months.includes(d.getMonth()); i++) d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return Math.max(1, Math.ceil((d - now) / 86400000));
  },
  slot(t) { const d = new Date(t || Date.now()); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / this.SLOT_MS); },
  endsIn(t) { const d = new Date(t || Date.now()), local = d.getTime() - d.getTimezoneOffset() * 60000; return this.SLOT_MS - (local % this.SLOT_MS); },
  // The event in a slot, with its season's dressing folded in.
  at(slot, t) {
    const season = this.season(t);
    let def = slot % 3 === 0 ? SEASON_EVENTS[season.id] : EVENTS[(slot - Math.floor(slot / 3)) % EVENTS.length];
    if (this.force.ev) def = EVENTS.concat(Object.values(SEASON_EVENTS)).find((e) => e.id === this.force.ev) || def;
    const seasonal = def.id.slice(0, 2) === 's_';
    return Object.assign({}, def, { slot, seasonal, season,
      weather: def.weather || (seasonal ? season.weather : null), tint: def.tint || (seasonal ? season.tint : null),
      palette: seasonal ? season.palette : null,
      twist: Object.assign({ id: 'event', event: true, name: def.name, xpBonus: def.xp }, def.twist) });
  },
  current(t) { return this.at(this.slot(t), t); },
  next(t) { return this.at(this.slot(t) + 1, t); },
  // The season's map as the menu shows it.
  menuMap() { const s = this.season(); return s.palette ? Object.assign({}, MAPS[s.map], s.palette) : MAPS[s.map]; },
  timeText(ms) { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + 'm' : m + 'm'; },
  // What the player has done: this slot's rewards, and stars toward the season's skin.
  state() {
    const d = Progress.data, s = this.season();
    if (!d.events || typeof d.events !== 'object') d.events = { slot: 0, played: false, won: false, season: s.id, stars: 0 };
    if (d.events.season !== s.id) { d.events.season = s.id; d.events.stars = 0; d.events.claimed = false; }
    return d.events;
  },
  // After an event match: gems the first time each event is played and won, stars, and the season skin at ten stars.
  // Adds its lines to the match's XP report (result from Progress.award).
  reward(ev, win, result) {
    const st = this.state(), d = Progress.data, season = this.season();
    if (st.slot !== ev.slot) { st.slot = ev.slot; st.played = false; st.won = false; }
    let gems = 0;
    if (!st.played) { st.played = true; gems += 5; result.gemLines.push({ label: 'Event played', n: 5 }); }
    if (win && !st.won) { st.won = true; gems += 10; result.gemLines.push({ label: 'Event won', n: 10 }); }
    d.gems += gems; result.gems += gems;
    const before = st.stars, gain = win ? 3 : 1;
    st.stars = Math.min(this.STARS, st.stars + gain);
    result.event = { name: ev.name, stars: st.stars, gain: st.stars - before, season: season.name, skin: null };
    if (st.stars >= this.STARS && !st.claimed) { st.claimed = true; Chars.state().megaBoxes = (d.megaBoxes || 0) + 1; result.event.skin = 'Mega Box'; } // the season's reward
    Progress.save();
    return result;
  },
};
