// Checks the generated atlas is present, decodable and complete.
const assert = require('assert');
require('../sprites.js');

const S = globalThis.SPRITES;
assert.match(S.atlas, /^data:image\/png;base64,/, 'atlas is a PNG data URI');

const required = [
  'car_black', 'car_blue', 'car_green', 'car_red', 'car_yellow',
  'player', 'ped_a', 'ped_b', 'ped_c', 'ped_d',
  'tree_small', 'tree_large', 'barrel', 'cone', 'oil', 'rock',
  'barrier', 'tyres', 'shed', 'grass',
];
for (const name of required) {
  const f = S.frames[name];
  assert.ok(Array.isArray(f) && f.length === 4, `${name} has a frame`);
  assert.ok(f[2] > 0 && f[3] > 0, `${name} has non-zero size`);
}

// Frames must not overlap, or sprites bleed into each other on screen.
const names = Object.keys(S.frames);
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = S.frames[names[i]], b = S.frames[names[j]];
    const apart = a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] ||
                  a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
    assert.ok(apart, `${names[i]} overlaps ${names[j]}`);
  }
}

console.log(`sprites ok: ${names.length} frames, ${(S.atlas.length / 1024).toFixed(0)}KB data URI`);
