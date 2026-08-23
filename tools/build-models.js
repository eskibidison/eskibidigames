// Bundles the Kenney CC0 3D models the game uses into fps/models.js as base64
// GLB data URIs, plus fps/model-meta.js with each model's native size.
//
//   node tools/build-models.js
//
// Data URIs rather than separate .glb files because browsers block fetch() over
// file://, and the game has to work when you just double-click it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const CACHE = path.join(os.tmpdir(), 'gtafun-kenney');
const OUT_DIR = path.join(__dirname, '..', 'fps');

// kit slug -> the folder inside the zip holding GLB files
const KITS = {
  'city-kit-commercial': 'Models/GLB format',
  'city-kit-roads': 'Models/GLB format',
  'car-kit': 'Models/GLB format',
  'blocky-characters': 'Models/GLB format',
  'blaster-kit': 'Models/GLB format',
  'retro-urban-kit': 'Models/GLB format',
  'furniture-kit': 'Models/GLTF format',
};

// name in game -> [kit, file]. Every one of these is Kenney CC0 art; nothing
// here is modelled or animated by hand.
const WANTED = {
  // buildings
  'building-a': ['city-kit-commercial', 'building-a'],
  'building-c': ['city-kit-commercial', 'building-c'],
  'building-e': ['city-kit-commercial', 'building-e'],
  'building-h': ['city-kit-commercial', 'building-h'],
  'building-k': ['city-kit-commercial', 'building-k'],
  'building-n': ['city-kit-commercial', 'building-n'],
  'tower-a': ['city-kit-commercial', 'building-skyscraper-a'],
  'tower-c': ['city-kit-commercial', 'building-skyscraper-c'],
  'bank': ['city-kit-commercial', 'building-j'],

  // roads
  'road-straight': ['city-kit-roads', 'road-straight'],
  'road-crossroad': ['city-kit-roads', 'road-crossroad'],

  // vehicles
  'car-sedan': ['car-kit', 'sedan'],
  'car-taxi': ['car-kit', 'taxi'],
  'car-van': ['car-kit', 'van'],
  'car-suv': ['car-kit', 'suv'],
  'car-sports': ['car-kit', 'hatchback-sports'],
  'car-police': ['car-kit', 'police'],

  // people — rigged, with Kenney's own animation set
  'cop': ['blocky-characters', 'character-j'],
  'civ-a': ['blocky-characters', 'character-c'],
  'civ-b': ['blocky-characters', 'character-e'],

  // things you carry and things you rob
  'blaster': ['blaster-kit', 'blaster-a'],
  'atm': ['furniture-kit', 'kitchenFridge'],
  'till': ['furniture-kit', 'desk'],
  'till-screen': ['furniture-kit', 'computerScreen'],
  'vault': ['retro-urban-kit', 'wall-a-garage'],

  // street dressing
  'streetlight': ['city-kit-roads', 'light-square'],
  'traffic-light': ['city-kit-roads', 'traffic-light'],
  'dumpster': ['city-kit-roads', 'dumpster'],
  'tree': ['retro-urban-kit', 'tree-park-large'],
};

// --- zip reading (stdlib only) ----------------------------------------------

function unzip(buf, dest) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    const data = method === 0 ? raw : zlib.inflateRawSync(raw);

    const target = path.join(dest, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

async function ensureKit(slug) {
  const dir = path.join(CACHE, slug);
  if (fs.existsSync(dir)) return dir;
  const page = await (await fetch(`https://kenney.nl/assets/${slug}`)).text();
  const zipUrl = (page.match(/https?:\/\/[^"']*\.zip/) || [])[0];
  if (!zipUrl) throw new Error(`no download link for ${slug}`);
  console.log(`  downloading ${slug}`);
  const zip = Buffer.from(await (await fetch(zipUrl)).arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  unzip(zip, dir);
  return dir;
}

// --- glb inspection ----------------------------------------------------------

// Reads the JSON chunk of a .glb for its bounding box and animation names.
function inspect(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      const acc = json.accessors[prim.attributes.POSITION];
      if (!acc || !acc.min) continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], acc.min[i]);
        max[i] = Math.max(max[i], acc.max[i]);
      }
    }
  }
  const size = [0, 1, 2].map(i => (max[i] - min[i]) || 1);
  return {
    w: round(size[0]), h: round(size[1]), d: round(size[2]),
    cx: round((min[0] + max[0]) / 2),
    cy: round(min[1]),                       // models sit on their own base
    cz: round((min[2] + max[2]) / 2),
    animations: (json.animations || []).map(a => a.name),
  };
}

const round = v => Math.round(v * 1000) / 1000;

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const dirs = {};
  for (const slug of Object.keys(KITS)) dirs[slug] = await ensureKit(slug);

  const blobs = [];
  const meta = {};
  let total = 0;

  for (const [name, [kit, file]] of Object.entries(WANTED)) {
    const glb = path.join(dirs[kit], KITS[kit], file + '.glb');
    if (!fs.existsSync(glb)) throw new Error(`missing model: ${glb}`);
    const buf = fs.readFileSync(glb);
    total += buf.length;
    const info = inspect(buf);
    meta[name] = { w: info.w, h: info.h, d: info.d, cx: info.cx, cy: info.cy, cz: info.cz };
    if (info.animations.length) meta[name].animations = info.animations;
    blobs.push(`  ${JSON.stringify(name)}: "data:model/gltf-binary;base64,${buf.toString('base64')}",`);
    console.log(`  ${name.padEnd(15)} ${String(Math.round(buf.length / 1024)).padStart(4)}KB  ` +
      `${info.w} x ${info.h} x ${info.d}${info.animations.length ? '  (' + info.animations.length + ' animations)' : ''}`);
  }

  const header = '// GENERATED by tools/build-models.js — do not edit by hand.\n' +
    '// Art: Kenney 3D kits, CC0 (https://kenney.nl). Models and their animations\n' +
    '// are Kenney\'s work, embedded here so the game runs from a local file.\n';

  fs.writeFileSync(path.join(OUT_DIR, 'models.js'),
    header + 'globalThis.MODELS = {\n' + blobs.join('\n') + '\n};\n');

  const metaBody = header +
    '(function (root, factory) {\n' +
    '  var api = factory();\n' +
    '  if (typeof module === "object" && module.exports) module.exports = api;\n' +
    '  else root.MODEL_META = api;\n' +
    '})(typeof globalThis !== "undefined" ? globalThis : this, function () {\n' +
    '  return ' + JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ') + ';\n' +
    '});\n';
  fs.writeFileSync(path.join(OUT_DIR, 'model-meta.js'), metaBody);

  const outSize = fs.statSync(path.join(OUT_DIR, 'models.js')).size;
  console.log(`\n${Object.keys(WANTED).length} models, ${(total / 1024 / 1024).toFixed(2)}MB raw ` +
    `-> ${(outSize / 1024 / 1024).toFixed(2)}MB of base64`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
