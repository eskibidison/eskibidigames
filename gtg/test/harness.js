// Runs the real game loop from index.html in Node, against a stubbed browser.
// There is no browser automation here, so this is how the game gets verified:
// bots hold keys, frames advance on a fixed clock, and __p() reports state.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FRAME_MS = 1000 / 60;

// Reads real dimensions out of a base64 PNG's IHDR so sprite maths is honest.
function pngSize(dataUri) {
  const buf = Buffer.from(dataUri.split(',')[1], 'base64');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function fakeCanvas(width, height) {
  const canvas = { width, height, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  const ctx = new Proxy({ canvas }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 8 });
      if (key === 'createPattern') return () => ({});
      if (key === 'createLinearGradient' || key === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  canvas.getContext = () => ctx;
  return canvas;
}

function boot(options = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('index.html has no inline <script>');
  const gameSource = match[1];
  const spritesSource = fs.readFileSync(path.join(ROOT, 'sprites.js'), 'utf8');

  const canvas = fakeCanvas(960, 600);
  const listeners = { keydown: [], keyup: [], resize: [], click: [], blur: [] };
  const rafQueue = [];
  const pending = [];
  const store = new Map();
  let clock = 0;

  class FakeImage {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.onload = null;
    }
    set src(value) {
      this._src = value;
      const size = pngSize(value);
      this.width = size.width;
      this.height = size.height;
      pending.push(() => this.onload && this.onload());
    }
    get src() {
      return this._src;
    }
  }

  const addListener = (type, fn) => {
    if (listeners[type]) listeners[type].push(fn);
  };

  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Set,
    Map,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    Image: FakeImage,
    performance: { now: () => clock },
    requestAnimationFrame: cb => {
      rafQueue.push(cb);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => { pending.push(fn); return 0; },
    clearTimeout: () => {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    document: {
      getElementById: () => canvas,
      createElement: () => fakeCanvas(64, 64),
      addEventListener: addListener,
      body: { appendChild() {}, style: {} },
      documentElement: { style: {} },
    },
    AudioContext: class {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
        this.state = 'running';
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {}, start() {}, stop() {},
        };
      }
      createGain() {
        return {
          gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
      resume() {}
    },
  };
  // window aliases the sandbox; globalThis is left alone so the vm's own
  // global proxy stays intact and __p() surfaces on `context`.
  sandbox.window = sandbox;
  sandbox.window.innerWidth = 1280;
  sandbox.window.innerHeight = 800;
  sandbox.window.devicePixelRatio = 1;
  sandbox.window.addEventListener = addListener;
  sandbox.GTG_SEED = options.seed;

  const context = vm.createContext(sandbox);
  vm.runInContext(spritesSource, context, { filename: 'sprites.js' });
  vm.runInContext(gameSource, context, { filename: 'index.html' });

  const held = new Set();
  const fire = (type, key) => {
    for (const fn of listeners[type]) fn({ key, code: key === ' ' ? 'Space' : key, preventDefault() {}, repeat: false });
  };

  const api = {
    keys: held,
    context,
    // Advances exactly n fixed frames, syncing key state and flushing loads first.
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        while (pending.length) pending.shift()();
        for (const key of held) {
          if (!api._down.has(key)) {
            api._down.add(key);
            fire('keydown', key);
          }
        }
        for (const key of [...api._down]) {
          if (!held.has(key)) {
            api._down.delete(key);
            fire('keyup', key);
          }
        }
        clock += FRAME_MS;
        const callbacks = rafQueue.splice(0, rafQueue.length);
        for (const cb of callbacks) cb(clock);
      }
      return api;
    },
    tap(key, frames = 2) {
      held.add(key);
      api.step(frames);
      held.delete(key);
      api.step(1);
      return api;
    },
    probe() {
      return context.__p();
    },
    _down: new Set(),
  };

  api.step(2); // let the sprite sheet load and the first frame settle
  return api;
}

module.exports = { boot, FRAME_MS };
