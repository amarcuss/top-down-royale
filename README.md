# Top-Down Royale

A single-player top-down shooter in the browser with five maps and ten game modes (battle royale, arena modes, a story campaign and a 40 v 40 trench war), bots, a shrinking zone, loot, and persistent XP progression. Zero dependencies, no build step.

## Run

Open `index.html` in a browser, or serve the folder:

```
npx serve .
```

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim; hold left button to fire (every weapon fires at its own rate) |
| Esc | Release the mouse (click the game to capture it again) |
| R | Reload |
| 1-3 or wheel | Switch weapon |
| E | Get in or out of a car; swap weapon when all 3 slots are full; hold for objectives (plant, defuse, grab, light) |
| F | Use medkit |
| G | War: throw a grenade at the cursor |
| T | War: call an artillery fire mission on the cursor |
| C | War: next kit |
| M | Mute |
| P | Pause (losing the mouse with Esc also pauses) |

### Touch (phones and tablets)

On a touchscreen the game shows its own controls (`body.touch`, set in `js/input.js`); a real mouse switches them off again. Play in landscape.

| Control | Action |
| --- | --- |
| Left thumb, anywhere on the left half | Move (a stick appears under the thumb) |
| Right thumb, anywhere on the right half | Fire while it is down; drag to aim. Held still, it fires the way you are facing. With the stick released you face the way you walk |
| Weapon slots | Tap a weapon to switch to it; tap the one in your hand to reload (it also reloads by itself when empty) |
| MED, USE | F and E. USE appears when there is something to use; hold it for objectives |
| NADE, ARTY, KIT | War: G, T and C; they land where the crosshair is, further out the further the aim stick is pushed |
| II | Pause (the game also pauses when the page is hidden) |

With aim assist on, touch aiming is nudged toward a visible enemy within about 11 degrees of the stick: up to 75% of the error when nearly on target, fading to nothing at the edge of the cone. On a touchscreen every difficulty's bot lethality is multiplied by `TOUCH_L` (0.45, in `js/game.js`), and `toughenBot` fades the Easy handicaps out between 0.1 and 0.3 so those in-between values mean something; the XP bonus still follows the difficulty you picked. On an iPhone, Share > Add to Home Screen runs the game full screen without the browser bars.

Aim assist (toggle on the start screen, on by default) nudges the cursor toward a visible enemy only while you are already moving it toward them. It never changes where bullets go.

## Modes

| Mode | Players | Rules |
| --- | --- | --- |
| Campaign | You, sometimes a squad | Six story missions with staged objectives (see below) |
| Solo | 32 | Zone shrinks, last one standing |
| Duos | 16 x 2 | Teammates follow you, no friendly fire, last squad standing |
| Squads | 8 x 4 | Same as Duos with squads of four |
| Mega | 100 (25 x 4) | Squads on a 9000px map (four times the area) with a road grid, 46 cars and a circle that closes at half speed |
| Deathmatch | 12 | Smaller arena, no zone, respawns, 4 minutes, most kills wins |
| Gun Game | 12 | Each kill upgrades your gun (Pistol > SMG > Shotgun > Rifle > Sniper > Rocket). First kill with the rocket wins. No loot, infinite ammo |
| Bomb | 5 v 5 | Demolition on the arena. Attackers carry a bomb and plant it at site A or B (hold E, 3s), then hold it for 35s. Defenders win by killing all attackers before the plant, running the 80s clock, or defusing (hold E, 5s). Sides swap every round; first to 4 rounds. When you attack, you carry the bomb; if you die it drops for a squadmate |
| Zombies | 4 (you + 3 squadmates) | Co-op survival in a small arena. 10 waves of melee undead (Walkers, Runners from wave 2, Toxics from wave 3 whose bite poisons you through shields and who burst into a lingering cloud, Brutes from wave 4). A medkit cures poison, each wave bigger and tougher. Downed humans return at the start of the next wave; a supply drop and +30 hp follow every cleared wave. Everyone dead = overrun. Clearing wave 10 wins |

## Campaign

Six story chapters played in order; clearing one unlocks the next (progress is saved). You are Wren, the one resistance fighter who got back into Harrow Valley after Marshal Dray's Ashen Guard seized it, with Atlas on the radio.

The story is told three ways: a briefing screen before every mission (chapter, story, numbered objectives and a picture of the map with its places named), radio lines during the mission, and a debrief afterwards that sets up the next chapter.

Every mission has its own hand-built map. The layout is fixed (same map every time; only loot is random), places are named on the ground and announced when you walk in, and objectives are things in those places: a console in a hut, a gate in a wall, a man by a campfire.

| # | Mission | Map | Places | What you do |
| --- | --- | --- | --- | --- |
| 1 | First Light | Grasslands | Drop Point, Mill Farm, Relay Station, LZ Bravo | Clear the relay yard, send the signal from the control hut, reach the helipad |
| 2 | Knock Knock | Gridlock | Safehouse, Market Square, Payroll Depot | Blow the depot gate, clear the yard, take the ledgers from the office, carry them home (2 squadmates) |
| 3 | A Quiet Word | Frostline | Trailhead, Frozen Lake, Logging Camp, Ranger Station | Kill Quartermaster Brask at the camp, then reach the helipad in 60s |
| 4 | Fuel Run | Dunes | Guard Motor Pool, Checkpoints Alpha/Bravo/Charlie, Dry Wells, Resistance Depot | Steal the fuel truck and drive it down the Saltway through three roadblocks |
| 5 | Hold Fast | Atoll | Fishing Village, Lighthouse, North/East/West Beach | Light the lighthouse and hold it for 80s against landings from the beaches (3 squadmates) |
| 6 | Kingfall | Grasslands | Forward Camp, Ashford, Fortress Dray, the Keep, LZ Echo | Breach the fortress, kill Marshal Dray in the Keep, reach the helipad in 55s |

There is no zone, the mission fails if you die (or a timer runs out, or the truck burns), and RETRY restarts it without the briefing. Objectives are marked with a gold ring, an arrow at the screen edge and a diamond on the minimap. Mutators are ignored; difficulty applies. XP: 80 + 20 per mission number for a clear, +100 the first time.

Missions are data in `js/campaign.js`. Each has `map(b)`, which lays the map out with a `MapBuilder` (roads, rooms with doors, sealed compounds with a gate, tents, towers, tanks, sandbags, labels, seeded scatter of trees and rocks) and returns its named locations, and `build(h, game, L)`, which posts the guards and returns the stages (`reach`, `clear`, `kill`, `hold`, `breach`, `survive`, `deliver`).

## Cars

The royale modes have cars (5 on the normal map, 46 in Mega), parked along the roads and shown as yellow dots on the minimap.

| Car | Seats | Health | Top speed |
| --- | --- | --- | --- |
| Buggy | 2 | 240 | 650 |
| Sedan | 4 | 360 | 590 |
| Truck | 4 | 620 | 480 |

- Walk up and press E. The first one in drives: WASD points the car and it turns and accelerates that way; pointing straight behind a slow car backs it up. Squadmates fill the other seats.
- The driver cannot shoot. Passengers can.
- Cars are faster on roads, smash through crates (some drop loot), and are stopped and damaged by buildings, trees and rocks.
- Hitting an enemy at speed runs them over (damage scales with speed). Bots try to step out of the way.
- A car stops bullets and shields whoever is inside. At zero health it throws everyone out and explodes, so get out when it smokes. Explosions do 1.5x damage to cars.
- Bots use cars too: squads ride with their leader, stragglers grab one to outrun the circle, and aggressive drivers will come at you.

Stats live in `VEHICLES` in `js/entities.js`; the per-mode count is `cars` in `js/modes.js`.

## Maps

| Map | Feel |
| --- | --- |
| Grasslands | Fields, small towns, plenty of trees |
| Dunes | Open sand, adobe towns, long sightlines |
| Frostline | Dense pine forest, close-quarters |
| Gridlock | City blocks and streets |
| Atoll | Round island ringed by sea |

Mode, map, difficulty and mutator are picked on the start screen (mode cards, map thumbnails, a live map drifting behind the panel) and remembered. Definitions live in `js/modes.js` (zombie stats in `ZOMBIE_TYPES`, wave size in `Game.waveSize`).

Zombies pays XP differently: 3 XP per zombie, 10 XP per wave cleared (scaled by horde size), 150 XP for surviving all ten, no placement bonus.

### Keeping it interesting after the shop is empty

- **Power-up slots**: you can own every power-up but equip only 3 at a time (EQUIP in the shop). Prestige adds a slot, up to 6.
- **Prestige**: once everything is owned, the PRESTIGE button on the profile resets XP and unlocks for a permanent rank (stars by your level), +1 slot, +10% XP per rank and the exclusive Prestige skin.
- **Challenges**: three active goals from a pool of 18 (`CHALLENGES` in `js/progress.js`), shown on the start screen with progress. Each pays XP when done and is replaced.
- **Mutators**: an optional MUTATOR picker. Pistols Only, Rockets Only, Glass Cannon (half health, no shields), Overdrive (+40% speed), Fog (short sight, bots too) or Random. Mutator matches pay +20 to +30% XP. Gun Game ignores weapon mutators.
- **Reset all progress** link at the bottom of the start screen (also `?reset`).

### Difficulty

The start screen has a DIFFICULTY picker: Easy, Normal, Hard, Nightmare, or Adaptive (default). Difficulty sets bot lethality (`DIFFICULTIES` in `js/progress.js`, applied in `Game.toughenBot`): reaction time, aim steadiness, trigger discipline, view range, spawn shield and power-ups. From Hard up, bots also hunt the sound of your gun (`Game.onShot` marks where they heard you; the brain's "hunt" state walks there) and prefer shooting you over other bots. Adaptive starts at Normal (the floor) and moves after every match: a win raises it a full step, a loss lowers it a little, and the result panel shows where it landed. Normal itself is a quick, accurate bot; Easy is the warm-up. Harder difficulties pay an XP bonus of up to 60%. Zombies waves grow with difficulty too.

Test hook: `?diff=nightmare`.

### Difficulty scales with your shop

Owned power-ups and perks raise a threat multiplier (`Progress.threat()`, shown as "Lobby x1.8" or "Horde x1.8" on the start screen and HUD). Each combat power-up adds 0.2, each perk 0.08, a starting gun 0.1 to 0.35. In Solo, Duos, Squads, Deathmatch and Gun Game the bots aim and react better, arrive with shield, and some carry random power-ups and perks of their own (`Game.toughenBot`). In Zombies the waves are larger, the zombies tougher and brutes more common (`Game.waveSize`, `Game.spawnZombie`). Zone Resist and Eagle Eye are free.

## Weapons

| Weapon | Damage | Notes |
| --- | --- | --- |
| Pistol | 14 | Starting weapon |
| SMG | 9 | Fast, short range |
| Shotgun | 9 x7 | Close range |
| Rifle | 18 | All-rounder |
| Sniper | 72 | Very long range, slow |
| Rocket Launcher | 90 + 70 splash | Rare. Slow projectile, 110px blast radius, hurts you too at point blank |

## Progression

XP is earned every match and saved in the browser (localStorage):

| Source | XP |
| --- | --- |
| Match played | 20 |
| Each kill | 25 |
| Placement | #1: 150, top 3: 90, top 5: 60, top 10: 35, top 15: 15, else 5 |
| Survival | 2 per 10 seconds |

Spend it in the SHOP (start screen or results screen). Rules and items live in `js/progress.js`.

- Starting weapons: SMG, Shotgun, Rifle, Rocket Launcher (equip one)
- Perks: max health, starting shield, speed, reload speed, starting medkits, ammo from pickups
- Power-ups, each with a downside: Tracking Bullets (homing, -12% speed), Explosive Rounds (splash, every shot costs 2 health), Piercing Rounds (pass through one enemy, -15% damage), Big Mags (+50% mag, +40% reload time), Rapid Fire (+25% rate, +60% spread), Vampire (heal 20% of damage dealt, -25 max health), Second Wind (survive one killing blow per match, -20 max health), Zone Suit (half zone damage, -8% speed), Eagle Eye (wider view, no downside)
- Skins: 24 looks with patterns (stripes, halves, rings, spots, stars), hats and faces (crown, helmet, horns, halo, skull, grin, scowl, cat, panda, ninja, jester, robot, pumpkin), glowing eyes, pulsing auras and particle trails. Defined as objects on the skin items in `js/progress.js`, drawn by `Renderer.drawSkin`, previewed live in the shop. Bots wear random skins too (one per squad in team modes).

## Structure

- `js/utils.js` math helpers
- `js/sound.js` procedural WebAudio sound effects
- `js/weapons.js` weapon stats
- `js/modes.js` map themes, game mode rules, zombie types
- `js/progress.js` XP rules, shop items, save/load
- `js/world.js` map generation, collision grid, zone, loot
- `js/entities.js` actors, bullets, cars, particles
- `js/ai.js` bot brain (perceive, decide, act) and the zombie brain
- `js/campaign.js` story missions and the objective engine
- `js/war.js` War mode: the battlefield, positions and reinforcements, tanks, MG nests, artillery, grenades, and their drawing
- `js/input.js` keyboard and mouse state
- `js/render.js` canvas renderer and minimap
- `js/game.js` game loop, rules, HUD

## Tuning

- Weapon balance: `js/weapons.js`
- Zone timing and damage: `Zone.phases` in `js/world.js`
- Player count: `PLAYER_COUNT` in `js/game.js`
- Bot difficulty: `skill` range in `BotBrain` constructor in `js/ai.js`


## Balance test

Headless bot-vs-bot match (no browser), prints match length, deaths, shots. Set MAP to pick a map:

```
node tools/sim.js
MAP=city node tools/sim.js
```

`tools/dom-sim.js` runs the real `Game` class with the DOM stubbed out (every mode, cars, HUD, rendering), so it also catches runtime errors. Options are listed at the top of the file:

```
MODE=mega FULL=1 ALIVELOG=1 CARLOG=1 node tools/dom-sim.js
MODE=campaign MISSION=2 CAMPTEST=1 node tools/dom-sim.js   # walks every objective, must end in a win
```

## Debug hooks

URL parameters on `index.html` for testing without clicking through menus:

- `?autostart` starts a match immediately
- `?autofire` holds the fire button
- `?warmup=120` simulates 120 frames before the first draw
- `?pick`, `?contracts`, `?daily` open the setup board, contracts sheet or daily reward on load; `?gems=100` adds gems (testing only)
- `?debug` shows a frame/shot/mouse readout
- `?touch` shows the touchscreen controls and phone layout without a touchscreen (`--window-size=844,390` for a phone in landscape)
- `?mode=duos&map=snow` preselects mode and map (`?mode=zombies&autostart&warmup=720` lands mid wave 1)
- `?mission=3` selects (and unlocks up to) a campaign mission; `&brief` opens its briefing, `&autostart&goto` starts beside its first objective
- `?car=sedan` (or `buggy`, `truck`) starts you behind the wheel
- `?shop` opens the shop on load, `?xp=500` adds XP, `?own=all` unlocks every item, `?start=rocket` equips a starting weapon (testing only)

Example headless screenshot with Chrome:

```
chrome --headless=new --screenshot=shot.png --window-size=1600,900 "file:///C:/path/to/index.html?autostart&autofire&warmup=60"
```

Runtime errors are shown in a red box at the bottom left of the page.

## War

40 v 40 on one long battlefield (7600 x 4200): the Coalition (you, blue) in the west against the Dominion (red) in the east. Five positions (A to E, named differently each battle) lie between the two headquarters. An army can only capture the position next to the ones it holds, so there is always one front. Take all five, or run the enemy out of reinforcements: every death costs one, and holding fewer positions bleeds them. When the clock runs out the army with more left wins. That is Frontline; the other battle types below change the rules.

- **Positions** are wide sectors of the front (dashed outline). Standing in one moves it; outnumbering the enemy moves it faster. Inside a position you hold you are resupplied and your tank is repaired.
- **Trenches**: most bullets fired from more than 140px away pass over anyone standing in one, and blasts do half damage. Clear them up close, with grenades, or with a tank.
- **Barbed wire** slows anyone on foot. Tanks flatten wire, sandbags and crates.
- **Tanks**: armoured against bullets; hold fire for the cannon and the machine gun, the turret follows the cursor. Yours is parked behind the front (yellow on the minimap) and is replaced 50s after it is lost. Rockets (dropped by anti-tank soldiers), tank shells and artillery kill tanks.
- **MG nests**: press E to man one; defenders do the same.
- **G** throws a grenade (over sandbags, into trenches). **T** calls an artillery fire mission on the cursor every 45s. Red rings are enemy shells about to land.
- **Kits**: you are dealt one of six at the start of each battle and **C** cycles through them (issued at once inside a position you hold, otherwise at your next respawn): Rifleman (four grenades), Assault (SMG, shotgun, heavy armour), Machine Gunner, Marksman, Anti-Tank (six rockets) and Medic (five medkits; soldiers near you heal). `WAR_KITS` in `js/war.js`.
- **More battle types**: Hill Fight (only the middle can change hands, no lulls or offensives, first army to hold it for 180 seconds in total wins; whoever is storming it counts for more than whoever is sitting on it), Night Raid (12 v 12 in the dark, no tanks, artillery or aircraft, three positions in play) and Tank Battle (five tanks a side arriving every 10s, yours replaced after 12s).
- **No two battles alike**: the BATTLE picker on the start screen chooses Frontline (two positions each and a race for the middle), Breakthrough (you hold four and they are down to their last trench; storm it or bleed them dry inside 13 minutes) or Last Stand (they hold four and you are down to your last trench; hold it for 12 minutes), or Random. Every battle also rolls its ground: where the trench lines run, which side the forward positions are on, what they are (farm, quarry or bunkers), what the middle is (village, fort, wood or crossroads), the place names, and the light (day, dawn, dusk, night, overcast).
- **Offensives**: who attacks next is rolled each time (the army holding less attacks more often; nobody attacks three times running), lulls and offensives vary in length, and an offensive comes in one of four ways: infantry behind a barrage, an armoured thrust with extra tanks, a long creeping barrage, or a smoke assault (anyone in smoke is as hard to hit as someone in a trench).
- **Events**: a lull may bring a strafing aircraft along one army's forward position, a supply drop between the lines (a rocket launcher, a second weapon, medkits and armour, marked in yellow), or fog that halves how far everyone sees until it lifts.
- Bot soldiers come in five classes (rifleman, assault, gunner, marksman, anti-tank) and return in waves (every 10s in most battles); you return after 5s. Difficulty changes the enemy army only (aim, reactions and reinforcements); your own army is always Normal.

Rules and numbers are in `js/war.js` (`WAR_VEHICLES`, `WAR_CLASSES`, `War.share`, `War.tickPhase`, `War.updatePoints`) and `MODES.war` in `js/modes.js`. To measure a battle: `MODE=war WARLOG=1 node tools/dom-sim.js` (add `CAUSES=1` for what killed everyone). Battle types are `WAR_BATTLES`, offensive kinds `WAR_PUSHES`, names `WAR_NAMES`; the terrain is rolled at the top of `War.build`. Test hooks: `?mode=war&autostart`, `&tank` to start in your tank, `&battle=front|assault|defend|hill|raid|armour`, `&fwd=farm|quarry|bunkers`, `&mid=village|fort|wood|crossroads`, `&sky=night`, `&event=air|supply|fog|smoke|armour|barrage` (happens at once, beside you). The harness takes `BATTLE`, `FWD` and `MID`, and `STUCK=1` counts bots that are not getting where they are going.

## Gems

A second currency beside XP (`GEM_RULES` in `js/progress.js`): +10 for a win, +10 per contract, +15 per level, +10 for finishing the tutorial, and a daily reward that climbs 5, 8, 10, 12, 15, 20, 30 over seven consecutive days (a missed day starts again). Gems buy the three gem-only skins, an XP Crate (+400 XP for 30 gems) and a contract reroll (5 gems) in the shop's Gem store. Gem purchases survive prestige and are not needed for it.

## New players

- **Tutorial** (`js/tutorial.js`): the first match shows five prompts in the HUD, each ticked off when the player does it (move, fire, pick something up, weapons, the goal). SKIP ends it; OPTIONS > Replay tutorial brings it back. Campaign missions never show it.
- **Warm-up**: a profile's first three matches are played against Easy bots whatever difficulty is selected (`this.warmup` in `Game.start`).
- **Options** (the three-bar chip on the hub): aim assist, sound, replay tutorial, reset, and **backup codes**. `Progress.exportCode()` is the whole save as `TDR1.<base64 JSON>`; `Progress.importCode()` validates and restores it. Saves otherwise live only in this browser's localStorage.
- **Portraits**: `Renderer.drawPortrait(canvas, skin)` draws the front-facing fighter for the hub and shop from the same skin data the in-match sprite uses.
- Test hooks: `?notutorial`, `?veteran` (also skips the warm-up matches), `?options`.
