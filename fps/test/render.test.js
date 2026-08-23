// Static checks on the renderer. There is no WebGL in Node, so this cannot
// prove the game looks right — it proves the renderer parses, and that every
// model and animation name it asks for actually exists in the bundle.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
const ok = label => { passed++; console.log('  ok  ' + label); };
const section = name => console.log('\n' + name);

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const meta = require('../model-meta.js');

section('renderer');
{
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 1, 'index.html has exactly one inline script');
  const source = scripts[0];

  // Parses as real JavaScript, in strict mode, without running.
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'index.html' }),
    'the renderer is syntactically valid');
  ok('the renderer script parses');

  // Every <script src> it depends on must exist next to it.
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.ok(srcs.length >= 5, `it loads its dependencies (${srcs.length})`);
  for (const src of srcs) {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `${src} exists`);
  }
  ok(`all ${srcs.length} script dependencies are present: ${srcs.join(', ')}`);

  // Model names are string literals passed to build() and fitScale(); a typo
  // here renders an empty group and nothing visible, with no error thrown.
  const referenced = new Set();
  for (const m of source.matchAll(/\b(?:build|fitScale)\(\s*'([a-z0-9-]+)'/g)) referenced.add(m[1]);
  for (const m of source.matchAll(/templates\['([a-z0-9-]+)'\]/g)) referenced.add(m[1]);
  // The robbable models are chosen by a ternary on loot.kind, so pick those up too.
  for (const m of source.matchAll(/kind === '(?:atm|register|vault)' \? '([a-z-]+)'/g)) referenced.add(m[1]);
  for (const m of source.matchAll(/: '(atm|till|vault)'/g)) referenced.add(m[1]);
  assert.ok(referenced.size >= 5, `the renderer names models directly (${referenced.size})`);
  for (const name of referenced) {
    assert.ok(meta[name], `model "${name}" referenced by the renderer exists in the bundle`);
  }
  ok(`all ${referenced.size} directly named models exist: ${[...referenced].sort().join(', ')}`);

  // Animation names must match the clips Kenney shipped, or the cops T-pose.
  const clips = new Set();
  for (const m of source.matchAll(/playClip\(\s*view\s*,\s*'([a-z-]+)'\s*\)/g)) clips.add(m[1]);
  assert.ok(clips.size >= 3, `the renderer plays several animations (${clips.size})`);
  for (const clip of clips) {
    assert.ok(meta.cop.animations.includes(clip),
      `animation "${clip}" exists on the character model`);
  }
  ok(`all ${clips.size} animations exist on the model: ${[...clips].sort().join(', ')}`);
}

section('bundle');
{
  require('../models.js');
  const blobs = globalThis.MODELS;
  const blobNames = Object.keys(blobs).sort();
  const metaNames = Object.keys(meta).sort();
  assert.deepEqual(blobNames, metaNames, 'models.js and model-meta.js describe the same set');
  ok(`${blobNames.length} models, metadata and data in step`);

  for (const [name, uri] of Object.entries(blobs)) {
    assert.ok(uri.startsWith('data:model/gltf-binary;base64,'), `${name} is a GLB data URI`);
    const buf = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    assert.equal(buf.toString('ascii', 0, 4), 'glTF', `${name} has a glTF magic number`);
    assert.equal(buf.readUInt32LE(16), 0x4E4F534A, `${name} starts with a JSON chunk`);
    const declared = buf.readUInt32LE(8);
    assert.equal(declared, buf.length, `${name} declares its real length`);
  }
  ok('every embedded model is a valid, complete GLB');

  // The bug that made the game hang on "unpacking the city": Kenney's GLB
  // files reference textures by relative path, and nothing serves those files.
  // Every image URI must now resolve to a texture carried in the bundle.
  require('../textures.js');
  const textures = globalThis.TEXTURES;
  let imageRefs = 0;
  for (const [name, uri] of Object.entries(blobs)) {
    const buf = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
    for (const image of json.images || []) {
      assert.ok(image.uri, `${name}: image is referenced by uri`);
      imageRefs++;
      assert.ok(image.uri.startsWith('data:') || textures[image.uri],
        `${name}: texture "${image.uri}" is present in the bundle`);
      assert.ok(!image.uri.includes('Textures/'),
        `${name}: texture "${image.uri}" is not an unresolvable external path`);
    }
  }
  assert.ok(imageRefs > 20, `models actually reference textures (${imageRefs})`);
  ok(`all ${imageRefs} texture references resolve to ${Object.keys(textures).length} bundled images`);

  for (const [key, uri] of Object.entries(textures)) {
    assert.ok(uri.startsWith('data:image/png;base64,'), `${key} is a PNG data URI`);
    const png = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    assert.equal(png.readUInt32BE(0), 0x89504E47, `${key} has a PNG signature`);
  }
  ok(`all ${Object.keys(textures).length} bundled textures are valid PNGs`);

  const total = Object.values(blobs).reduce((n, u) => n + u.length, 0);
  assert.ok(total < 12 * 1024 * 1024, `the bundle is a sane size (${(total / 1024 / 1024).toFixed(1)}MB)`);
  ok(`bundle is ${(total / 1024 / 1024).toFixed(1)}MB of base64`);

  // The characters must carry the animation set the game relies on.
  for (const who of ['cop', 'civ-a', 'civ-b']) {
    for (const clip of ['idle', 'walk', 'sit', 'holding-both-shoot']) {
      assert.ok(meta[who].animations.includes(clip), `${who} has a "${clip}" animation`);
    }
  }
  ok('characters ship with the walk, idle, sit and shoot animations the game uses');

  // Bounds must account for node transforms. Measuring accessor min/max alone
  // reported a character as 8 x 9 x 8 — one limb's local extent — and officers
  // rendered doll-sized because every scale was derived from that number.
  for (const who of ['cop', 'civ-a', 'civ-b']) {
    const m = meta[who];
    assert.ok(m.h > m.d * 2, `${who} is much taller than it is deep (${m.h} vs ${m.d})`);
    assert.ok(m.h > m.w, `${who} is taller than it is wide (${m.h} vs ${m.w})`);
  }
  ok(`characters measure like people: ${meta.cop.w} x ${meta.cop.h} x ${meta.cop.d}`);

  // A car should be clearly longer than it is tall, for the same reason.
  for (const car of ['car-police', 'car-sedan', 'car-van']) {
    const m = meta[car];
    assert.ok(m.d > m.h, `${car} is longer than it is tall (${m.d} vs ${m.h})`);
    assert.ok(m.d > m.w, `${car} is longer than it is wide (${m.d} vs ${m.w})`);
  }
  ok(`vehicles measure like cars: ${meta['car-police'].w} x ${meta['car-police'].h} x ${meta['car-police'].d}`);
}

console.log(`\n${passed} checks passed`);
