// Headless playtests for the GTA Fun simulation. No Three.js, no DOM — the
// sim is pure numbers, so bots can just play it and assert on what happened.
const assert = require('assert');
const SIM = require('../sim.js');

let passed = 0;
const ok = label => { passed++; console.log('  ok  ' + label); };
const section = name => console.log('\n' + name);

const STEP = 1 / 60;
const noInput = () => ({ forward: false, back: false, left: false, right: false, sprint: false, fire: false, interact: false });

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
  for (let i = 0; i < 60 * 90 && !g3.state.player.soaked; i++) { g3.update(STEP, noInput()); survived = i / 60; }
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
  walkTowards(g, gun.x, gun.z, 4000, SIM.C.PICKUP_RANGE - 0.6);
  assert.equal(g.interact(), 'gun',
    `picked up a nerf blaster (ended ${Math.hypot(g.playerPos().x - gun.x, g.playerPos().z - gun.z).toFixed(1)}m away)`);
  assert.ok(s.player.hasGun && s.player.ammo > 0, 'the blaster came with darts');
  ok(`picked up a nerf blaster with ${s.player.ammo} darts`);

  // Put an officer in front of us and empty the magazine at them.
  const cop = g.spawnCop(s.player.x, s.player.z - 12);
  assert.ok(cop, 'an officer to aim at');
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

  // More stars must mean more police cars, one per star.
  for (const stars of [1, 3, 5]) {
    const t = SIM.createGame();
    t.raiseWanted(stars);
    run(t, 60 * 60);
    const cars = t.state.cars.filter(c => c.kind === 'police').length;
    assert.ok(cars > 0, `${stars} stars brings at least one police car`);
    assert.ok(cars <= stars, `${stars} stars brings at most ${stars} police cars (got ${cars})`);
    if (stars === 5) assert.ok(cars >= 3, `five stars brings a proper convoy (got ${cars})`);
  }
  ok('police cars scale with the wanted level, one per star up to five');
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

// --- 5f. robbing the bank from the inside -----------------------------------

section('the bank');
{
  const g = SIM.createGame();
  const s = g.state;
  const door = s.city.doors[0];
  walkTowards(g, door.x, door.z, 5000, SIM.C.DOOR_RANGE - 1.0);
  assert.equal(g.interact(), 'enter-bank', 'the bank door lets you in');
  assert.ok(s.player.indoors, 'you are inside');
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

  walkTowards(g, s.city.interior.exitAt.x, s.city.interior.exitAt.z, 4000, SIM.C.DOOR_RANGE - 1.0);
  assert.equal(g.interact(), 'leave', 'and you can get back out');
  assert.ok(!s.player.indoors, 'you are outside again');
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
  let peakCops = 0, peakCars = 0, peakDarts = 0, soakings = 0;
  for (let i = 0; i < 60 * 200; i++) {
    const input = Object.assign(noInput(), {
      forward: (i % 600) < 400,
      right: (i % 900) < 120,
      fire: i % 30 === 0,
    });
    if (i % 1200 === 0) g.raiseWanted(5);
    g.update(STEP, input);
    peakCops = Math.max(peakCops, s.cops.length);
    peakDarts = Math.max(peakDarts, s.darts.length);
    peakCars = Math.max(peakCars, s.cars.filter(c => c.kind === 'police').length);
  }
  soakings = s.stats.timesSoaked;
  assert.ok(peakCops > 0, 'officers actually turned up during the run');
  assert.ok(peakCars > 0, 'police cars actually turned up during the run');

  assert.ok(Number.isFinite(s.player.x) && Number.isFinite(s.player.z), 'the player is somewhere real');
  assert.ok(peakCops <= SIM.C.MAX_COPS, `officers stayed capped (peaked at ${peakCops})`);
  assert.ok(peakDarts < 400, `darts never piled up (peaked at ${peakDarts})`);
  assert.ok(s.wanted <= SIM.C.MAX_WANTED, 'the wanted level never passes five');
  assert.ok(s.events.length <= 6, 'the message list stays bounded');
  assert.ok(peakCars <= SIM.C.MAX_POLICE_CARS, `police cars stayed capped (peaked at ${peakCars})`);
  for (const c of s.cars) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z), 'cars stay real');
  ok(`200s of chaos: peaked at ${peakCops} cops, ${peakCars} police cars, ` +
    `${peakDarts} darts, soaked ${soakings}x — all bounded`);
}

console.log(`\n${passed} checks passed`);
