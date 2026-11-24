# ISLA BRASA 3D

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/awalsa/gta6-07/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/awalsa/gta6-07/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A 3D third-person open-city crime game for the [make.fun GTA 6 bounty](https://make.fun/bounty/gta6-01), built with Three.js. Explore the sun-soaked island city of Isla Brasa on foot and by car, take on 12 story missions plus a 3-part heist, outrun the police as your wanted level climbs, and build respect from Nobody to Legend.

## The game

- **Open city** — 12 landmarks (Plaza Tower, Feria Market, Old Pier, Marina Docks, Coral Room Casino, and more), a road grid, beachfront, runway, a 360-second day/night cycle and toggleable rain.
- **Missions** — 12 story missions ($10,510 total) plus a 3-part heist (+$5,000), with goto, collect, clear, steal and deliver steps, glowing beacons and a HUD tracker.
- **Police** — 0–5 wanted stars, chasing police cars, real roadblocks at 3+ stars and the CONDOR-1 helicopter.
- **Vehicles** — 4 garage cars ($2,800–$12,000) with 3-tier upgrades, a motorbike, a boat, and a flyable Brasa Air plane (takeoff speed 22, ceiling 120).
- **Combat** — weapon wheel (hold Q): fists, pistol, SMG, shotgun, rifle, plus a buyable sniper and RPG.
- **Progression** — crew to hire (Rico, Marta, Ghost), respect ranks with +5% payout per rank, 3 street races, taxi and delivery side jobs, 10 hidden orbs, properties that pay daily income, a casino (slots, blackjack, roulette), enterable interiors, clothes and weapon shops, pedestrians, traffic AI, radio stations and a WebAudio soundtrack.

## Controls

WASD move · Shift run · E enter/exit car · F interact/talk · Q weapon wheel (hold) · G shop/garage · R race · M map · V rain · N mute · H help

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

Three.js is vendored locally under `game/vendor/three.module.min.js` and mapped by the import map in `game/index.html`, so the game loads with no network request. Everything else is static files under `game/` — no build step.
