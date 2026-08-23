// Bots that actually play Grand Theft Gnome, headlessly, through the real loop.
// Every assertion is about progress, not merely the absence of exceptions.
const assert = require('assert');
const { boot } = require('./harness.js');
const { reachable, path, key } = require('./reach.js');

let passed = 0;
function ok(label) { passed++; console.log('  ok  ' + label); }
function section(name) { console.log('\n' + name); }

// --- bot controls ----------------------------------------------------------

const MOVE = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
function release(g) { for (const k of MOVE) g.keys.delete(k); }

// One axis at a time, smaller offset first. The route is 4-connected and
// planned on a 20px lattice: pressing two keys at once cuts corners off walls,
// and closing the larger gap first leaves the bot walking parallel to its own
// route, half a cell off it, where obstacles the plan cleared are in the way.
function steer(g, from, to) {
  release(g);
  const dx = to.x - from.x, dy = to.y - from.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  let axis;
  if (ax <= 3) axis = 'y';
  else if (ay <= 3) axis = 'x';
  else axis = ax < ay ? 'x' : 'y';
  if (axis === 'x') g.keys.add(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  else if (ay > 3) g.keys.add(dy > 0 ? 'ArrowDown' : 'ArrowUp');
}

// Walks to a world point by following a path around the obstacles. Steering by
// held arrow keys cuts corners, so when the bot pins itself on a fence it
// re-plans from where it actually is rather than skipping the waypoint.
function walkTo(g, target, maxFrames = 9000) {
  let route = path(g, g.probe().player, target);
  assert.ok(route, `a route exists to ${Math.round(target.x)},${Math.round(target.y)}`);
  let i = 0, frames = 0, replans = 0, sinceAdvanced = 0;

  while (frames < maxFrames) {
    const p = g.probe().player;
    if (Math.hypot(p.x - target.x, p.y - target.y) < 24) break;
    if (i >= route.length) break;

    // Walk the route waypoint by waypoint. Because every step is on a single
    // axis and each waypoint is only 20px from the last, the bot traces the
    // path exactly instead of drifting off it.
    if (Math.hypot(p.x - route[i].x, p.y - route[i].y) < 8) {
      i++;
      sinceAdvanced = 0;
      continue;
    }

    // Progress is measured along the route: walking the long way round a block
    // legitimately increases the straight-line distance to the target.
    if (++sinceAdvanced > 240) {
      sinceAdvanced = 0;
      if (++replans > 12) break;
      // Re-planning from the same spot returns the same route into the same
      // wall, so shove off in a random direction first to break the symmetry.
      release(g);
      g.keys.add(MOVE[(replans * 3) % MOVE.length]);
      g.step(40);
      release(g);
      route = path(g, g.probe().player, target) || route;
      i = 0;
      continue;
    }

    steer(g, p, route[i]);
    g.step(1);
    frames++;
  }
  release(g);
  g.step(1);
  return frames;
}

function nearestGnome(g) {
  const p = g.probe();
  let best = null, bestD = Infinity;
  for (const gn of p.gnomes) {
    const d = Math.hypot(gn.x - p.player.x, gn.y - p.player.y);
    if (d < bestD) { bestD = d; best = gn; }
  }
  return best;
}

function stealOne(g) {
  const target = nearestGnome(g);
  const frames = walkTo(g, target);
  const p = g.probe().player;
  const before = p.carrying;
  const gap = Math.hypot(p.x - target.x, p.y - target.y);
  g.tap(' ');
  const after = g.probe().player.carrying;
  return {
    ok: after > before,
    why: `walked ${frames} frames, stopped ${gap.toFixed(0)}px from the gnome ` +
         `at (${target.x.toFixed(0)},${target.y.toFixed(0)}), carrying ${before} -> ${after}`
  };
}

// --- 1. boot ---------------------------------------------------------------

section('boot');
{
  const g = boot();
  g.step(600);
  const p = g.probe();
  assert.ok(Number.isFinite(p.player.x) && Number.isFinite(p.player.y), 'player position is finite');
  for (const c of p.cars) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), 'car positions are finite');
  assert.deepEqual(p.errors, [], 'no errors during 600 frames');
  assert.ok(p.drawCalls > 0, 'the renderer drew something');
  ok('600 frames with no errors and no NaN');
}

// --- 2. the town holds together -------------------------------------------

section('world');
{
  const g = boot();
  const p = g.probe();
  assert.equal(p.gnomes.length, 63, '63 stealable gnomes, one per block bar the shed');
  ok('63 gnomes exist');

  const set = reachable(g);
  const unreachable = p.gnomes.filter(gn => !set.has(key(gn)));
  assert.equal(unreachable.length, 0,
    `every gnome is reachable on foot (${unreachable.length} were not)`);
  ok('every gnome is reachable on foot');

  assert.ok(set.has(key(p.shed)), 'the shed is reachable on foot');
  ok('the shed is reachable on foot');
}

// --- 3. stealing and delivering -------------------------------------------

section('theft and delivery');
{
  const g = boot();
  const theft = stealOne(g);
  assert.ok(theft.ok, 'picked up a gnome by walking to it: ' + theft.why);
  assert.equal(g.probe().player.carrying, 1, 'carrying exactly one');
  assert.equal(g.probe().honk, 1, 'stealing raises the honk level');
  ok('walked to a gnome and stole it');

  assert.equal(g.probe().gnomes.length, 62, 'the stolen gnome left the world');
  ok('the stolen gnome is gone from its garden');

  walkTo(g, g.probe().shed);
  g.tap(' ');
  assert.equal(g.probe().score, 1, 'delivering scores a point');
  assert.equal(g.probe().player.carrying, 0, 'hands are empty after delivery');
  assert.equal(g.probe().honk, 0, 'the shed clears the honk level');
  ok('delivered it to the shed for a point');
}

// --- 4. driving ------------------------------------------------------------

section('driving');
{
  const g = boot();
  const parked = g.probe().cars.filter(c => c.parked);
  assert.ok(parked.length > 0, 'there are parked cars to steal');

  let best = null, bestD = Infinity;
  const me = g.probe().player;
  for (const c of parked) {
    const d = Math.hypot(c.x - me.x, c.y - me.y);
    if (d < bestD) { bestD = d; best = c; }
  }
  walkTo(g, best);
  g.tap(' ');
  assert.equal(g.probe().player.state, 'driving', 'got into the car');
  ok('walked to a parked car and got in');

  // Drive like a player would: accelerate, and correct the leftward pull.
  const from = g.probe().player;
  const heading = from.angle;
  g.keys.add('ArrowUp');
  for (let i = 0; i < 180; i++) {
    const a = g.probe().player.angle;
    if (a < heading - 0.04) g.keys.add('ArrowRight'); else g.keys.delete('ArrowRight');
    g.step(1);
  }
  g.keys.delete('ArrowUp');
  g.keys.delete('ArrowRight');
  const to = g.probe().player;
  const travelled = Math.hypot(to.x - from.x, to.y - from.y);
  assert.ok(to.speed > 100, `the car is moving (speed ${to.speed.toFixed(0)})`);
  assert.ok(travelled > 500, `drove more than 500px in 3s (went ${travelled.toFixed(0)})`);
  ok(`drove ${travelled.toFixed(0)}px in three seconds, correcting the pull`);

  // The joke, asserted: with no steering input the car drifts to the left.
  const g2 = boot();
  const parked2 = g2.probe().cars.filter(c => c.parked);
  let near = parked2[0], nearD = Infinity;
  const me2 = g2.probe().player;
  for (const c of parked2) {
    const d = Math.hypot(c.x - me2.x, c.y - me2.y);
    if (d < nearD) { nearD = d; near = c; }
  }
  walkTo(g2, near);
  g2.tap(' ');
  const a0 = g2.probe().player.angle;
  g2.keys.add('ArrowUp');
  g2.step(120);
  g2.keys.delete('ArrowUp');
  assert.ok(g2.probe().player.angle < a0, 'the car pulls left when left alone');
  ok('every car pulls left, as designed');

  g.tap(' ');
  assert.equal(g.probe().player.state, 'onFoot', 'space gets you back out again');
  ok('got out of the car with the same key');
}

// --- 5. the geese ----------------------------------------------------------

section('geese');
{
  const g = boot();
  const lure = stealOne(g);
  assert.ok(lure.ok, 'stole a gnome to attract a goose: ' + lure.why);
  assert.equal(g.probe().honk, 1, 'honk level 1');

  g.step(200);
  assert.equal(g.probe().geese.length, 1, 'one goose per honk level');
  ok('stealing summons exactly one goose per honk level');

  // Walk in a straight line along the road. Give it a second to get going —
  // the goose may be right on top of us from the walk in — then no goose may
  // ever close the gap again.
  // Walk in a straight line. A single goose chasing from behind must never
  // run the player down: that is the whole reason the chase is fair.
  const gap = q => {
    let d = Infinity;
    for (const goose of q.geese) d = Math.min(d, Math.hypot(goose.x - q.player.x, goose.y - q.player.y));
    return d;
  };

  let caught = false, closest = Infinity, chased = 0;
  g.keys.add('ArrowRight');
  for (let i = 0; i < 1200; i++) {
    g.step(1);
    const d = gap(g.probe());
    if (!Number.isFinite(d)) continue;
    chased++;
    closest = Math.min(closest, d);
    if (d < 24) caught = true;
  }
  g.keys.delete('ArrowRight');

  assert.ok(chased > 300, `a goose really was chasing (${chased}/1200 frames)`);
  assert.ok(!caught, `no goose caught a walking player (closest ${closest.toFixed(0)}px)`);
  ok(`outran a goose for 20s (chased ${chased} frames, closest ${closest.toFixed(0)}px)`);

  // The invariant the chase rests on, read straight out of the running game.
  assert.ok(g.context.GOOSE_SPEED < g.context.WALK_SPEED,
    `geese (${g.context.GOOSE_SPEED}px/s) are slower than walking (${g.context.WALK_SPEED}px/s)`);
  ok(`geese move at ${g.context.GOOSE_SPEED}px/s against a ${g.context.WALK_SPEED}px/s walk`);
}

// --- 6. honk level tops out and decays -------------------------------------

section('honk level');
{
  const g = boot();
  const levels = [];
  for (let i = 0; i < 6; i++) {
    const t = stealOne(g);
    assert.ok(t.ok, `theft ${i + 1} succeeded: ${t.why}`);
    levels.push(g.probe().honk);
  }
  assert.equal(g.probe().player.carrying, 6, 'carrying all six gnomes');
  ok('six thefts in a row, all six gnomes in hand');

  assert.ok(Math.max(...levels) >= 2, `the honk level accumulates (saw ${levels.join(',')})`);
  assert.ok(Math.max(...levels) <= 5, 'the honk level never exceeds five');
  ok(`honk level builds as you steal and never passes five (${levels.join(',')})`);

  // Decay, isolated: walk away so no goose can reach you, and wait it out.
  const before = g.probe().honk;
  assert.ok(before > 0, 'carrying heat into the decay test');
  g.keys.add('ArrowRight');
  g.step(60 * 21);
  g.keys.delete('ArrowRight');
  assert.ok(g.probe().honk < before,
    `the honk level decays when you stop stealing (${before} -> ${g.probe().honk})`);
  ok('honk level decays once you stop stealing');
}

// --- 6b. what a goose actually does to you ---------------------------------

section('getting caught');
{
  const g = boot();
  for (let i = 0; i < 4; i++) assert.ok(stealOne(g).ok, `theft ${i + 1}`);
  const carried = g.probe().player.carrying;
  assert.ok(carried >= 2, 'carrying enough gnomes to drop half of them');

  // Stand still and let one catch up. Nobody is hurt; you are just embarrassed.
  let caught = false;
  for (let i = 0; i < 60 * 60 && !caught; i++) {
    g.step(1);
    const q = g.probe();
    if (q.player.carrying < carried) caught = true;
  }
  assert.ok(caught, 'a goose eventually catches a player who stands still');

  const q = g.probe();
  assert.equal(q.player.carrying, carried - Math.floor(carried / 2), 'it takes half your gnomes');
  assert.ok(q.loose.length > 0, 'the dropped gnomes land on the ground where you can retrieve them');
  ok(`a goose caught us, took half of ${carried} gnomes and left them on the floor`);
}

// --- 7. a long run stays bounded -------------------------------------------

section('endurance');
{
  const g = boot();
  g.keys.add('ArrowRight');
  g.step(5000);
  g.keys.delete('ArrowRight');
  g.step(5000);
  const q = g.probe();
  assert.deepEqual(q.errors, [], 'no errors over 10,000 frames');
  assert.ok(q.cars.length <= 23, `traffic and parked cars stay capped (${q.cars.length})`);
  assert.ok(q.geese.length <= 5, 'geese stay capped');
  assert.ok(q.gnomes.length + q.loose.length + q.player.carrying + q.score <= 63,
    'gnomes are conserved, never duplicated');
  assert.ok(Number.isFinite(q.player.x), 'the player is still somewhere real');
  ok('10,000 frames: bounded, conserved, error-free');
}

console.log(`\n${passed} checks passed`);
