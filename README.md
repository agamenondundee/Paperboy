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

`game/index.html` is a small gothic action game: a lantern-bearing hunter
fights through waves of ghouls in a fog-drowned graveyard, with a
root-covered boss every third wave. Open it in a browser; it needs no build
step.

The scene is drawn on a 2D canvas and finished on the GPU with WebGL:
volumetric fog lit by the lanterns, light shafts through the branches,
bloom, heat shimmer, lens fringing, a filmic grade and grain. Without WebGL
it falls back to canvas effects, and it drops the costliest effects
automatically on slow devices. The hunter's cloak and scarf are simulated
cloth. Blood sprays, pools and stays on the ground; heavy blows can behead
ghouls.

Three weapons: the Hunter's Axe (balanced), the Bone Scythe (long reach,
its heavy attack spins and hits both sides) and the Blunderbuss (a spread
shot, or a point-blank blast for its heavy, using ammo that refills over
time). Ducking makes ghoul swipes pass overhead.

Controls: A/D move, W or Space jump, S duck, J or click to attack, K or
right click for a heavy attack, Shift to roll, E to drink a vial, Q or 1/2/3
to change weapon, P to pause, M for sound and B to turn blood on or off.
On phones and tablets on-screen buttons appear instead.
