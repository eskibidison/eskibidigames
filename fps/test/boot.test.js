// Boots the real renderer in Node against browser stubs, with WebGL replaced
// by a recorder. It cannot prove the game looks right, but it does prove the
// thing that actually breaks: that loading finishes, the world gets built, and
// frames run without throwing.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
const ok = label => { passed++; console.log('  ok  ' + label); };

const ROOT = path.join(__dirname, '..');

function browserSandbox() {
  const state = { images: 0, rafs: [], elements: {}, drawn: 0 };

  const sandbox = {
    console, Math, Date, JSON, Object, Array, Number, String, Boolean, Symbol,
    Set, Map, WeakMap, WeakSet, Promise, Error, TypeError, RangeError, RegExp,
    ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array,
    Int32Array, Float32Array, Float64Array, DataView, Uint8ClampedArray,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    TextDecoder, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask, isFinite,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    performance: { now: () => state.now },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    requestAnimationFrame: cb => { state.rafs.push(cb); return state.rafs.length; },
    addEventListener() {},
  };
  state.now = 0;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };
  sandbox.Blob = class { constructor(p) { this.parts = p; } };

  const element = tag => {
    const el = {
      tagName: tag, style: {}, width: 4, height: 4, textContent: '', innerHTML: '',
      classList: { add() {}, remove() {} },
      addEventListener(type, fn) { this['on' + type] = fn; },
      removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
      appendChild() {}, removeChild() {}, requestPointerLock() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      getContext: () => ({
        fillRect() {}, drawImage() {}, translate() {}, scale() {}, save() {}, restore() {},
        getImageData: () => ({ data: new Uint8Array(16) }),
        createImageData: () => ({ data: new Uint8Array(16) }), putImageData() {},
      }),
    };
    let src = '';
    Object.defineProperty(el, 'src', {
      get: () => src,
      set(v) { src = v; state.images++; setTimeout(() => el.onload && el.onload({ target: el }), 0); },
    });
    return el;
  };

  sandbox.document = {
    createElement: element,
    createElementNS: (ns, tag) => element(tag),
    querySelector: () => element('div'),
    getElementById: id => (state.elements[id] || (state.elements[id] = element('div'))),
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {}, style: {} },
    documentElement: { style: {} },
  };
  sandbox.HTMLImageElement = function () {};
  sandbox.HTMLCanvasElement = function () {};

  return { sandbox, state };
}

const { sandbox, state } = browserSandbox();
const ctx = vm.createContext(sandbox);
const runFile = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

const errors = [];
runFile('lib/three.min.js');
runFile('lib/GLTFLoader.js');
runFile('model-meta.js');
runFile('textures.js');
runFile('models.js');
runFile('sim.js');

// Swap WebGL for a recorder: everything else in the renderer runs for real.
vm.runInContext(`
  globalThis.__renders = 0;
  THREE.WebGLRenderer = function () {
    this.domElement = document.createElement('canvas');
    this.shadowMap = {};
    this.setPixelRatio = function () {};
    this.setSize = function () {};
    this.render = function () { globalThis.__renders++; };
    this.dispose = function () {};
  };
`, ctx);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

console.log('\nboot');
try {
  vm.runInContext(source, ctx, { filename: 'index.html' });
} catch (e) {
  errors.push('startup threw: ' + e.message + '\n' + e.stack.split('\n').slice(1, 5).join('\n'));
}
assert.equal(errors.length, 0, errors[0]);
ok('the renderer script runs without throwing');

// Let the model parses and their texture loads settle.
const waitFor = (predicate, ms) => new Promise((resolve, reject) => {
  const started = Date.now();
  const tick = () => {
    if (predicate()) return resolve();
    if (Date.now() - started > ms) return reject(new Error('timed out'));
    setTimeout(tick, 25);
  };
  tick();
});

(async () => {
  try {
    await waitFor(() => state.rafs.length > 0, 30000);
  } catch (e) {
    assert.fail('loading never finished: the game never reached its first frame ' +
      '(this is exactly the "stuck on unpacking the city" symptom)');
  }
  ok('loading finishes and the game reaches its first frame');

  const loading = state.elements['loading'];
  assert.equal(loading.style.display, 'none', 'the loading screen gets hidden');
  assert.equal(state.elements['start'].style.display, 'flex', 'the start screen gets shown');
  ok('the loading screen is dismissed and the title screen appears');

  // Run a few hundred frames of the real loop.
  let frames = 0;
  try {
    for (let i = 0; i < 300; i++) {
      const queued = state.rafs.splice(0, state.rafs.length);
      if (!queued.length) break;
      state.now += 16.67;
      for (const cb of queued) { cb(state.now); frames++; }
    }
  } catch (e) {
    assert.fail('a frame threw: ' + e.message + '\n' + e.stack.split('\n').slice(1, 5).join('\n'));
  }
  assert.ok(frames > 250, `frames ran (${frames})`);
  assert.ok(ctx.__renders > 250, `the scene was rendered every frame (${ctx.__renders})`);
  ok(`${frames} frames ran and rendered without throwing`);

  const sim = ctx.S;
  assert.ok(Number.isFinite(sim.player.x), 'the player is somewhere real after 300 frames');
  assert.ok(ctx.scene.children.length > 50,
    `the world got built into the scene (${ctx.scene.children.length} top-level objects)`);
  ok(`${ctx.scene.children.length} objects in the scene, ${state.images} textures loaded`);

  console.log(`\n${passed} checks passed`);
})();
