# Grand Theft Gnome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-playable top-down GTA parody where you steal garden gnomes and are chased by geese.

**Architecture:** One hand-written `gtg/index.html` holding all game code, plus a generated `gtg/sprites.js` carrying a Kenney CC0 sprite atlas as a data URI. Game state lives in five modules inside the script — `world`, `vehicles`, `actors`, `wanted`, `hud` — each with `update(dt)`/`draw(ctx)` and no reach-through into the others. Verification is a Node `vm` harness that stubs the DOM and drives bots through the real game loop.

**Tech Stack:** Vanilla ES2020, canvas 2D, WebAudio oscillators, Node 24 for build and test. No dependencies, no bundler, no server.

**Spec:** `docs/superpowers/specs/2026-08-23-grand-theft-gnome-design.md`

## Global Constraints

- No runtime dependencies. No `npm install`. Node's stdlib only for tools and tests.
- The game must run by double-clicking `gtg/index.html` from disk (`file://`).
- Art is Kenney Racing Pack (CC0) only; roads, houses, fences, gnomes and geese are drawn in code.
- No death, no timer, no fail state, no violence. Worst outcome is dropping gnomes.
- Space is the only action key. Movement is arrows or WASD. R toggles the radio.
- Walk 170px/s, goose 140px/s — geese must stay outrunnable on foot.
- World is a seeded 8x8 block grid, block pitch 1000px, road width 220px.
- One gnome per block, 64 total, 63 stealable (the shed's block has none).
- Fixed timestep 1/60s, `performance.now()` timebase.
- Game exposes `globalThis.__p()` returning a state snapshot for tests.

---

### Task 1: PNG toolkit and sprite atlas

**Files:**
- Create: `tools/png.js` (already present from the asset spike — keep)
- Create: `tools/build-sprites.js`
- Create: `gtg/sprites.js` (generated)
- Test: `gtg/test/sprites.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `gtg/sprites.js` defining global `SPRITES = {atlas: "data:image/png;base64,...", frames: {name: [x, y, w, h]}}`. Frame names: `car_black`, `car_blue`, `car_green`, `car_red`, `car_yellow`, `ped_a`, `ped_b`, `ped_c`, `ped_d`, `player`, `tree_small`, `tree_large`, `barrel`, `cone`, `oil`, `rock`, `barrier`, `tyres`, `shed`, `grass`.

- [ ] **Step 1: Write the failing test**

```js
// gtg/test/sprites.test.js
const assert = require('assert');
require('../sprites.js');           // defines global SPRITES
const S = globalThis.SPRITES;
assert.match(S.atlas, /^data:image\/png;base64,/, 'atlas is a PNG data URI');
for (const name of ['car_red', 'player', 'shed', 'grass', 'tree_small', 'oil']) {
  const f = S.frames[name];
  assert.ok(Array.isArray(f) && f.length === 4, `${name} has a frame`);
  assert.ok(f[2] > 0 && f[3] > 0, `${name} has non-zero size`);
}
console.log('sprites ok:', Object.keys(S.frames).length, 'frames');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node gtg/test/sprites.test.js`
Expected: FAIL, cannot find module `../sprites.js`.

- [ ] **Step 3: Write the build script**

`tools/build-sprites.js` downloads `https://kenney.nl/assets/racing-pack`, scrapes the `.zip` URL, unzips to a cache under the system temp dir (skipping the download when the cache exists), then for each wanted source PNG decodes it with `tools/png.js`, trims fully transparent margins, and shelf-packs the results into one atlas with 2px padding. Writes `gtg/sprites.js` as `globalThis.SPRITES = {...};` with the atlas base64-encoded and frames sorted by name so reruns are byte-identical.

- [ ] **Step 4: Run the build, then the test**

Run: `node tools/build-sprites.js && node gtg/test/sprites.test.js`
Expected: PASS, atlas under 400KB of base64.

- [ ] **Step 5: Commit**

```bash
git add tools/png.js tools/build-sprites.js gtg/sprites.js gtg/test/sprites.test.js
git commit -m "feat: pack Kenney CC0 sprites into a generated atlas"
```

---

### Task 2: Headless harness and boot test

**Files:**
- Create: `gtg/index.html`
- Create: `gtg/test/harness.js`
- Test: `gtg/test/playtest.js`

**Interfaces:**
- Consumes: `SPRITES` from Task 1.
- Produces: `harness.js` exporting `boot({seed}) -> {step(frames), keys, probe()}` where `keys` is a `Set` of held key names (`'ArrowUp'`, `' '`, ...), `step(n)` advances exactly `n` fixed frames, and `probe()` returns `globalThis.__p()`.

- [ ] **Step 1: Write the failing test**

```js
// gtg/test/playtest.js
const assert = require('assert');
const { boot } = require('./harness.js');
const g = boot();
g.step(600);
const p = g.probe();
assert.ok(Number.isFinite(p.player.x) && Number.isFinite(p.player.y), 'player position is finite');
assert.equal(p.errors.length, 0, 'no errors during 600 frames');
console.log('boot ok');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node gtg/test/playtest.js`
Expected: FAIL, cannot find module `./harness.js`.

- [ ] **Step 3: Build the harness and a bootable game shell**

`harness.js` reads `index.html`, extracts the contents of the single `<script>` element, and runs `sprites.js` then that source in a `vm` context stubbed with: `document.getElementById` returning a fake canvas whose `getContext('2d')` counts calls but draws nothing; `Image` whose `src` setter parses the base64 PNG header for real `width`/`height` then fires `onload`; `localStorage` backed by a `Map`; `requestAnimationFrame` queueing callbacks the harness drains; `performance.now()` returning the harness clock; and `AudioContext` faking oscillators.

`index.html` gets the fixed-timestep loop, key handling, and a `globalThis.__p()` probe returning `{player, gnomes, loose, cars, geese, peds, shed, score, honk, drawCalls, errors}`. Top-level `const`/`let` are invisible on the sandbox object, so the probe must be assigned explicitly. Feed `performance.now()`-compatible timestamps: a mismatched timebase makes the fixed-step loop silently never step.

- [ ] **Step 4: Run the test**

Run: `node gtg/test/playtest.js`
Expected: PASS, "boot ok".

- [ ] **Step 5: Commit**

```bash
git add gtg/index.html gtg/test/harness.js gtg/test/playtest.js
git commit -m "test: headless harness that runs the real game loop"
```

---

### Task 3: World generation, collision, reachability

**Files:**
- Modify: `gtg/index.html`
- Create: `gtg/test/reach.js`
- Test: `gtg/test/playtest.js`

**Interfaces:**
- Consumes: harness from Task 2.
- Produces: `world.solids` (array of `{x, y, w, h}`), `world.gnomes` (array of `{x, y, taken}`), `world.shed` (`{x, y}`), `world.onRoad(x, y) -> bool`, `world.collide(box) -> {x, y}` resolved position.

- [ ] **Step 1: Write the failing tests**

```js
// appended to gtg/test/playtest.js
const { reachable, key } = require('./reach.js');
const p1 = boot().probe();
assert.equal(p1.gnomes.length, 63, '63 stealable gnomes');
const set = reachable(p1);                     // flood fill on a 20px grid from spawn
for (const gn of p1.gnomes) assert.ok(set.has(key(gn)), `gnome at ${gn.x},${gn.y} is reachable`);
assert.ok(set.has(key(p1.shed)), 'shed is reachable');
```

- [ ] **Step 2: Run and watch it fail**

Run: `node gtg/test/playtest.js`
Expected: FAIL, `p1.gnomes` is undefined.

- [ ] **Step 3: Implement world generation**

Seeded mulberry32 PRNG. For each of 64 blocks: place a house rect inset from the block, a garden patch, 2-5 trees, and a fence along the pavement edge with a gap for the driveway. Gnomes go in the garden, one per block, skipping the shed's block. Solids are the house rects, tree trunks (radius 18), fence segments, and four hedge rects at the world bounds. `collide` resolves x then y against solids.

- [ ] **Step 4: Run the tests**

Run: `node gtg/test/playtest.js`
Expected: PASS, all gnomes and the shed reachable.

- [ ] **Step 5: Commit**

```bash
git add gtg/index.html gtg/test/playtest.js gtg/test/reach.js
git commit -m "feat: seeded town generation with reachability tests"
```

---

### Task 4: On foot — walking, stealing, delivering

**Files:**
- Modify: `gtg/index.html`
- Test: `gtg/test/playtest.js`

**Interfaces:**
- Consumes: `world` from Task 3.
- Produces: `player.state` (`'onFoot'` | `'driving'`), `player.carrying` (integer), `game.score` (integer), `actions.press()` — the single Space handler.

- [ ] **Step 1: Write the failing test**

```js
const g = boot();
const target = nearest(g.probe().gnomes, g.probe().player);
walkTo(g, target);                    // holds arrow keys until within 30px
g.keys.add(' '); g.step(2); g.keys.delete(' ');
assert.equal(g.probe().player.carrying, 1, 'picked up a gnome');
walkTo(g, g.probe().shed);
g.keys.add(' '); g.step(2); g.keys.delete(' ');
assert.equal(g.probe().score, 1, 'delivered for a point');
assert.equal(g.probe().honk, 0, 'shed clears honk level');
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL, `carrying` is undefined.

- [ ] **Step 3: Implement**

Walk at 170px/s with per-axis collision. `press()` resolves in order: gnome within 40px, so pick it up, `carrying++`, `honk = min(5, honk + 1)`; else within 90px of the shed with `carrying > 0`, so `score += carrying`, `carrying = 0`, `honk = 0`; else driving, so exit; else a car within 70px, so enter.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gtg/index.html gtg/test/playtest.js
git commit -m "feat: walking, gnome theft, and delivery to the shed"
```

---

### Task 5: Vehicles — driving and traffic

**Files:**
- Modify: `gtg/index.html`
- Test: `gtg/test/playtest.js`

**Interfaces:**
- Consumes: `world`, `player` from Tasks 3-4.
- Produces: `vehicles.list` (array of `{x, y, angle, speed, colour}`), `vehicles.nearest(x, y)`, `player.car` (index or `null`).

- [ ] **Step 1: Write the failing test**

```js
const g = boot();
walkTo(g, g.probe().cars[0]);
g.keys.add(' '); g.step(2); g.keys.delete(' ');
assert.equal(g.probe().player.state, 'driving', 'got in the car');
const from = g.probe().player;
g.keys.add('ArrowUp'); g.step(180); g.keys.delete('ArrowUp');
const to = g.probe().player;
assert.ok(Math.hypot(to.x - from.x, to.y - from.y) > 500, 'drove more than 500px in 3s');
assert.ok(g.probe().cars.every(c => Number.isFinite(c.x)), 'traffic positions stay finite');
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL, `state` is never `'driving'`.

- [ ] **Step 3: Implement**

Car: `speed` integrates throttle (600px/s^2 accel, 900px/s^2 brake, 0.6/s rolling friction), capped 520px/s. Steering turns `angle` by `2.4 rad/s * (speed / max)`, plus a constant `0.35 rad/s * (speed / max)` leftward drift — the joke. Position integrates along `angle`. Collision against `world.solids` kills 60% of speed. Twelve traffic cars follow lane centres, pick a random turn at each intersection, and brake within 120px of the player's car.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gtg/index.html gtg/test/playtest.js
git commit -m "feat: drivable cars that pull left, plus traffic"
```

---

### Task 6: Geese and the honk level

**Files:**
- Modify: `gtg/index.html`
- Test: `gtg/test/playtest.js`

**Interfaces:**
- Consumes: `player`, `world`.
- Produces: `wanted.level` (0-5), `wanted.geese` (array of `{x, y}`), `wanted.decay` timer.

- [ ] **Step 1: Write the failing test**

```js
const g = boot();
stealGnomes(g, 5);                                  // drives honk level to 5
assert.equal(g.probe().honk, 5, 'five stolen gnomes means five geese');
g.step(120);
assert.equal(g.probe().geese.length, 5, 'one goose per honk level');
let caught = false;
g.keys.add('ArrowRight');
for (let i = 0; i < 1200; i++) {                    // 20 seconds on foot
  g.step(1);
  const q = g.probe();
  if (q.geese.some(x => Math.hypot(x.x - q.player.x, x.y - q.player.y) < 24)) caught = true;
}
g.keys.delete('ArrowRight');
assert.ok(!caught, 'geese never catch a walking player');
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL, `geese` is undefined.

- [ ] **Step 3: Implement**

`wanted.level` rises on theft, decays one step per 12s without a theft, clears at the shed. Geese spawn 500-800px away, waddle at 140px/s straight at the player with a sine wobble, and on contact honk, drop `floor(carrying / 2)` gnomes as loose pickups, drop `level` by 1 and despawn. Cap geese at `level`.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gtg/index.html gtg/test/playtest.js
git commit -m "feat: goose police and the honk level"
```

---

### Task 7: Rendering, HUD, audio, and the jokes

**Files:**
- Modify: `gtg/index.html`
- Test: `gtg/test/playtest.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `hud.draw(ctx)`, `audio.honk()`, `audio.blip()`, `audio.jingle()`, `radio.station`.

- [ ] **Step 1: Write the failing test**

```js
const g = boot();
g.step(10000);                                    // ~166 seconds of play
const q = g.probe();
assert.ok(q.cars.length <= 13, 'traffic stays capped');
assert.ok(q.geese.length <= 5, 'geese stay capped');
assert.ok(q.gnomes.length + q.loose.length <= 63, 'no gnome duplication');
assert.equal(q.errors.length, 0, 'no errors over a long run');
assert.ok(q.drawCalls > 0, 'the renderer actually drew something');
```

- [ ] **Step 2: Run and watch it fail**

Expected: FAIL, `drawCalls` is undefined.

- [ ] **Step 3: Implement**

Camera follows the player with a 0.12 lerp. Draw order: grass, roads and pavements, gardens and fences, loose gnomes, shed, cars, geese, player, houses (over everything, so you drive behind them), speech bubbles, HUD. HUD carries the score, HONK LEVEL as goose icons, a speedometer in gnomes per hour, the radio station name, and an edge arrow pointing at the nearest gnome or at the shed when carrying. Title screen on first load, "EMBARRASSED" banner on a goose touch. WebAudio built lazily on first keypress, wrapped so a missing `AudioContext` is silent rather than fatal.

- [ ] **Step 4: Run the whole suite**

Run: `node gtg/test/sprites.test.js && node gtg/test/playtest.js`
Expected: PASS, every assertion.

- [ ] **Step 5: Commit**

```bash
git add gtg/index.html gtg/test/playtest.js
git commit -m "feat: rendering, HUD, audio and the jokes"
```

---

## Self-review

- **Spec coverage.** Files and art are Tasks 1-2. World is Task 3. Entities are Tasks 4-6. Rules are Tasks 4 and 6. Controls are Task 4 (Space) and Task 7 (radio, edge arrow). Jokes are Tasks 5 and 7. Audio is Task 7. The spec's seven numbered test cases map to Tasks 2, 4, 5, 5, 6, 3, 7 in that order.
- **Naming.** `honk` in probes, `wanted.level` in source; `player.carrying`, `game.score`, `world.gnomes`, `vehicles.list` are spelled identically everywhere they appear.
- **Caps.** 63 stealable gnomes, 12 traffic cars (13 counting the player's), 5 geese, 16 pedestrians.
