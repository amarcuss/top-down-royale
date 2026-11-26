# App Store listing: Top-Down Royale

Draft text and answers for App Store Connect. Character limits are Apple's.

## Identity

| Field | Value |
| --- | --- |
| App name (30) | Top-Down Royale |
| Subtitle (30) | Battle royale, bots, no wifi |
| Bundle ID | `com.amarcuss.topdownroyale` (set in `capacitor.config.json`; change it before the first upload if you want a different one, it cannot change afterwards) |
| SKU | topdownroyale-ios |
| Primary category | Games > Action |
| Secondary category | Games > Casual |
| Price | Free |
| Version | 1.0.0 |

## Promotional text (170)

Drop in, grab a gun and be the last one standing. Ten modes, a story campaign and a 40 v 40 trench war, all playable offline against bots.

## Description (4000)

Top-Down Royale is a fast top-down shooter you can play anywhere, with no connection and no waiting for a lobby.

DROP IN
Thirty-two fighters land on a shrinking map. Loot weapons, shields and medkits, stay inside the zone, and be the last one standing. Matches take a few minutes.

TEN WAYS TO PLAY
- Solo, Duos and Squads battle royale
- Mega: 100 players, with cars to drive
- Deathmatch and Gun Game
- Zombies: four-player co-op survival through ten waves
- Bomb: 5 v 5 attack and defend
- Campaign: six story missions
- War: 40 v 40 trench battles with tanks, artillery and machine-gun nests

BUILT FOR THUMBS
Move with your left thumb, aim and fire with your right. Optional aim assist, and a short tutorial in your first match.

MAKE IT YOURS
Earn XP and gems by playing. Unlock starting weapons, perks and power-ups, and pick from 46 skins, from pandas and pirates to dragons and astronauts. Daily rewards and contracts give you something new to chase each day.

FAIR AND PRIVATE
No ads. No purchases. No account. Nothing is collected: your progress stays on your device, and you can back it up with a code.

## Keywords (100, comma separated)

shooter,battle royale,top down,offline,bots,zombies,deathmatch,arcade,war,tanks,survival,2d,guns

## What's New (first version)

First release.

## URLs

| Field | Value |
| --- | --- |
| Support URL | https://amarcuss.github.io/top-down-royale/privacy.html |
| Marketing URL | https://amarcuss.github.io/top-down-royale/ |
| Privacy Policy URL | https://amarcuss.github.io/top-down-royale/privacy.html |

## App Privacy ("nutrition label")

Data collection: **No, we do not collect data from this app.** (No analytics, ads, accounts or network calls; saves are in local storage on the device.)

## Age rating questionnaire

| Question | Answer |
| --- | --- |
| Cartoon or fantasy violence | Frequent/Intense (top-down cartoon gunfights against bots and zombies) |
| Realistic violence | None |
| Horror/fear themes | Infrequent/Mild (cartoon zombies) |
| Profanity, mature themes, alcohol, gambling, contests | None |
| Unrestricted web access | No |
| User-generated content, messaging, chat | No |
| In-app purchases | No |

Expect a rating of about 9+ to 12+ from these answers.

## Export compliance

Uses no encryption beyond what iOS provides (`ITSAppUsesNonExemptEncryption` is `false` in `Info.plist`), so no documentation is needed.

## Review notes (for the Apple reviewer)

Single-player game against computer-controlled bots. No login is needed. Everything works offline. There are no purchases; XP and gems are earned by playing. The first match shows a short tutorial that can be skipped.

## Assets in this folder

- `screenshots/` : six 2796 x 1290 landscape screenshots (accepted for the 6.9-inch iPhone slot, which Apple scales down for smaller iPhones). The app is iPhone-only, so no iPad screenshots are required.
- App icon: `icons/icon-1024.png` (already placed in the Xcode project).

## Things only the account holder can do

1. Enrol in the Apple Developer Program (US$99 a year) at developer.apple.com.
2. In App Store Connect, create the app with the bundle ID above and paste in this listing.
3. On a Mac with Xcode: `npm install`, `npm run ios:sync`, `npx cap open ios`, pick your team under Signing, then Product > Archive > Distribute to App Store Connect.
4. Add the build to the version, attach the screenshots, answer the questionnaires above and submit for review.
