// Headless playtests for the GTA Fun simulation. No Three.js, no DOM — the
// sim is pure numbers, so bots can just play it and assert on what happened.
const assert = require('assert');
const SIM = require('../sim.js');

let passed = 0;
const ok = label => { passed++; console.log('  ok  ' + label); };
const section = name => console.log('\n' + name);

const STEP = 1 / 60;
const noInput = () => ({ forward: false, back: false, left: false, right: false,
  turnLeft: false, turnRight: false, sprint: false, fire: false, interact: false, jump: false });

function run(g, frames, input) {
  const held = Object.assign(noInput(), input || {});
  for (let i = 0; i < frames; i++) g.update(STEP, held);
}

// Faces the player at a world point, so bots can walk and aim like a person.
function faceTowards(g, x, z) {
  const p = g.playerPos();
  g.state.player.yaw = Math.atan2(-(x - p.x), -(z - p.z));
}

function walkTowards(g, x, z, maxFrames = 3000, stopAt = 2.0) {
  for (let i = 0; i < maxFrames; i++) {
    const p = g.playerPos();
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < stopAt) return i;
    faceTowards(g, x, z);
    g.update(STEP, Object.assign(noInput(), { forward: true }));
  }
  return maxFrames;
}

// A spot a few metres from a door that is not inside the building it belongs
// to. Doors face different ways, and guessing the side put the player in a wall.
function approachSpot(g, door, back = 5) {
  const offsets = [[0, back], [0, -back], [back, 0], [-back, 0]];
  for (const [dx, dz] of offsets) {
    if (!g.blocked(door.x + dx, door.z + dz, SIM.C.PLAYER_R)) return { x: door.x + dx, z: door.z + dz };
  }
  return { x: door.x, z: door.z + back };
}

// Walks to the exit mat and stops the moment you are outside. Carrying on
// walking afterwards just marches you into the next door along.
function leaveRoom(g, exitAt, maxFrames = 2000) {
  for (let i = 0; i < maxFrames && g.state.player.indoors; i++) {
    const p = g.playerPos();
    g.state.player.yaw = Math.atan2(-(exitAt.x - p.x), -(exitAt.z - p.z));
    g.update(STEP, Object.assign(noInput(), { forward: true }));
  }
  return !g.state.player.indoors;
}

// True when nothing solid sits on the straight line between two points. The
// bots walk in straight lines, so they need a target they can actually reach.
function clearLine(g, from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  for (let t = 0; t < len; t += 0.5) {
    if (g.blocked(from.x + (dx / len) * t, from.z + (dz / len) * t, SIM.C.PLAYER_R)) return false;
  }
  return true;
}

// Nearest item the bot can walk to without having to path around a building.
function nearestReachable(g, items) {
  const p = g.playerPos();
  return items
    .filter(i => !i.taken)
    .map(i => ({ item: i, d: Math.hypot(i.x - p.x, i.z - p.z) }))
    .sort((a, b) => a.d - b.d)
    .filter(e => clearLine(g, p, e.item))
    .map(e => e.item)[0];
}

// --- 1. the city is solid --------------------------------------------------

section('city');
{
  const g = SIM.createGame();
  const s = g.state;
  assert.ok(s.city.buildings.length > 30, `the city has buildings (${s.city.buildings.length})`);
  assert.ok(s.city.loot.length > 30, `there are things to rob (${s.city.loot.length})`);
  assert.ok(s.city.loot.some(l => l.kind === 'safe'), 'there is a safe inside the bank');
  assert.ok(s.city.doors.length > 0, 'there are bank doors to walk through');
  assert.ok(s.city.loot.some(l => l.kind === 'atm'), 'there are cash machines');
  assert.ok(s.city.loot.some(l => l.kind === 'register'), 'there are tills');
  ok(`city built: ${s.city.buildings.length} buildings, ${s.city.loot.length} robbable things`);

  assert.ok(!g.blocked(s.player.x, s.player.z, SIM.C.PLAYER_R), 'the player does not spawn inside a wall');
  // Every robbable must have somewhere a player can actually stand next to it.
  for (const l of s.city.loot) {
    const standable = [[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]]
      .some(([dx, dz]) => !g.blocked(l.x + dx, l.z + dz, SIM.C.PLAYER_R));
    assert.ok(standable, `the ${l.kind} at ${l.x.toFixed(0)},${l.z.toFixed(0)} can be walked up to`);
  }
  ok(`all ${s.city.loot.length} robbable things can be walked up to`);

  // Walking straight at a building must stop you outside it.
  const before = { x: s.player.x, z: s.player.z };
  let stopped = 0, tried = 0;
  for (const b of s.city.buildings.slice(0, 20)) {
    const startX = b.x - b.w / 2 - 6;
    if (g.blocked(startX, b.z, SIM.C.PLAYER_R)) continue;
    tried++;
    s.player.x = startX; s.player.z = b.z;
    faceTowards(g, b.x, b.z);
    run(g, 180, { forward: true });
    // Still outside the model's own footprint, and not inside any wall.
    if (s.player.x < b.x - b.w / 2 + 0.1 && !g.blocked(s.player.x, s.player.z, SIM.C.PLAYER_R)) stopped++;
  }
  assert.ok(tried > 5, `found buildings to walk at (${tried})`);
  assert.equal(stopped, tried, `walls stopped the player every time (${stopped}/${tried})`);
  s.player.x = before.x; s.player.z = before.z;
  ok(`buildings are solid (walked into ${tried} of them)`);

  // The models the sim places must all actually exist in the bundle.
  const meta = require('../model-meta.js');
  for (const b of s.city.buildings) assert.ok(meta[b.model], `model ${b.model} exists`);
  for (const p of s.city.props) assert.ok(meta[p.model], `prop model ${p.model} exists`);
  for (const c of s.cars) assert.ok(meta[c.model], `car model ${c.model} exists`);
  assert.ok(meta['cop'].animations.includes('walk'), 'the police model comes with a walk animation');
  assert.ok(meta['cop'].animations.includes('holding-both-shoot'), 'and a shooting animation');
  ok(`every placed model exists in the bundle; characters ship ${meta['cop'].animations.length} animations`);
}

// --- 2. cars ----------------------------------------------------------------

section('cars');
{
  const g = SIM.createGame();
  const s = g.state;
  const parked = s.cars.filter(c => c.parked);
  assert.ok(parked.length > 0, 'there are parked cars to steal');

  let best = parked[0], bestD = Infinity;
  for (const c of parked) {
    const d = Math.hypot(c.x - s.player.x, c.z - s.player.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  walkTowards(g, best.x, best.z, 3000, SIM.C.ENTER_RANGE - 0.6);
  assert.equal(g.interact(), 'enter', 'got into the car');
  assert.ok(s.player.driving, 'the player is driving');
  ok('walked to a parked car and stole it');

  assert.ok(s.wanted >= 1, 'stealing a car is noticed by the police');
  ok('stealing a car raises the wanted level');

  const from = { x: s.player.car.x, z: s.player.car.z };
  run(g, 180, { forward: true });
  const travelled = Math.hypot(s.player.car.x - from.x, s.player.car.z - from.z);
  assert.ok(s.player.car.speed > 5, `the car is moving (${s.player.car.speed.toFixed(1)} u/s)`);
  assert.ok(travelled > 20, `drove somewhere (${travelled.toFixed(0)} units in 3s)`);
  ok(`drove ${travelled.toFixed(0)} units in three seconds`);

  assert.equal(g.interact(), 'exit', 'got back out');
  assert.ok(!s.player.driving, 'on foot again');
  ok('got out of the car with the same key');
}

// --- 3. robbing -------------------------------------------------------------

section('robbing');
{
  const g = SIM.createGame();
  const s = g.state;
  const atm = s.city.loot.find(l => l.kind === 'atm');
  walkTowards(g, atm.x, atm.z, 4000, SIM.C.ROB_RANGE - 0.8);

  assert.equal(g.interact(), 'rob', 'started robbing the cash machine');
  const before = s.player.money;
  run(g, Math.ceil(SIM.C.ROB_TIME * 60) + 10, { interact: true });
  assert.ok(s.player.money > before, `took the money (${before} -> ${s.player.money})`);
  assert.equal(s.player.money, atm.cash, 'took exactly what was in it');
  ok(`robbed a cash machine for $${s.player.money}`);

  assert.ok(s.wanted >= 1, 'robbing raises the wanted level');
  ok('robbing raises the wanted level');

  assert.ok(atm.cool > 0, 'the machine is empty for a while afterwards');
  const again = g.interact();
  assert.equal(again, 'empty', 'you cannot rob the same machine twice in a row');
  ok('a robbed machine goes empty and refills later');

  // Letting go of E part way through cancels it and pays nothing.
  const g2 = SIM.createGame();
  const atm2 = g2.state.city.loot.find(l => l.kind === 'atm');
  walkTowards(g2, atm2.x, atm2.z, 4000, SIM.C.ROB_RANGE - 0.8);
  g2.interact();
  run(g2, 40, { interact: true });
  run(g2, 10, { interact: false });
  assert.equal(g2.state.player.money, 0, 'no money for a cancelled robbery');
  ok('walking off mid-robbery pays nothing');
}

// --- 4. the police turn up and shoot ---------------------------------------

section('police');
{
  const g = SIM.createGame();
  const s = g.state;
  g.raiseWanted(3);
  run(g, 60 * 12);
  assert.ok(s.cops.length > 0, `officers turn up when you are wanted (${s.cops.length})`);
  ok(`${s.cops.length} officers turned up on a 3-star wanted level`);

  assert.ok(s.cars.some(c => c.kind === 'police'), 'police cars turn up too');
  ok('the police bring cars');

  // Stand still and let them shoot: health must come down. Track the lowest
  // reading rather than the final one, because health regenerates and a soaking
  // resets it to full.
  let sawDart = false, lowest = s.player.health, soakedAfter = null;
  for (let i = 0; i < 60 * 25; i++) {
    g.update(STEP, noInput());
    if (s.darts.some(d => d.owner === 'police')) sawDart = true;
    if (!s.player.soaked) lowest = Math.min(lowest, s.player.health);
    else if (soakedAfter === null) soakedAfter = i / 60;
    if (sawDart && lowest < 100) break;
  }
  assert.ok(sawDart, 'the police fire nerf darts');
  assert.ok(lowest < 100, `their darts take health off (down to ${lowest.toFixed(0)})`);
  ok(`police nerf darts damaged the player (100 -> ${lowest.toFixed(0)})`);

  // How long a standing target survives — the number that decides whether an
  // eight-year-old finds this fun or miserable.
  const g3 = SIM.createGame();
  g3.raiseWanted(3);
  let survived = 0;
  for (let i = 0; i < 60 * 60 && !g3.state.player.soaked; i++) { g3.update(STEP, noInput()); survived = i / 60; }
  assert.ok(survived > 20,
    `a player standing still in the open lasts more than 20s (lasted ${survived.toFixed(0)}s)`);
  ok(`standing in the open under 3 stars survives ${survived.toFixed(0)}s`);
}

// --- 5. shooting back -------------------------------------------------------

section('nerf guns');
{
  const g = SIM.createGame();
  const s = g.state;
  const gun = nearestReachable(g, s.city.guns);
  assert.ok(gun, 'there is a blaster the player can walk straight to');
  // Blasters are collected by walking over them now; no key press involved.
  walkTowards(g, gun.x, gun.z, 4000, SIM.C.PICKUP_RANGE - 0.6);
  assert.ok(gun.taken,
    `walking over the blaster picked it up (ended ${Math.hypot(g.playerPos().x - gun.x, g.playerPos().z - gun.z).toFixed(1)}m away)`);
  assert.ok(s.player.hasGun && s.player.ammo > 0, 'the blaster came with darts');
  ok(`picked up a nerf blaster with ${s.player.ammo} darts`);

  // Put an officer in front of us and empty the magazine at them. Armed, since
  // only the ones carrying a blaster leave one behind and that is a dice roll.
  const cop = g.spawnCop(s.player.x, s.player.z - 12);
  assert.ok(cop, 'an officer to aim at');
  cop.armed = true;
  const copHealth = cop.health;

  for (let i = 0; i < 60 * 20 && cop.state !== 'sat'; i++) {
    faceTowards(g, cop.x, cop.z);
    s.player.pitch = 0;
    if (s.player.ammo === 0) s.player.ammo = SIM.C.MAG;      // reload for the test
    g.update(STEP, Object.assign(noInput(), { fire: true }));
  }
  assert.ok(cop.health < copHealth, `the officer took damage (${copHealth} -> ${cop.health})`);
  assert.equal(cop.state, 'sat', 'the officer sat down when out of health');
  assert.equal(SIM.C.COP_HEALTH, 100, 'officers have 100 health, same as the player');
  ok('shot an officer with nerf darts until they sat down');

  assert.ok(s.city.guns.some(x => !x.taken && Math.hypot(x.x - cop.x, x.z - cop.z) < 1),
    'the officer left their blaster behind');
  ok('a downed officer drops their blaster');

  assert.ok(s.wanted > 0, 'shooting at the police is a crime');
  ok('shooting at police raises the wanted level');
}

// --- 5b. turning with the arrow keys ---------------------------------------

section('turning');
{
  const g = SIM.createGame();
  const s = g.state;
  const before = s.player.yaw;
  run(g, 60, { turnLeft: true });
  const afterLeft = s.player.yaw;
  assert.ok(afterLeft > before, `arrow-left turns you left (${before.toFixed(2)} -> ${afterLeft.toFixed(2)})`);
  run(g, 120, { turnRight: true });
  assert.ok(s.player.yaw < afterLeft, 'arrow-right turns you back the other way');
  ok('the arrow keys turn you on the spot, no mouse needed');

  // Steering must work at a crawl, or you cannot pull out of a parking space.
  const g2 = SIM.createGame();
  const parked = g2.state.cars.filter(c => c.parked);
  let near = parked[0], nearD = Infinity;
  for (const c of parked) {
    const d = Math.hypot(c.x - g2.state.player.x, c.z - g2.state.player.z);
    if (d < nearD) { nearD = d; near = c; }
  }
  walkTowards(g2, near.x, near.z, 3000, SIM.C.ENTER_RANGE - 0.6);
  g2.interact();
  run(g2, 12, { forward: true });                 // barely rolling
  const slow = g2.state.player.car.speed;
  const heading = g2.state.player.car.angle;
  run(g2, 45, { forward: true, turnLeft: true });
  assert.ok(slow < 6, `the car really was crawling (${slow.toFixed(1)} u/s)`);
  assert.ok(Math.abs(g2.state.player.car.angle - heading) > 0.1,
    `it still steers at low speed (turned ${(g2.state.player.car.angle - heading).toFixed(2)} rad)`);
  ok(`a car crawling at ${slow.toFixed(1)} u/s still steers`);
}

// --- 5c. running officers over ---------------------------------------------

section('running them over');
{
  const g = SIM.createGame();
  const s = g.state;
  const parked = s.cars.filter(c => c.parked)[0];
  s.player.driving = true;
  s.player.car = parked;
  parked.ai = false;
  parked.speed = 18;

  // Put the officer directly in the car's path, not just nearby.
  const fx = -Math.sin(parked.angle), fz = -Math.cos(parked.angle);
  const cop = g.spawnCop(parked.x + fx * 2.2, parked.z + fz * 2.2);
  const wantedBefore = s.wanted;
  run(g, 8, { forward: true });

  assert.equal(cop.state, 'sat', 'driving into an officer knocks them down');
  assert.ok(s.wanted > wantedBefore, `and it raises the wanted level (${wantedBefore} -> ${s.wanted})`);
  assert.equal(s.stats.copsRunOver, 1, 'the game counted it');
  ok(`ran an officer over: wanted went ${wantedBefore} -> ${s.wanted}`);

  // More stars means more police cars — but only once you are in a vehicle.
  // On foot they deliberately hold back; that is covered further down.
  for (const stars of [1, 3, 5]) {
    const t = SIM.createGame();
    const ride = t.state.cars.filter(c => c.parked)[0];
    t.state.player.driving = true;
    t.state.player.car = ride;
    ride.ai = false;
    // Keep the heat topped up and take the peak: the wanted level decays, and
    // once it hits zero the cars are sent home, so the final count says little.
    let cars = 0;
    for (let i = 0; i < 60 * 60; i++) {
      // Set the level rather than raise it: raiseWanted adds, so topping up
      // repeatedly would climb to five stars whatever we asked for.
      if (i % (60 * 10) === 0) { t.state.wanted = stars; t.state.wantedDecay = SIM.C.WANTED_DECAY; }
      t.update(STEP, noInput());
      cars = Math.max(cars, t.state.cars.filter(c => c.kind === 'police').length);
    }
    assert.ok(cars > 0, `${stars} stars brings at least one police car`);
    assert.ok(cars <= stars, `${stars} stars brings at most ${stars} police cars (got ${cars})`);
    if (stars === 5) assert.ok(cars >= 3, `five stars brings a proper convoy (got ${cars})`);
  }
  ok('police cars scale with the wanted level while driving, one per star');
}

// --- 5d. the armoury --------------------------------------------------------

section('armoury');
{
  const g = SIM.createGame();
  const s = g.state;
  const shop = s.city.stores[0];
  walkTowards(g, shop.x, shop.z, 4000, SIM.C.STORE_RANGE - 0.8);
  assert.equal(g.interact(), 'store', 'the armoury opens when you walk up to it');
  assert.ok(s.store.open, 'the shop is open');
  assert.ok(s.store.items.length >= 6, `it stocks weapons and supplies (${s.store.items.length})`);
  ok(`armoury opened, stocking ${s.store.items.length} things`);

  // You cannot buy what you cannot afford.
  assert.equal(g.buy(0), 'poor', 'no credit for the penniless');
  assert.equal(s.player.weapon, null, 'and nothing changes hands');
  ok('you cannot buy a blaster with no money');

  s.player.money = 5000;
  const rapid = s.store.items.findIndex(i => i.weapon === 'rapid');
  assert.equal(g.buy(rapid), 'weapon', 'bought the rapid blaster');
  assert.equal(s.player.weapon, 'rapid', 'and it is now in your hands');
  assert.ok(s.player.ammoFor.rapid > 0, 'it came loaded');
  assert.equal(s.player.money, 5000 - s.store.items[rapid].price, 'the money left your pocket');
  ok(`bought a ${s.store.items[rapid].name} for $${s.store.items[rapid].price}`);

  const heavyIdx = s.store.items.findIndex(i => i.weapon === 'heavy');
  g.buy(heavyIdx);
  assert.ok(s.player.owned.rapid && s.player.owned.heavy, 'you keep the ones you bought');
  assert.ok(g.switchWeapon(1), 'and can switch between them');
  ok('owning several blasters and switching between them works');

  // Movement is frozen while the shop is open, so you cannot shop and run.
  const where = { x: s.player.x, z: s.player.z };
  run(g, 60, { forward: true });
  assert.ok(Math.hypot(s.player.x - where.x, s.player.z - where.z) < 0.01,
    'you stand still while shopping');
  assert.equal(g.interact(), 'store-close', 'E closes the shop');
  assert.ok(!s.store.open, 'and it is shut');
  ok('the shop freezes you while it is open and closes with E');
}

// --- 5e. weapons differ -----------------------------------------------------

section('weapons');
{
  // A heavy blaster must drop an officer in fewer shots than the starter.
  const shotsToDrop = id => {
    const g = SIM.createGame();
    g.giveWeapon(id, 999);
    const cop = g.spawnCop(g.state.player.x, g.state.player.z - 10);
    let shots = 0;
    for (let i = 0; i < 60 * 60 && cop.state !== 'sat'; i++) {
      faceTowards(g, cop.x, cop.z);
      g.state.player.pitch = 0;
      const before = g.state.darts.length;
      g.update(STEP, Object.assign(noInput(), { fire: true }));
      if (g.state.darts.length > before) shots++;
    }
    return { shots, dropped: cop.state === 'sat' };
  };

  const standard = shotsToDrop('blaster');
  const heavy = shotsToDrop('heavy');
  assert.ok(standard.dropped && heavy.dropped, 'both blasters sit an officer down');
  assert.ok(heavy.shots < standard.shots,
    `the heavy blaster needs fewer shots (${heavy.shots} vs ${standard.shots})`);
  ok(`heavy blaster drops an officer in ${heavy.shots} shots, the starter takes ${standard.shots}`);

  // The scatter blaster throws a handful of darts per trigger pull.
  const g2 = SIM.createGame();
  g2.giveWeapon('scatter', 99);
  g2.update(STEP, Object.assign(noInput(), { fire: true }));
  assert.equal(g2.state.darts.length, 5, 'the scatter blaster fires five darts at once');
  ok('the scatter blaster fires five darts in one pull');
}

// --- 5e2. darts must connect even when the game stutters --------------------

section('darts at low frame rates');
{
  // The real complaint: "shooting the cops but they don't die". A dart travels
  // further in one frame than an officer is wide, so when the frame rate drops
  // a position-only hit test misses entirely.
  const hitsAt = fps => {
    const step = 1 / fps;
    const g = SIM.createGame();
    g.giveWeapon('blaster', 999);
    const cop = g.spawnCop(g.state.player.x, g.state.player.z - 12);
    const before = cop.health;
    for (let i = 0; i < fps * 12 && cop.health === before; i++) {
      faceTowards(g, cop.x, cop.z);
      g.state.player.pitch = 0;
      g.update(step, Object.assign(noInput(), { fire: true }));
    }
    return cop.health < before;
  };

  for (const fps of [60, 30, 20, 12]) {
    assert.ok(hitsAt(fps), `darts still hit an officer at ${fps} frames per second`);
  }
  ok('darts connect at 60, 30, 20 and 12 fps, not just when running smoothly');
}

// --- 5f. robbing the bank from the inside -----------------------------------

section('the bank');
{
  const g = SIM.createGame();
  const s = g.state;
  const door = s.city.doors.filter(d => d.kind === 'bank')[0];
  assert.ok(door, 'the bank has a door');
  // The bank door opens on approach like every other door now, so walk in.
  const from = approachSpot(g, door, SIM.C.AUTO_DOOR_RANGE + 1.6);
  s.player.x = from.x;
  s.player.z = from.z;
  faceTowards(g, door.x, door.z);
  run(g, 60, { forward: true });
  assert.equal(s.player.indoors, 'bank',
    `the bank door let you in (ended ${Math.hypot(g.playerPos().x - door.x, g.playerPos().z - door.z).toFixed(1)}m from it)`);
  assert.ok(!g.blocked(s.player.x, s.player.z, SIM.C.PLAYER_R), 'and not standing in a wall');
  ok('walked through the bank door and ended up inside');

  const safe = s.city.loot.find(l => l.kind === 'safe');
  const set = new Set();
  walkTowards(g, safe.x, safe.z, 4000, SIM.C.ROB_RANGE - 0.8);
  assert.equal(g.interact(), 'rob', 'the safe can be held up');
  run(g, Math.ceil(SIM.C.ROB_TIME * 60) + 10, { interact: true });
  assert.equal(s.player.money, safe.cash, `took $${safe.cash} out of the safe`);
  assert.ok(s.wanted >= 4, `robbing the safe brings the whole force (${s.wanted} stars)`);
  ok(`robbed the bank safe for $${safe.cash} and ${s.wanted} stars`);

  // Leaving is the exit mat by the door: walk onto it.
  assert.ok(leaveRoom(g, s.city.interior.exitAt),
    'walking onto the mat by the door puts you back outside');
  assert.ok(Math.hypot(s.player.x - door.x, s.player.z - door.z) < 8,
    'and standing outside the bank you robbed');
  ok('left the bank through the same door');
}

// --- 5g. cars do not stick on kerbs -----------------------------------------

section('driving into things');
{
  const g = SIM.createGame();
  const s = g.state;
  const car = s.cars.find(c => c.parked);
  s.player.driving = true;
  s.player.car = car;
  car.ai = false;

  // Aim at a building at a shallow angle: the car should scrape past, not stop.
  const building = s.city.buildings.reduce((best, b) => {
    const d = Math.hypot(b.x - car.x, b.z - car.z);
    return d < Math.hypot(best.x - car.x, best.z - car.z) ? b : best;
  });
  car.x = building.x - building.w / 2 - 3;
  car.z = building.z - building.d / 2 - 3;
  car.angle = Math.atan2(-(building.x - car.x), -(building.z - car.z)) + 0.6;
  car.speed = 20;

  const from = { x: car.x, z: car.z };
  run(g, 120, { forward: true });
  const travelled = Math.hypot(car.x - from.x, car.z - from.z);
  assert.ok(travelled > 12,
    `a car brushing a wall keeps moving instead of sticking (went ${travelled.toFixed(1)}m)`);
  assert.ok(Math.abs(car.speed) > 5, `and keeps its speed (${car.speed.toFixed(1)} u/s)`);
  ok(`scraped along a building for ${travelled.toFixed(0)}m without getting stuck`);
}

// --- 5h. officers stay down -------------------------------------------------

section('officers stay down');
{
  const g = SIM.createGame();
  const s = g.state;
  const cop = g.spawnCop(s.player.x + 4, s.player.z + 4);
  // Damage has to go through hurtCop; poking health directly never flips the
  // state, which is how this test span forever the first time.
  for (let i = 0; i < 20 && cop.state !== 'sat'; i++) g.hurtCop(cop, 20);
  assert.equal(cop.state, 'sat', 'the officer went down');

  run(g, 60 * 20);            // stand next to them for twenty seconds
  assert.ok(s.cops.indexOf(cop) >= 0, 'the officer is still lying there, not tidied away');
  assert.equal(cop.state, 'sat', 'and has not got back up');
  ok('a downed officer stays down while you are stood next to them');

  // Downed officers must not block reinforcements from arriving.
  g.raiseWanted(3);
  run(g, 60 * 12);
  const standing = s.cops.filter(c => c.state !== 'sat').length;
  assert.ok(standing > 0, `fresh officers still turn up (${standing} on their feet)`);
  ok(`bodies do not count towards the cap — ${standing} new officers arrived`);
}

// --- 5i. fists --------------------------------------------------------------

section('melee');
{
  const g = SIM.createGame();
  const s = g.state;
  assert.equal(g.currentWeapon(), null, 'you start with no blaster');

  const cop = g.spawnCop(s.player.x, s.player.z - 2);
  faceTowards(g, cop.x, cop.z);
  const before = cop.health;
  g.update(STEP, Object.assign(noInput(), { fire: true }));
  assert.ok(cop.health < before, `bare hands hurt (${before} -> ${cop.health})`);
  ok(`punched an officer for ${before - cop.health} without a blaster`);

  // Out of reach is out of reach.
  const g2 = SIM.createGame();
  const far = g2.spawnCop(g2.state.player.x, g2.state.player.z - 9);
  faceTowards(g2, far.x, far.z);
  g2.update(STEP, Object.assign(noInput(), { fire: true }));
  assert.equal(far.health, SIM.C.COP_HEALTH, 'you cannot punch someone across the street');
  ok('fists only reach as far as your arms');

  let swings = 1;
  while (cop.state !== 'sat' && swings < 40) {
    run(g, Math.ceil(SIM.C.MELEE_DELAY * 60) + 1);
    faceTowards(g, cop.x, cop.z);
    g.update(STEP, Object.assign(noInput(), { fire: true }));
    swings++;
  }
  assert.equal(cop.state, 'sat', 'fists eventually put an officer down');
  ok(`fists put an officer down in ${swings} swings`);
}

// --- 5j. the public ---------------------------------------------------------

section('bystanders');
{
  const g = SIM.createGame();
  const s = g.state;
  run(g, 60 * 6);
  assert.ok(s.civilians.length >= 5, `people are about (${s.civilians.length})`);

  // Bravery is a dice roll per person, so sample properly rather than hoping
  // the nine standing outside happen to include one.
  const sample = [];
  for (let i = 0; i < 60; i++) {
    const person = g.spawnCivilian();
    if (person) sample.push(person.brave);
  }
  const braveShare = sample.filter(Boolean).length / sample.length;
  assert.ok(braveShare > 0.05 && braveShare < 0.7,
    `a minority of people are brave (${(braveShare * 100).toFixed(0)}% of ${sample.length})`);
  ok(`${(braveShare * 100).toFixed(0)}% of people are the type to join in`);

  const start = s.civilians.map(c => ({ x: c.x, z: c.z }));
  run(g, 60 * 5);
  const moved = s.civilians.filter((c, i) => start[i] &&
    Math.hypot(c.x - start[i].x, c.z - start[i].z) > 1).length;
  assert.ok(moved >= 3, `they walk around (${moved} moved)`);
  ok(`${moved} of them wandered off on their own`);

  g.raiseWanted(3);
  run(g, 60 * 25);
  const states = s.civilians.map(c => c.state);
  assert.ok(states.indexOf('flee') >= 0 || states.indexOf('fight') >= 0,
    `the police change their behaviour (${states.join(',')})`);
  ok(`under police attention they react: ${[...new Set(states)].join(', ')}`);

  const g2 = SIM.createGame();
  g2.raiseWanted(4);
  let helped = 0;
  for (let i = 0; i < 60 * 45 && !helped; i++) {
    g2.update(STEP, noInput());
    helped = g2.state.stats.civiliansHelped;
  }
  assert.ok(helped > 0, 'a bystander lands a dart on an officer');
  ok(`bystanders fought back: ${helped} hits on the police`);
}

// --- 5k. hiding -------------------------------------------------------------

section('hiding indoors');
{
  const g = SIM.createGame();
  const s = g.state;
  const den = s.city.doors.filter(d => d.room === 'hideout')[0];
  const from = approachSpot(g, den, SIM.C.AUTO_DOOR_RANGE + 1.6);
  s.player.x = from.x;
  s.player.z = from.z;
  faceTowards(g, den.x, den.z);
  run(g, 60, { forward: true });
  assert.equal(s.player.indoors, 'hideout', 'walking at the door gets you inside');
  assert.ok(!g.blocked(s.player.x, s.player.z, SIM.C.PLAYER_R), 'and not stuck in a wall');
  ok('walked into a building and ended up in the back room');

  const health = s.player.health;
  g.hurtPlayer(40);
  assert.equal(s.player.health, health, 'the police cannot hurt you indoors');
  ok('you cannot be hit while inside a building');

  g.raiseWanted(4);
  const before = s.wanted;
  run(g, 60 * 20);
  assert.ok(s.wanted < before, `the heat drops while you hide (${before} -> ${s.wanted})`);
  ok(`hiding cooled the wanted level from ${before} to ${s.wanted}`);

  assert.ok(leaveRoom(g, s.city.hideout.exitAt),
    'walking onto the mat puts you back on the street');
  ok('left the hideout again');

  const g2 = SIM.createGame();
  const shop = g2.state.city.stores[0];
  walkTowards(g2, shop.x, shop.z, 4000, SIM.C.STORE_RANGE - 0.8);
  g2.interact();
  assert.ok(g2.state.store.open, 'shop open');
  const kept = g2.state.player.health;
  g2.hurtPlayer(50);
  assert.equal(g2.state.player.health, kept, 'nobody shoots you while you are shopping');
  ok('the armoury is a safe spot too');
}

// --- 5l. jumping ------------------------------------------------------------

section('jumping');
{
  const g = SIM.createGame();
  const s = g.state;
  assert.equal(s.player.y, 0, 'you start on the ground');
  g.update(STEP, Object.assign(noInput(), { jump: true }));
  let peak = 0;
  for (let i = 0; i < 120; i++) { g.update(STEP, noInput()); peak = Math.max(peak, s.player.y); }
  assert.ok(peak > 0.7, `you get off the ground (${peak.toFixed(2)}m)`);
  assert.equal(s.player.y, 0, 'and come back down');
  assert.ok(s.player.onGround, 'landing is registered');
  ok(`jumped ${peak.toFixed(2)}m and landed`);

  g.update(STEP, Object.assign(noInput(), { jump: true }));
  g.update(STEP, Object.assign(noInput(), { jump: true }));
  const midair = s.player.y;
  g.update(STEP, Object.assign(noInput(), { jump: true }));
  assert.ok(s.player.y > midair, 'still rising from the first jump');
  ok('no jumping again in mid-air');
}

// --- 5m. controls that do not need three keys at once -----------------------

section('sprinting and pickups');
{
  const g = SIM.createGame();
  const s = g.state;

  // Keep walking forward and you should break into a run on your own, so no
  // one has to hold Shift and an arrow key and a direction key together.
  const covered = () => {
    const from = { x: s.player.x, z: s.player.z };
    run(g, 60, { forward: true });
    return Math.hypot(s.player.x - from.x, s.player.z - from.z);
  };
  const firstSecond = covered();
  covered();
  const laterSecond = covered();
  assert.ok(laterSecond > firstSecond + 1.5,
    `you speed up on your own (${firstSecond.toFixed(1)}m then ${laterSecond.toFixed(1)}m)`);
  ok(`auto-sprint: ${firstSecond.toFixed(1)}m in the first second, ${laterSecond.toFixed(1)}m once running`);

  run(g, 30, { forward: false });
  const afterStopping = covered();
  assert.ok(afterStopping < laterSecond, 'stopping drops you back to a walk');
  ok('stopping resets you to walking pace');
}

section('dropping and picking up');
{
  const g = SIM.createGame();
  const s = g.state;
  g.giveWeapon('rapid', 37);
  assert.equal(s.player.weapon, 'rapid', 'holding the rapid blaster');

  assert.ok(g.dropWeapon(), 'dropped it');
  assert.equal(s.player.weapon, null, 'hands are empty');
  assert.equal(g.currentWeapon(), null, 'and nothing is equipped');
  ok('dropped a blaster with G');

  // Walking over it picks it up again, ammo intact, with no key press.
  run(g, 180);
  assert.equal(s.player.weapon, 'rapid', 'walking over it picked it back up');
  assert.equal(s.player.ammoFor.rapid, 37, 'with the same 37 darts still in it');
  ok('walked over a dropped blaster and picked it up automatically, ammo intact');

  // A second blaster on the floor should top up ammo rather than be ignored.
  const before = s.player.ammoFor.rapid;
  s.city.guns.push({ x: s.player.x, z: s.player.z, taken: false, weapon: 'rapid', ammo: 20 });
  run(g, 10);
  assert.equal(s.player.ammoFor.rapid, before + 20, 'a second one adds its darts');
  ok('walking over more ammo tops you up');
}

section('doors open for you');
{
  const g = SIM.createGame();
  const s = g.state;
  const den = s.city.doors.filter(d => d.room === 'hideout')[0];

  // Stop outside the trigger, then walk into it. Walking all the way up with
  // the bot would trip the door early and then carry it onto the exit mat.
  walkTowards(g, den.x, den.z, 6000, SIM.C.AUTO_DOOR_RANGE + 1.4);
  faceTowards(g, den.x, den.z);
  run(g, 22, { forward: true });
  assert.equal(s.player.indoors, 'hideout', 'the door opened as you walked into it');
  ok('doors open automatically when you walk up to them');

  // And punching one works too.
  const g2 = SIM.createGame();
  const den2 = g2.state.city.doors.filter(d => d.room === 'hideout')[1];
  // Stand at the door directly: the bot walks in straight lines and this one
  // has a building in the way. What is under test is the punch, not pathing.
  g2.state.player.x = den2.x;
  g2.state.player.z = den2.z + SIM.C.DOOR_RANGE - 0.6;
  faceTowards(g2, den2.x, den2.z);
  assert.ok(g2.melee(), 'the punch landed on the door');
  assert.equal(g2.state.player.indoors, 'hideout', 'and put you inside');
  ok('you can punch a door through as well');
}

// --- 5n. the police are less overwhelming on foot ---------------------------

section('police restraint on foot');
{
  // Peaks with the heat held at five stars, so neither side is measured after
  // the wanted level has quietly decayed away.
  const peakCars = inCar => {
    const g = SIM.createGame();
    if (inCar) {
      const ride = g.state.cars.filter(c => c.parked)[0];
      g.state.player.driving = true;
      g.state.player.car = ride;
      ride.ai = false;
    }
    let peak = 0;
    for (let i = 0; i < 60 * 60; i++) {
      if (i % (60 * 10) === 0) { g.state.wanted = 5; g.state.wantedDecay = SIM.C.WANTED_DECAY; }
      g.update(STEP, Object.assign(noInput(), inCar ? { forward: true } : {}));
      peak = Math.max(peak, g.state.cars.filter(c => c.kind === 'police').length);
    }
    return peak;
  };
  const footCars = peakCars(false);
  const drivingCars = peakCars(true);

  assert.ok(footCars < drivingCars,
    `fewer cars come after you on foot (${footCars} on foot, ${drivingCars} in a car)`);
  assert.ok(footCars <= 2, `and never a swarm of them (${footCars})`);
  ok(`police send ${footCars} car(s) when you are on foot, ${drivingCars} when you are driving`);
}

// --- 5o. officers without blasters ------------------------------------------

section('unarmed officers');
{
  const g = SIM.createGame();
  const s = g.state;
  const cop = g.spawnCop(s.player.x, s.player.z - 14);
  cop.armed = false;

  // From across the street an unarmed officer cannot do anything to you.
  let policeDarts = 0;
  for (let i = 0; i < 60 * 20; i++) {
    g.update(STEP, noInput());
    policeDarts += s.darts.filter(d => d.owner === 'police').length;
    if (policeDarts) break;
  }
  assert.equal(policeDarts, 0, 'an officer with no blaster never fires one');
  ok('unarmed officers do not shoot');

  // An armed one, in the same spot, does.
  const g2 = SIM.createGame();
  const armed = g2.spawnCop(g2.state.player.x, g2.state.player.z - 14);
  armed.armed = true;
  let fired = false;
  for (let i = 0; i < 60 * 20 && !fired; i++) {
    g2.update(STEP, noInput());
    fired = g2.state.darts.some(d => d.owner === 'police');
  }
  assert.ok(fired, 'an armed officer does fire');
  ok('armed officers still shoot, so the difference is real');

  // Downed unarmed officers leave nothing behind to pick up.
  const before = s.city.guns.filter(x => !x.taken).length;
  for (let i = 0; i < 20 && cop.state !== 'sat'; i++) g.hurtCop(cop, 20);
  assert.equal(cop.state, 'sat', 'the unarmed officer went down');
  assert.equal(s.city.guns.filter(x => !x.taken).length, before,
    'and left no blaster, because they never had one');
  ok('an unarmed officer drops nothing when they go down');
}

// --- 5p. hit feedback -------------------------------------------------------

section('showing hits');
{
  const g = SIM.createGame();
  const cop = g.spawnCop(g.state.player.x, g.state.player.z - 6);
  assert.ok(cop.hitAt < 0, 'nobody has been hit yet');
  g.hurtCop(cop, 10);
  assert.ok(cop.hitAt >= 0, 'taking a hit is timestamped for the renderer to flash');
  ok('officers record when they were hit so they can flash');

  const person = g.spawnCivilian();
  g.hurtCivilian(person, 5, 'player');
  assert.ok(person.hitAt >= 0, 'bystanders too');
  ok('bystanders record hits the same way');
}

// --- 5q. shooting windows out -----------------------------------------------

section('windows');
{
  const g = SIM.createGame();
  const s = g.state;
  assert.ok(s.city.windows.length > 0, `there are windows (${s.city.windows.length})`);

  const pane = s.city.windows[0];
  const doorsBefore = s.city.doors.length;
  g.giveWeapon('heavy', 99);

  // Stand off and shoot it out.
  s.player.x = pane.x;
  s.player.z = pane.z + 6;
  s.player.pitch = 0;
  faceTowards(g, pane.x, pane.z);
  for (let i = 0; i < 60 * 12 && !pane.broken; i++) {
    g.update(STEP, Object.assign(noInput(), { fire: true }));
  }
  assert.ok(pane.broken, 'the window broke');
  ok('shot a window out');

  assert.equal(s.city.doors.length, doorsBefore + 1, 'and it became a way in');
  faceTowards(g, pane.x, pane.z);
  run(g, 60, { forward: true });
  assert.equal(s.player.indoors, 'hideout', 'you can climb through the broken window');
  ok('a broken window works as a way inside');
}

// --- 5r. a street full of different people ----------------------------------

section('a varied street');
{
  const g = SIM.createGame();
  run(g, 60 * 30);
  const seen = new Set(g.state.civilians.map(c => c.model));
  assert.ok(seen.size >= 4, `the public are not all the same person (${seen.size} kinds)`);
  ok(`saw ${seen.size} different people on the street: ${[...seen].sort().join(', ')}`);
}

// --- 5s. crates -------------------------------------------------------------

section('crates');
{
  const g = SIM.createGame();
  const s = g.state;
  assert.ok(s.city.chests.length > 10, `there are crates about (${s.city.chests.length})`);
  assert.ok(s.city.chests.some(c => c.indoors), 'and some tucked away indoors');

  const box = s.city.chests.filter(c => !c.indoors)[0];
  s.player.x = box.x;
  s.player.z = box.z;
  assert.equal(g.interact(), 'chest', 'walking up and pressing E opens it');
  assert.ok(box.opened, 'the crate is open');
  assert.ok(box.contained, `and had something in it (${box.contained})`);
  ok(`opened a crate and found ${box.contained}`);

  assert.equal(g.interact(), 'none', 'an opened crate has nothing more to give');
  ok('a crate can only be looted once');

  // Over many crates you should see a spread of contents, not one thing.
  const found = {};
  for (const other of s.city.chests) {
    if (other.opened) continue;
    g.openChest(other);
    found[other.contained] = (found[other.contained] || 0) + 1;
  }
  assert.ok(Object.keys(found).length >= 2,
    `crates hold a mix of things (${JSON.stringify(found)})`);
  ok(`crates held a mix: ${Object.entries(found).map(([k, v]) => `${v} ${k}`).join(', ')}`);
}

// --- 5t. levels and perks ---------------------------------------------------

section('levels');
{
  const g = SIM.createGame();
  const s = g.state;
  assert.equal(s.player.level, 1, 'you start at level one');
  assert.equal(s.player.xp, 0, 'with no experience');

  // Robbing should be worth experience.
  const atm = s.city.loot.find(l => l.kind === 'atm');
  walkTowards(g, atm.x, atm.z, 4000, SIM.C.ROB_RANGE - 0.8);
  g.interact();
  run(g, Math.ceil(SIM.C.ROB_TIME * 60) + 10, { interact: true });
  assert.ok(s.player.xp > 0, `robbing earns experience (${s.player.xp})`);
  ok(`robbing a cash machine earned ${s.player.xp} xp`);

  // Levels arrive at the advertised pace and hand out their perk.
  g.awardXp(SIM.C.XP_PER_LEVEL * 2);
  assert.ok(s.player.level >= 3, `experience turns into levels (level ${s.player.level})`);
  assert.ok(s.player.perks.quick, 'level two hands you Quick Fingers');
  ok(`reached level ${s.player.level} and unlocked ${Object.keys(s.player.perks).join(', ')}`);

  // Thick Skin has to actually raise your ceiling. It arrives at level three,
  // which the awards above already passed.
  assert.ok(s.player.perks.tough, 'level three hands you Thick Skin');
  assert.ok(s.player.maxHealth > SIM.C.MAX_HEALTH,
    `which raises maximum health (${SIM.C.MAX_HEALTH} -> ${s.player.maxHealth})`);
  // Clear the street first: the robbery above left officers shooting at us,
  // and health cannot regenerate while you are being hit.
  s.wanted = 0;
  s.cops.length = 0;
  s.darts.length = 0;
  g.hurtPlayer(30, true);
  run(g, 60 * 40);
  assert.ok(s.player.health > SIM.C.MAX_HEALTH,
    `and you heal past the old ceiling (${s.player.health.toFixed(0)})`);
  ok(`Thick Skin raised health to ${s.player.maxHealth} and healing respects it`);

  // Quick Fingers has to actually halve a robbery.
  const timeRobbery = perk => {
    const t = SIM.createGame();
    if (perk) t.state.player.perks.quick = true;
    const machine = t.state.city.loot.find(l => l.kind === 'atm');
    t.state.player.x = machine.x;
    t.state.player.z = machine.z + 1.5;
    t.interact();
    let frames = 0;
    while (t.state.player.money === 0 && frames < 60 * 20) {
      t.update(STEP, Object.assign(noInput(), { interact: true }));
      frames++;
    }
    return frames;
  };
  const slow = timeRobbery(false);
  const quick = timeRobbery(true);
  assert.ok(quick < slow * 0.75, `Quick Fingers really is quicker (${quick} vs ${slow} frames)`);
  ok(`Quick Fingers robs in ${quick} frames against ${slow} without it`);
}

// --- 5u. day and night ------------------------------------------------------

section('day and night');
{
  const g = SIM.createGame();
  const s = g.state;
  const started = s.timeOfDay;
  run(g, 60 * 30);
  assert.notEqual(s.timeOfDay, started, 'time moves on');
  assert.ok(s.timeOfDay >= 0 && s.timeOfDay < 1, 'and stays in range');

  // A whole day should come round in about the advertised time.
  let sawNight = false, sawDay = false;
  for (let i = 0; i < 60 * SIM.C.DAY_LENGTH; i += 30) {
    run(g, 30);
    const noon = Math.sin((s.timeOfDay - 0.25) * Math.PI * 2);
    if (noon < -0.6) sawNight = true;
    if (noon > 0.6) sawDay = true;
  }
  assert.ok(sawNight, 'night comes round');
  assert.ok(sawDay, 'and so does daylight');
  ok(`a full day and night passes in ${SIM.C.DAY_LENGTH}s`);
}

// --- 5v. people do not spin on the spot -------------------------------------

section('people move like people');
{
  const g = SIM.createGame();
  const s = g.state;
  run(g, 60 * 5);
  assert.ok(s.civilians.length >= 5, 'people are about');

  // Total turning over half a minute. Someone walking a street turns a handful
  // of times; someone stuck in a corner spins hundreds of times.
  const turned = new Map();
  const last = new Map();
  for (const person of s.civilians) last.set(person, person.yaw);

  let worstStep = 0;
  for (let i = 0; i < 60 * 30; i++) {
    g.update(STEP, noInput());
    for (const person of s.civilians) {
      if (!last.has(person)) { last.set(person, person.yaw); turned.set(person, 0); continue; }
      let step = person.yaw - last.get(person);
      step = ((step + Math.PI * 3) % (Math.PI * 2)) - Math.PI;   // shortest way round
      worstStep = Math.max(worstStep, Math.abs(step));
      turned.set(person, (turned.get(person) || 0) + Math.abs(step));
      last.set(person, person.yaw);
    }
  }

  const rates = [...turned.values()].map(total => total / 30);   // radians per second
  const worst = Math.max(...rates);
  assert.ok(worstStep <= SIM.C.CIV_TURN * STEP + 0.001,
    `nobody snaps round instantly (worst single frame ${worstStep.toFixed(3)} rad)`);
  assert.ok(worst < 2.2,
    `nobody spins on the spot (worst averaged ${worst.toFixed(2)} rad/s over 30s)`);
  ok(`people turn at most ${worst.toFixed(2)} rad/s on average — no spinning`);

  // And they should actually be getting somewhere, not just shuffling.
  const before = s.civilians.map(c => ({ p: c, x: c.x, z: c.z }));
  run(g, 60 * 10);
  const wandered = before.filter(e => Math.hypot(e.p.x - e.x, e.p.z - e.z) > 3).length;
  assert.ok(wandered >= Math.floor(before.length / 3),
    `most of them are still going somewhere (${wandered} of ${before.length})`);
  ok(`${wandered} of ${before.length} people covered real ground while walking calmly`);
}

// --- 5w. doors are not fussy ------------------------------------------------

section('doors are forgiving');
{
  const g = SIM.createGame();
  const doors = g.state.city.doors.filter(d => d.room === 'hideout');
  assert.ok(doors.length >= 15, `plenty of buildings you can get into (${doors.length})`);

  // Walking at a door from an angle has to work; nobody lines up square first.
  let opened = 0;
  const angles = [0, 20, 40, 55, 70];
  for (const degrees of angles) {
    const t = SIM.createGame();
    const door = t.state.city.doors.filter(d => d.room === 'hideout')[0];
    const a = (degrees * Math.PI) / 180;
    t.state.player.x = door.x + Math.sin(a) * 5;
    t.state.player.z = door.z - Math.cos(a) * 5;
    faceTowards(t, door.x, door.z);
    for (let i = 0; i < 220 && !t.state.player.indoors; i++) {
      t.update(STEP, Object.assign(noInput(), { forward: true }));
    }
    if (t.state.player.indoors) opened++;
  }
  assert.equal(opened, angles.length,
    `every approach angle gets you in (${opened} of ${angles.length})`);
  ok(`doors open from every approach angle tried, up to ${angles[angles.length - 1]} degrees off`);
}

// --- 5x. every building has a way in ----------------------------------------

section('going inside buildings');
{
  const g = SIM.createGame();
  const s = g.state;

  // Nearly every building should have a door, not one in five.
  assert.ok(s.city.doors.length > s.city.buildings.length * 0.9,
    `almost every building has a door (${s.city.doors.length} doors, ${s.city.buildings.length} buildings)`);
  ok(`${s.city.doors.length} doors for ${s.city.buildings.length} buildings`);

  // The big ones lead somewhere bigger than a back room.
  const leadsTo = {};
  for (const door of s.city.doors) {
    const key = door.kind === 'bank' ? 'bank' : (door.room || 'hideout');
    leadsTo[key] = (leadsTo[key] || 0) + 1;
  }
  assert.ok(leadsTo.store > 5, `department stores you can walk into (${leadsTo.store})`);
  assert.ok(leadsTo.lobby > 5, `office lobbies you can walk into (${leadsTo.lobby})`);
  ok(`interiors: ${Object.entries(leadsTo).map(([k, v]) => `${v} ${k}`).join(', ')}`);

  // Walk into one of each and check you end up in the right room.
  for (const want of ['store', 'lobby', 'hideout', 'bank']) {
    const t = SIM.createGame();
    const door = t.state.city.doors.find(d =>
      (d.kind === 'bank' ? 'bank' : (d.room || 'hideout')) === want);
    assert.ok(door, `there is a door leading to a ${want}`);

    t.state.player.x = door.x + Math.sin(door.facing) * 5;
    t.state.player.z = door.z + Math.cos(door.facing) * 5;
    faceTowards(t, door.x, door.z);
    for (let i = 0; i < 260 && !t.state.player.indoors; i++) {
      t.update(STEP, Object.assign(noInput(), { forward: true }));
    }
    assert.equal(t.state.player.indoors, want, `walking into it puts you in the ${want}`);
    assert.ok(!t.blocked(t.state.player.x, t.state.player.z, SIM.C.PLAYER_R),
      `and you are not stood in a wall inside the ${want}`);
  }
  ok('walked into a department store, an office lobby, a back room and the bank');

  // The department store has to be worth walking into.
  const storeChests = s.city.chests.filter(c => c.indoors === 'store').length;
  const storeTills = s.city.loot.filter(l => l.indoors === 'store').length;
  assert.ok(storeChests >= 8, `the shop floor is stocked (${storeChests} crates)`);
  assert.ok(storeTills >= 2, `with tills to rob (${storeTills})`);
  ok(`the department store holds ${storeChests} crates and ${storeTills} tills`);

  // Inside one room you must not be offered loot from another.
  const t2 = SIM.createGame();
  const storeDoor = t2.state.city.doors.find(d => d.room === 'store');
  t2.enterRoom(storeDoor);
  const near = t2.nearestChest();
  assert.ok(near.chest, 'there is a crate to hand inside the store');
  assert.equal(near.chest.indoors, 'store', 'and it belongs to this room, not another one');
  ok('rooms only offer you their own crates');
}

// --- 5y. picking a blaster by number ----------------------------------------

section('loadout');
{
  const g = SIM.createGame();
  const s = g.state;
  g.giveWeapon('blaster', 20);
  g.giveWeapon('heavy', 8);
  g.giveWeapon('long', 4);

  const slots = g.inventory();
  assert.equal(slots.length, 3, 'three blasters on the bar');
  assert.ok(slots.some(x => x.active), 'one of them is in your hands');

  assert.ok(g.selectSlot(0), 'pressing 1 picks the first');
  assert.equal(s.player.weapon, slots[0].id, 'and that is what you are holding');
  assert.ok(g.selectSlot(2), 'pressing 3 picks the third');
  assert.equal(s.player.weapon, slots[2].id, 'and that is what you are holding');
  ok('number keys pick a blaster straight off the bar');

  assert.equal(g.selectSlot(7), false, 'a number with nothing in it does nothing');
  assert.equal(s.player.weapon, slots[2].id, 'and leaves you holding what you had');
  ok('empty slots are ignored');
}

// --- 6. health --------------------------------------------------------------

section('health');
{
  const g = SIM.createGame();
  const s = g.state;
  assert.equal(s.player.health, 100, 'you start with 100 health');
  ok('the player starts with 100 health');

  g.hurtPlayer(45);
  assert.equal(s.player.health, 55, 'damage comes off health');
  run(g, 60 * (SIM.C.REGEN_DELAY + 6));
  assert.ok(s.player.health > 55, `health comes back on its own (${s.player.health.toFixed(0)})`);
  ok(`health regenerates after ${SIM.C.REGEN_DELAY}s without being hit`);

  // Nobody dies. You get soaked, sit out a moment, and keep your money.
  s.player.money = 1234;
  g.hurtPlayer(200, true);
  assert.ok(s.player.soaked, 'running out of health soaks you');
  run(g, 60 * 4);
  assert.ok(!s.player.soaked, 'you dry off and carry on');
  assert.equal(s.player.health, 100, 'back to full health');
  assert.equal(s.player.money, 1234, 'you keep your money');
  assert.equal(s.wanted, 0, 'the heat is off afterwards');
  ok('being soaked costs you nothing but a few seconds');
}

// --- 7. a long run stays sane ----------------------------------------------

section('endurance');
{
  const g = SIM.createGame();
  const s = g.state;
  g.raiseWanted(5);
  s.player.hasGun = true;
  s.player.ammo = 999999;

  // Peaks, not the final frame: a soaking clears the streets, so the last
  // reading says nothing about whether the caps ever held under load.
  let peakCops = 0, peakCars = 0, peakDarts = 0, soakings = 0, peakBodies = 0;
  for (let i = 0; i < 60 * 90; i++) {
    const input = Object.assign(noInput(), {
      forward: (i % 600) < 400,
      right: (i % 900) < 120,
      fire: i % 30 === 0,
    });
    if (i % 1200 === 0) g.raiseWanted(5);
    g.update(STEP, input);
    // The cap is on officers still fighting; downed ones stay as scenery and
    // are only cleared once you are far away.
    peakCops = Math.max(peakCops, s.cops.filter(c => c.state !== 'sat').length);
    peakBodies = Math.max(peakBodies, s.cops.length);
    peakDarts = Math.max(peakDarts, s.darts.length);
    peakCars = Math.max(peakCars, s.cars.filter(c => c.kind === 'police').length);
  }
  soakings = s.stats.timesSoaked;
  assert.ok(peakCops > 0, 'officers actually turned up during the run');
  assert.ok(peakCars > 0, 'police cars actually turned up during the run');

  assert.ok(Number.isFinite(s.player.x) && Number.isFinite(s.player.z), 'the player is somewhere real');
  assert.ok(peakCops <= SIM.C.MAX_COPS, `officers on their feet stayed capped (peaked at ${peakCops})`);
  assert.ok(peakBodies <= SIM.C.MAX_COPS + 40, `bodies do not pile up without limit (peaked at ${peakBodies})`);
  assert.ok(peakDarts < 400, `darts never piled up (peaked at ${peakDarts})`);
  assert.ok(s.wanted <= SIM.C.MAX_WANTED, 'the wanted level never passes five');
  assert.ok(s.events.length <= 6, 'the message list stays bounded');
  assert.ok(peakCars <= SIM.C.MAX_POLICE_CARS, `police cars stayed capped (peaked at ${peakCars})`);
  for (const c of s.cars) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z), 'cars stay real');
  ok(`90s of chaos: peaked at ${peakCops} officers fighting (${peakBodies} counting the fallen), ` +
    `${peakCars} police cars, ${peakDarts} darts, soaked ${soakings}x — all bounded`);
}

console.log(`\n${passed} checks passed`);
