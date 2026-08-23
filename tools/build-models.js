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
const crypto = require('crypto');

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
  // A spread of the pack's people, so the street is not eight of the same man.
  'civ-a': ['blocky-characters', 'character-c'],
  'civ-b': ['blocky-characters', 'character-e'],
  'civ-c': ['blocky-characters', 'character-b'],
  'civ-d': ['blocky-characters', 'character-i'],
  'civ-e': ['blocky-characters', 'character-k'],
  'civ-f': ['blocky-characters', 'character-n'],
  'civ-g': ['blocky-characters', 'character-p'],
  'civ-h': ['blocky-characters', 'character-q'],

  // things you carry and things you rob
  'blaster': ['blaster-kit', 'blaster-a'],
  'blaster-rapid': ['blaster-kit', 'blaster-b'],
  'blaster-heavy': ['blaster-kit', 'blaster-f'],
  'blaster-scatter': ['blaster-kit', 'blaster-i'],
  'blaster-long': ['blaster-kit', 'blaster-k'],
  'dart': ['blaster-kit', 'bullet-foam'],
  'crate': ['blaster-kit', 'crate-medium'],

  // the bank interior, built from wall and floor pieces
  'wall': ['retro-urban-kit', 'wall-a-flat'],
  'wall-door': ['retro-urban-kit', 'wall-a-door'],
  'wall-corner': ['retro-urban-kit', 'wall-a-corner'],
  'wall-window': ['retro-urban-kit', 'wall-a-flat-window'],
  'wall-broken': ['retro-urban-kit', 'wall-broken-type-a'],
  'floor': ['furniture-kit', 'floorFull'],
  'sofa': ['furniture-kit', 'loungeSofa'],
  'lamp': ['furniture-kit', 'lampSquareFloor'],
  'table': ['furniture-kit', 'tableCoffee'],
  'rug': ['furniture-kit', 'rugRectangle'],
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


// Kenney's GLB files do NOT embed their textures — they reference them as
// relative paths like "Textures/colormap.png". Nothing resolves those at
// runtime, which is why the loader used to hang forever on a local file. So
// the textures get pulled in here, deduplicated by content, and each model's
// image URI is rewritten to a stable key the game can resolve from memory.
function rewriteTextures(buf, glbPath, textures) {
  const jsonLen = buf.readUInt32LE(12);
  const jsonEnd = 20 + jsonLen;
  const json = JSON.parse(buf.toString('utf8', 20, jsonEnd));

  let binChunk = Buffer.alloc(0);
  if (buf.length > jsonEnd + 8 && buf.readUInt32LE(jsonEnd + 4) === 0x004E4942) {
    const binLen = buf.readUInt32LE(jsonEnd);
    binChunk = buf.subarray(jsonEnd + 8, jsonEnd + 8 + binLen);
  }

  let rewritten = 0;
  for (const image of json.images || []) {
    if (!image.uri || image.uri.startsWith('data:')) continue;
    const file = path.join(path.dirname(glbPath), decodeURIComponent(image.uri));
    if (!fs.existsSync(file)) throw new Error(`missing texture ${image.uri} for ${glbPath}`);
    const png = fs.readFileSync(file);
    const id = crypto.createHash('sha1').update(png).digest('hex').slice(0, 10);
    const key = 'tex/' + id + '.png';
    if (!textures[key]) textures[key] = png;
    image.uri = key;
    rewritten++;
  }
  if (!rewritten) return { buf: buf, textures: 0 };

  return { buf: repackGlb(json, binChunk), textures: rewritten };
}

// Rebuilds a .glb around a modified JSON chunk. Both chunks are padded to a
// four-byte boundary, as the container format requires.
function repackGlb(json, binChunk) {
  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  while (jsonBytes.length % 4 !== 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.from(' ')]);
  let bin = binChunk;
  while (bin.length % 4 !== 0) bin = Buffer.concat([bin, Buffer.from([0])]);

  const parts = [];
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  parts.push(header);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4E4F534A, 4);
  parts.push(jsonHeader, jsonBytes);

  if (bin.length) {
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.length, 0);
    binHeader.writeUInt32LE(0x004E4942, 4);
    parts.push(binHeader, bin);
  }

  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length, 8);
  return out;
}

// --- glb inspection ----------------------------------------------------------

// 4x4 column-major helpers, matching glTF's convention.
function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function trs(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function apply(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

// Reads the JSON chunk of a .glb for its bounding box and animation names.
//
// Node transforms matter: a blocky character is six separate meshes parked at
// different heights by their node translations. Measuring accessor min/max
// alone reported one limb's local extent — 8 x 9 x 8 for a person — and every
// scale derived from it was wrong, which is why officers rendered doll-sized.
function inspect(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const visit = (nodeIndex, parent) => {
    const node = json.nodes[nodeIndex];
    if (!node) return;
    const world = multiply(parent, trs(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (!acc || !acc.min) continue;
        // All eight corners, so rotation is accounted for.
        for (let corner = 0; corner < 8; corner++) {
          const local = [
            corner & 1 ? acc.max[0] : acc.min[0],
            corner & 2 ? acc.max[1] : acc.min[1],
            corner & 4 ? acc.max[2] : acc.min[2],
          ];
          const world3 = apply(world, local);
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], world3[i]);
            max[i] = Math.max(max[i], world3[i]);
          }
        }
      }
    }
    for (const child of node.children || []) visit(child, world);
  };

  const scene = json.scenes[json.scene || 0];
  for (const root of scene.nodes) visit(root, identity());

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
  const textures = {};
  let total = 0;

  for (const [name, [kit, file]] of Object.entries(WANTED)) {
    const glb = path.join(dirs[kit], KITS[kit], file + '.glb');
    if (!fs.existsSync(glb)) throw new Error(`missing model: ${glb}`);
    const raw = fs.readFileSync(glb);
    const fixed = rewriteTextures(raw, glb, textures);
    const buf = fixed.buf;
    total += buf.length;
    const info = inspect(buf);
    meta[name] = { w: info.w, h: info.h, d: info.d, cx: info.cx, cy: info.cy, cz: info.cz };
    if (info.animations.length) meta[name].animations = info.animations;
    blobs.push(`  ${JSON.stringify(name)}: "data:model/gltf-binary;base64,${buf.toString('base64')}",`);
    console.log(`  ${name.padEnd(15)} ${String(Math.round(buf.length / 1024)).padStart(4)}KB  ` +
      `${info.w} x ${info.h} x ${info.d}` +
      `${fixed.textures ? '  ' + fixed.textures + ' tex' : ''}` +
      `${info.animations.length ? '  (' + info.animations.length + ' animations)' : ''}`);
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

  const texEntries = Object.entries(textures).map(([key, png]) =>
    `  ${JSON.stringify(key)}: "data:image/png;base64,${png.toString('base64')}",`);
  fs.writeFileSync(path.join(OUT_DIR, 'textures.js'),
    header + 'globalThis.TEXTURES = {\n' + texEntries.join('\n') + '\n};\n');

  const texBytes = Object.values(textures).reduce((n, b) => n + b.length, 0);
  console.log(`\n${Object.keys(textures).length} unique textures, ${(texBytes / 1024).toFixed(0)}KB raw`);

  const outSize = fs.statSync(path.join(OUT_DIR, 'models.js')).size;
  console.log(`\n${Object.keys(WANTED).length} models, ${(total / 1024 / 1024).toFixed(2)}MB raw ` +
    `-> ${(outSize / 1024 / 1024).toFixed(2)}MB of base64`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
