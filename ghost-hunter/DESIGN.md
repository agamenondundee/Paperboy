# Brodie the Ghost Hunter: Hollow Creek High (design spec)

A first-person horror game in the browser. TypeScript, Vite, three.js 0.169,
`postprocessing` 6.36. British English in all player-facing text, and no em
dashes anywhere in text the player sees.

Goals, in priority order:

1. **Smooth.** Steady 60 fps on a mid-range laptop at "high". Fixed 60 Hz
   simulation with interpolated rendering; mouse look applied per rendered
   frame. Few draw calls (geometry merged per material, instancing for
   repeats). Fixed-size light pool so shaders never recompile mid-game.
   Shaders compiled before play starts. No per-frame allocations in hot paths.
2. **Good looking.** Moody, cinematic, physically based. HDR pipeline:
   bloom, ACES tone mapping, film grain, vignette, chromatic aberration that
   rises with fear. Torch is the only real-time shadow caster indoors.
   Glossy floors pick up the environment map. Volumetric-looking light cones,
   fog, rain and dust.
3. **Tense and fair.** Clear rules, readable audio cues, no cheap deaths.

## Story

Hollow Creek High closed after prom night, 16 May 1987. Prom queen Jenny Hale
vanished, the janitor locked every door, and Principal Hale (her father) never
came home. Every clock stopped at 11:47. Brodie, a level 99 ghost hunter,
pulls into the car park in the rain to put the three spirits to rest.

## Flow

Loading screen → title screen (Higgsfield title art if present, otherwise the
live 3D scene slowly panning in the rain) → choose difficulty → optional intro
video (`src/assets/gen/intro.mp4`, skippable, plays only if present) → play.

Phases: `intro` (outside, walk to the front doors) → `hunt` (doors slam and
lock when the player first enters the lobby) → `escape` (after the third
spirit is banished) → `won` or `lost`.

## World

The floor plan lives in `src/world/map.ts` (3 m cells, thin walls on cell
edges, doorways, collision boxes, line of sight, pathfinding). Rooms: six
classrooms, hallway loop, gym (7.5 m ceiling, prom decorations, stage),
library, principal's office, boiler room, science lab, entrance lobby,
cafeteria, kitchen. Outside: rainy car park with Brodie's car, lamp posts,
fence.

## Player

| Thing | Value |
|---|---|
| Radius | 0.3 m |
| Eye height | 1.65 m standing, 1.1 m crouched |
| Speeds | walk 2.6, run 5.2, crouch 1.4 m/s; acceleration smoothing rate 12 |
| Stamina | 100; running drains 22/s; regenerates 14/s after 1 s; at 0 you are winded until 30 |
| Noise radius | run 12 m, walk 5 m, crouch 0.5 m, locker clank 8 m, gasp 7 m |
| Nerve | 100 = health. Falls while a ghost is close and on screen, and when attacked. Recovers 1.5/s when safe (hidden, or no ghost within 15 m). 0 = caught |
| Torch | on by default, F toggles. Off makes you harder to see in the dark |
| UV beam | hold to fire. Battery 100, drains 14/s (times difficulty drain), recharges 3/s when off. Cone half-angle 0.22 rad, range 12 m |
| Lockers | E to hide or leave. Inside: limited look, hold breath with Space/beam button |
| Breath | 100; holding drains 22/s, recovers 15/s; at 0 you gasp (noise) and cannot hold again for 1.6 s |

## Spirits

Each spirit is anchored by a relic. Without its relic the UV beam only repels
it (after 1.2 s of exposure it dissolves and reappears at least 25 m away).
Carrying its relic lets the beam burn it down; at 0 HP it is banished.
Picking up a relic angers that spirit: it knows where you are for 10 s.

| Spirit | HP | Wander / chase speed | Damage | Gimmick |
|---|---|---|---|---|
| The Prom Queen (Jenny) | 100 | 1.4 / 3.3 | 25 | Hums a lullaby (positional). Teleports behind you when unseen. Hovers. |
| The Janitor | 140 | 1.6 / 2.6 | 32 | Keys jingle. Hears twice as far. Checks lockers he heard you enter. |
| Principal Hale | 120 | 1.5 / 5.0 | 40 | Only moves when not on screen; freezes mid-stride when looked at. Clock ticking. |
| The Hollow (escape only) | n/a | 4.4 | 30 | Unbanishable. UV slows it to 1.5. Chases during the escape. |

Speeds scale with difficulty. Sight range 14 m times difficulty sight, +5 m
if your torch is on, halved if you are crouched with the torch off. Ghosts
wander, investigate noises, chase on sight, search the last known position,
and give up after a while. Lights flicker when a ghost is within 6 m. The EMF
meter in Brodie's left hand shows the nearest ghost: levels 0 to 5 at
>22, >15, >10, >6, >3, ≤3 m.

Attack: when a ghost reaches you (1.1 m) it triggers a 3D jump scare (ghost
snaps into your face, red flash, scream, camera shake; softer with the
"gentle" setting), deals damage, then vanishes and reappears far away.

Lockers: if a ghost saw you get in, it comes and lingers 6 to 9 s. While a
ghost is within 3.2 m and you are not holding your breath, suspicion builds
1.0/s; at 1.2 it rips the door open (attack +10 damage).

## Items

* Relics: crown (gym stage / gym bleachers / music room), key ring (boiler
  room / kitchen / art room), attendance register (principal's office /
  library / maths room). One spot of three is chosen per run.
* UV-only clues: glowing handprint and footprint trails that only show inside
  the UV beam, leading from a hallway to each relic, plus UV writing on a
  wall near each relic.
* 6 notes (lore plus a hint at each relic's room), 6 UV cells (+60 battery),
  4 chocolate bars (+30 nerve).

## Escape

After the third banishing: front doors unlock, the bell rings, the lights die
except red emergency lights, a timer starts (90 s normal, 120 easy, 70
nightmare), and the Hollow appears behind you. Reach the car to win. If the
timer runs out the doors lock again and you lose.

## Difficulty

See `DIFFICULTY` in `src/core/settings.ts`. Continues: on losing, if any are
left, you come round in the lobby with 60 nerve and the spirits scattered.

## Score

`5000 + 400 × notes + 20 × nerve remaining − 3 × seconds − 1500 × continues
used`, times the difficulty multiplier, floored at 0. Ranks: S ≥ 8000,
A ≥ 6500, B ≥ 5000, C below. Best score per difficulty saved locally.

## Controls

WASD move, mouse look (pointer lock), Shift run, C or Ctrl crouch, left
mouse or Space UV beam (Space holds breath in a locker), E or right mouse
interact, F torch, Tab or M map, Esc or P pause. Gamepad and touch supported
(see `src/core/input.ts`).

## Higgsfield art slots

Optional files in `src/assets/gen/`, discovered at build time with
`import.meta.glob`, so a missing file is simply absent (no failed requests).
Every one must have a code fallback and a missing file must never break the
game.

| File | Used for |
|---|---|
| `title.png` | title screen background |
| `ending.png` | win screen background |
| `intro.mp4` | intro cutscene |
| `face-queen.png`, `face-janitor.png`, `face-principal.png` | 2D flash frame layered over the 3D jump scare |
| `poster-missing.png`, `poster-prom.png` | corridor posters |
| `wall.png`, `floor.png` | hallway wall and floor colour maps |

## Settings

Mouse sensitivity, invert Y, field of view, volume, graphics quality
(low/medium/high/ultra), head bob, gentle mode (fewer flashes, softer
scares), captions for sounds, FPS counter. Saved locally.
