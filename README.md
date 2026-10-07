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
