// Builds gtg/sprites.js: one atlas PNG (as a data URI) plus a frame table,
// packed from Kenney's Racing Pack (CC0, https://kenney.nl/assets/racing-pack).
//
//   node tools/build-sprites.js
//
// The pack is cached in the system temp dir, so only the first run needs network.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const png = require('./png.js');

const PACK_PAGE = 'https://kenney.nl/assets/racing-pack';
const CACHE = path.join(os.tmpdir(), 'gtg-kenney-racing-pack');
const OUT = path.join(__dirname, '..', 'gtg', 'sprites.js');

// name -> path inside the pack. Sprites are used untrimmed so that every frame
// stays centred on its own origin; the game draws them from the centre.
const WANTED = {
  car_black: 'PNG/Cars/car_black_1.png',
  car_blue: 'PNG/Cars/car_blue_1.png',
  car_green: 'PNG/Cars/car_green_1.png',
  car_red: 'PNG/Cars/car_red_1.png',
  car_yellow: 'PNG/Cars/car_yellow_1.png',
  player: 'PNG/Characters/character_blonde_blue.png',
  ped_a: 'PNG/Characters/character_brown_green.png',
  ped_b: 'PNG/Characters/character_black_red.png',
  ped_c: 'PNG/Characters/character_blonde_white.png',
  ped_d: 'PNG/Characters/character_brown_white.png',
  tree_small: 'PNG/Objects/tree_small.png',
  tree_large: 'PNG/Objects/tree_large.png',
  barrel: 'PNG/Objects/barrel_red.png',
  cone: 'PNG/Objects/cone_straight.png',
  oil: 'PNG/Objects/oil.png',
  rock: 'PNG/Objects/rock1.png',
  barrier: 'PNG/Objects/barrier_white.png',
  tyres: 'PNG/Objects/tires_white.png',
  shed: 'PNG/Objects/tent_blue.png',
  grass: 'PNG/Tiles/Grass/land_grass04.png',
};

const ATLAS_WIDTH = 512;
const PAD = 2;

// --- zip reading (stdlib only) ----------------------------------------------

// Walks the end-of-central-directory record so we get real names and sizes
// rather than guessing at local headers.
function unzip(buf, dest) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory entry');
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

async function ensurePack() {
  if (fs.existsSync(path.join(CACHE, WANTED.car_red))) {
    console.log(`using cached pack at ${CACHE}`);
    return;
  }
  console.log(`fetching ${PACK_PAGE}`);
  const page = await (await fetch(PACK_PAGE)).text();
  const zipUrl = (page.match(/https?:\/\/[^"']*\.zip/) || [])[0];
  if (!zipUrl) throw new Error('could not find the pack download link on the page');
  console.log(`downloading ${zipUrl}`);
  const zip = Buffer.from(await (await fetch(zipUrl)).arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  unzip(zip, CACHE);
  console.log(`unpacked to ${CACHE}`);
}

// --- packing ----------------------------------------------------------------

// Shelf packer: tallest-first into rows. Good enough for twenty sprites and
// deterministic, which matters because sprites.js is committed.
function pack(images) {
  const order = [...images].sort((a, b) => b.height - a.height || a.name.localeCompare(b.name));
  let x = PAD, y = PAD, shelfHeight = 0;
  const placed = [];
  for (const img of order) {
    if (x + img.width + PAD > ATLAS_WIDTH) {
      x = PAD;
      y += shelfHeight + PAD;
      shelfHeight = 0;
    }
    placed.push({ ...img, x, y });
    x += img.width + PAD;
    shelfHeight = Math.max(shelfHeight, img.height);
  }
  return { placed, height: y + shelfHeight + PAD };
}

async function main() {
  await ensurePack();

  const images = Object.entries(WANTED).map(([name, rel]) => {
    const img = png.decode(path.join(CACHE, rel));
    return { name, ...img };
  });

  const { placed, height } = pack(images);
  const atlas = png.blank(ATLAS_WIDTH, height);
  const frames = {};
  for (const p of placed) {
    png.blit(atlas, p, 0, 0, p.width, p.height, p.x, p.y);
    frames[p.name] = [p.x, p.y, p.width, p.height];
  }

  const buf = png.encode(atlas);
  const sorted = Object.fromEntries(Object.keys(frames).sort().map(k => [k, frames[k]]));
  const body = [
    '// GENERATED by tools/build-sprites.js — do not edit by hand.',
    '// Art: Kenney Racing Pack, CC0 (https://kenney.nl/assets/racing-pack)',
    'globalThis.SPRITES = {',
    `  atlas: "data:image/png;base64,${buf.toString('base64')}",`,
    '  frames: {',
    ...Object.entries(sorted).map(([k, v]) => `    ${k}: [${v.join(', ')}],`),
    '  },',
    '};',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body);
  console.log(`atlas ${ATLAS_WIDTH}x${height}, ${placed.length} frames, ` +
    `${(buf.length / 1024).toFixed(1)}KB png -> ${(body.length / 1024).toFixed(1)}KB js`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
