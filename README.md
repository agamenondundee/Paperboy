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
with a long axe fights through waves of ghouls in a fog-drowned graveyard,
with a root-covered boss every third wave. Open it in a browser; it needs
no build step.

The scene uses bloom, per-character lantern lighting, god rays, colour
grading and film grain, and drops the costliest effects automatically on
slower devices. Blood sprays, pools and stays on the ground; heavy blows
can behead ghouls.

Controls: A/D move, W or Space jump, J or click to swing, K or right click
for a heavy blow, Shift to roll, E to drink a vial, P to pause, M for sound
and B to turn blood on or off.
On phones and tablets on-screen buttons appear instead.
