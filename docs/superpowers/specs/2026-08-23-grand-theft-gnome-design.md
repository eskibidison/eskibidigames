# Grand Theft Gnome — design

A top-down open-world game in the shape of GTA, scaled down to a suburb and
a crime nobody minds. You steal garden gnomes and drive them to your shed.
The police are geese.

Audience: the same young siblings who play the other games in this repo.
Everything below is tuned for generosity — no death, no timer, no fail state.

## Goals

- Playable in one sitting, in a browser, with no install and no server.
- Recognisably GTA-shaped: free-roam city, steal a car, drive it, get chased,
  deliver the goods, score goes up.
- Deliberately worse than GTA in ways a child finds funny, not in ways that
  make it hard to play.
- Art from Kenney's CC0 racing pack; no asset is drawn by hand or licensed.

## Non-goals

- Missions, story, dialogue trees.
- Violence of any kind. Nobody is hurt; the worst outcome is embarrassment.
- Mobile/touch controls.
- Multiplayer, save slots beyond a single high score.

## Files

| Path | Role |
|---|---|
| `gtg/index.html` | The game: markup, styles, and all game code. Hand-written. |
| `gtg/sprites.js` | Generated. One atlas PNG as a data URI plus a frame table. |
| `tools/png.js` | Dependency-free PNG decode/encode. Hand-written, reusable. |
| `tools/build-sprites.js` | Downloads the Kenney pack, packs the atlas, writes `sprites.js`. |
| `gtg/test/playtest.js` | Node harness that plays the game headlessly and asserts. |

Two files ship rather than one so the hand-written source stays readable next
to a ~150KB base64 blob. `index.html` loads `sprites.js` with a classic
`<script src>`, which works over `file://`, so the game still opens by
double-clicking it.

## Art

Kenney "Racing Pack" (CC0, https://kenney.nl/assets/racing-pack). Used:

- **Cars** — `car_{black,blue,green,red,yellow}_{1..5}`, true top-down and
  therefore free to rotate. 71×131px.
- **People** — `character_*`, top-down head-and-shoulders blobs. 52×36px.
- **Props** — trees, barrels, cones, barriers, tyres, rocks, oil slicks, tents.
- **Ground** — one grass tile, repeated.

Roads, pavements, houses, fences, gnomes and geese are drawn in code with flat
fills that match the pack's style. This is a deliberate split: sprites where
the art carries the look, geometry where it is just rectangles. It also avoids
fitting a racetrack tileset (every road tile has an orange-and-white kerb) into
a street grid.

The build script selects the frames it needs, packs them into a single atlas
PNG with `tools/png.js`, and emits `sprites.js` containing the data URI and a
`{name: [x, y, w, h]}` table. Re-running it reproduces `sprites.js` exactly.

## World

A fixed 8×8 grid of city blocks generated from a seeded PRNG, so every session
is the same town and the harness can make claims about it.

- Block pitch 1000px, road width 220px. World is roughly 8000×8000px.
- Each block holds a house (a code-drawn rectangle with a roof), a garden, a
  scatter of trees, and a fence along the pavement.
- Gnomes sit in gardens, one per block, 64 in total. The shed's block has
  none, so 63 are stealable.
- The player's shed is a Kenney tent in the block nearest the world centre.
- The town is bounded by a hedge. Driving into it stops you; nothing else.

Collision is against an axis-aligned rectangle list (houses, fences, trees,
hedge). Resolution is per-axis pushback, which is cheap and never traps.

## Entities

`world`, `vehicles`, `actors`, `wanted`, `hud` — each an object with
`update(dt)` and `draw(ctx)` that reaches into the others only through named
functions, never their internals.

**Player.** Two states, `onFoot` and `driving`. Walks at 170px/s. Carries any
number of gnomes with no speed penalty.

**Traffic.** Twelve cars driving lane-following routes, choosing a random exit
at each intersection. They brake for the player badly and late. Bumping one
does nothing but push it.

**Pedestrians.** Sixteen, wandering pavements, occasionally emitting a speech
bubble ("lovely weather", "have you seen my gnome").

**Geese.** Spawned by the wanted system. They waddle at 140px/s — slower than
walking, far slower than driving — so they are always escapable on foot. On
touching the player they honk, the player drops half their carried gnomes on
the ground where they can be picked up again, and the goose loses interest.

## Rules

Stealing a gnome raises **honk level** by one, to a maximum of five; each level
keeps one more goose on you. The level decays one step every 20 seconds without
a theft, and is cleared entirely by reaching the shed. Delivering a gnome
scores a point. There is no way to lose.

## Controls

Arrows or WASD to walk and drive. **Space is the only action key** and does
whatever makes sense where the player is standing, in this order: pick up a
gnome, deliver at the shed, get out of the car, get into a nearby car. R
changes the radio station. Both stations play the same song.

Aiming assistance, since these players struggle with keyboards: an arrow at the
screen edge points at the nearest gnome when empty-handed and at the shed when
carrying. No precision is ever required.

## The jokes

Deliberate, legible, and never at the cost of playability:

- The car drifts left. Every car. Nobody has fixed this. The pull is gentle
  enough to correct with a tap of steering, or it stops being a joke and
  starts being the game.
- The speedometer reads in gnomes per hour.
- The radio has two stations playing the same song.
- Entering a car announces "YOU ARE NOW DRIVING: A CAR".
- The wanted stars are geese, labelled HONK LEVEL.
- Oil slicks spin you around, harmlessly.
- Getting caught is captioned "EMBARRASSED", not "wasted".

## Audio

WebAudio oscillators only, no files: a goose honk, a pickup blip, a delivery
jingle, and an engine hum whose pitch tracks speed. The context is created on
the first keypress to satisfy autoplay policy, and the game runs silently if
WebAudio is unavailable.

## Testing

`gtg/test/playtest.js` extracts the script body from `index.html`, loads
`sprites.js`, and runs both in a Node `vm` against stubbed `document`, canvas
2D context, `Image` (reading real dimensions from the embedded PNG header),
`localStorage` and `requestAnimationFrame`, driven by a `performance.now()`
timebase. The game exposes `globalThis.__p()` returning a state snapshot.

Bots that actually play, asserting on progress:

1. **Boot** — 600 frames with no exception and no NaN in any entity position.
2. **Theft** — walk to the nearest gnome, press Space, assert carried == 1.
3. **Driving** — enter the nearest car, hold accelerate, assert speed > 0 and
   the world position moved more than 500px.
4. **Delivery** — drive to the shed, press Space, assert score increased and
   honk level is 0.
5. **Escape** — with honk level 5, walk in a straight line for 20s and assert
   no goose ever caught up, proving geese are outrunnable on foot.
6. **Reachability** — flood-fill walkable space from spawn on a 20px grid and
   assert every gnome and the shed are reachable.
7. **Bounded** — after 10,000 frames, entity counts and the gnome array are
   within their declared caps.
