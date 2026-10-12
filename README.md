# Historic Houses

A static website introducing twelve historic houses, from Hardwick Hall to Fallingwater.

## Features

- Searchable, filterable gallery (by region and century)
- Detail pop-up for each house with dates, architect, history and highlights
- Timeline and a short guide to recognising architectural styles
- Light and dark themes, responsive down to phone width
- No build step and no dependencies

## Running it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Adding a house

Add an entry to `js/houses.js`. The `style` field picks the façade drawing:
`elizabethan`, `baroque`, `palladian`, `gothic` or `modern`.

## Hollow Lantern (game)

`game/index.html` is a gothic arcade action game set in the Cursed Abbey: a
lantern-bearing hunter fights waves of the dead along a stone bridge lit by
stained glass, braziers and candles, with a root-covered boss every third
stage. Open it in a browser; it needs no build step.

The scene is drawn on a 2D canvas and finished on the GPU with WebGL:
a crisp pixel-art grid, vivid grading, volumetric fog lit by the lantern
and torches, light shafts from the moon, bloom and lens effects. Characters
are rim-lit by the lantern and the moon. Without WebGL it falls back to
canvas effects, and it drops the costliest effects automatically on slow
devices. The hunter's cloak and scarf are simulated cloth.

The arcade HUD shows a portrait, hearts, stamina, weapon and vial slots, a
hunt meter for the stage, the stage name, a minimap, the score and credits.
Dying with credits left lets you continue where you fell.

Enemies, each with its own counter: ghouls swipe high (duck), Grave Hounds
lunge low (jump or roll), Carrion Crows dive (strike or roll), Wraiths
charge at head height (duck), Choir Witches throw high and low hexes (duck,
jump, or cut them down) and the Butcher shrugs off light blows (roll from
its chop, duck its sweep, stagger it with heavy attacks).

Three weapons: the Hunter's Axe (balanced), the Bone Scythe (long reach,
its heavy attack spins and hits both sides) and the Blunderbuss (a spread
shot, or a point-blank blast for its heavy, using ammo that refills over
time).

Controls: A/D move, W or Space jump, S duck, J or click to attack, K or
right click for a heavy attack, Shift to roll, E to drink a vial, Q or 1/2/3
to change weapon, P to pause, M for sound and B to turn blood on or off.
On phones and tablets on-screen buttons appear instead.
