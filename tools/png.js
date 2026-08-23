// Minimal dependency-free PNG decode/encode, enough for slicing Kenney tilesheets.
const fs = require('fs');
const zlib = require('zlib');

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(raw, width, height, bpp, stride) {
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      cur[i] = v & 0xff;
    }
  }
  return out;
}

// Returns { width, height, data } where data is RGBA8.
function decode(file) {
  const chunks = readChunks(fs.readFileSync(file));
  const ihdr = chunks.find(c => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (interlace !== 0) throw new Error(`${file}: interlaced PNG unsupported`);
  if (bitDepth === 16) throw new Error(`${file}: 16-bit channels unsupported`);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${file}: colour type ${colorType} unsupported`);

  const idat = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const packed = unfilter(zlib.inflateSync(idat), width, height, Math.ceil(bitsPerPixel / 8), stride);
  // Sub-byte depths (1/2/4) pack several samples per byte; widen them to one byte each.
  const flat = bitDepth === 8 ? packed : unpack(packed, width, height, channels, bitDepth, stride);

  const palette = chunks.find(c => c.type === 'PLTE');
  const trns = chunks.find(c => c.type === 'tRNS');
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * channels, d = i * 4;
    if (colorType === 6) {
      flat.copy(data, d, s, s + 4);
    } else if (colorType === 2) {
      flat.copy(data, d, s, s + 3);
      data[d + 3] = 255;
    } else if (colorType === 0 || colorType === 4) {
      const g = bitDepth === 8 ? flat[s] : Math.round((flat[s] * 255) / ((1 << bitDepth) - 1));
      data[d] = data[d + 1] = data[d + 2] = g;
      data[d + 3] = colorType === 4 ? flat[s + 1] : 255;
    } else {
      const p = flat[s] * 3;
      data[d] = palette.data[p];
      data[d + 1] = palette.data[p + 1];
      data[d + 2] = palette.data[p + 2];
      data[d + 3] = trns && flat[s] < trns.data.length ? trns.data[flat[s]] : 255;
    }
  }
  return { width, height, data };
}

// Widens 1/2/4-bit samples to one byte each, leaving palette indices and grey levels raw.
function unpack(packed, width, height, channels, bitDepth, stride) {
  const perByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  const out = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width * channels; i++) {
      const byte = packed[y * stride + ((i / perByte) | 0)];
      const shift = 8 - bitDepth * ((i % perByte) + 1);
      out[y * width * channels + i] = (byte >> shift) & mask;
    }
  }
  return out;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function encode({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function blank(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

// Copies a rectangle from src into dst, skipping fully transparent pixels.
function blit(dst, src, sx, sy, w, h, dx, dy) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = dx + x, ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const px = sx + x, py = sy + y;
      if (px < 0 || py < 0 || px >= src.width || py >= src.height) continue;
      const s = (py * src.width + px) * 4;
      if (src.data[s + 3] === 0) continue;
      src.data.copy(dst.data, (ty * dst.width + tx) * 4, s, s + 4);
    }
  }
}

function scale(img, factor) {
  const out = blank(img.width * factor, img.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const s = (((y / factor) | 0) * img.width + ((x / factor) | 0)) * 4;
      img.data.copy(out.data, (y * out.width + x) * 4, s, s + 4);
    }
  }
  return out;
}

module.exports = { decode, encode, blank, blit, scale };
