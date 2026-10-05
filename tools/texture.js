// BC7 (BPTC) texture decoding, LZ4 frame decompression and PNG writing. No dependencies.
// Used by tools/extract-assets.js to turn the game's own UI textures into PNG files.
//
// The BC7 block decoder is a port of bcdec by Sergii Kudlai (https://github.com/iOrange/bcdec),
// used under the MIT licence:
//   Copyright (c) 2022 Sergii Kudlai. Permission is hereby granted, free of charge, to any person
//   obtaining a copy of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights to use, copy,
//   modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
//   KIND.

'use strict';
const zlib = require('zlib');

// ---- LZ4 frame ---------------------------------------------------------------
function lz4Frame(src) {
  if (src.length < 7 || src.readUInt32LE(0) !== 0x184d2204) return src; // not LZ4: stored as is
  let p = 4;
  const flg = src[p++];
  const bd = src[p++];
  let contentSize = 0;
  if (flg & 0x08) { contentSize = Number(src.readBigUInt64LE(p)); p += 8; }
  if (flg & 0x01) p += 4;
  p++; // header checksum
  const blockChecksum = !!(flg & 0x10);
  const maxBlock = [0, 0, 0, 0, 1 << 16, 1 << 18, 1 << 20, 1 << 22][(bd >> 4) & 7];
  let out = Buffer.alloc(contentSize || maxBlock * 4);
  let o = 0;
  const need = (n) => {
    if (o + n <= out.length) return;
    const b = Buffer.alloc(Math.max(out.length * 2, o + n));
    out.copy(b, 0, 0, o);
    out = b;
  };
  for (;;) {
    const word = src.readUInt32LE(p); p += 4;
    if (word === 0) break;
    const size = word & 0x7fffffff;
    if (word & 0x80000000) { need(size); src.copy(out, o, p, p + size); o += size; p += size; }
    else {
      const end = p + size;
      while (p < end) {
        const token = src[p++];
        let lit = token >> 4;
        if (lit === 15) { let b; do { b = src[p++]; lit += b; } while (b === 255); }
        need(lit); src.copy(out, o, p, p + lit); o += lit; p += lit;
        if (p >= end) break;
        const offset = src[p] | (src[p + 1] << 8); p += 2;
        let len = token & 15;
        if (len === 15) { let b; do { b = src[p++]; len += b; } while (b === 255); }
        len += 4;
        need(len);
        let m = o - offset;
        for (let i = 0; i < len; i++) out[o++] = out[m++];
      }
    }
    if (blockChecksum) p += 4;
  }
  return out.subarray(0, o);
}

// ---- BC7 ---------------------------------------------------------------------
const COLOR_BITS = [4, 6, 5, 7, 5, 7, 7, 5];
const ALPHA_BITS = [0, 0, 0, 0, 6, 8, 7, 5];
const HAS_PBITS = 0b11001011;
const W2 = [0, 21, 43, 64];
const W3 = [0, 9, 18, 27, 37, 46, 55, 64];
const W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
// [two subsets, three subsets] x 64 shapes x 16 texels; the fix-up texel of each subset has bit 7 set
const PARTITIONS = Uint8Array.from([
  128,0,1,1,0,0,1,1,0,0,1,1,0,0,1,129,128,0,0,1,0,0,0,1,0,0,0,1,0,0,0,129,128,1,1,1,0,1,1,1,0,1,1,1,0,1,1,129,128,0,0,1,0,0,1,1,0,0,1,1,0,1,1,129,
  128,0,0,0,0,0,0,1,0,0,0,1,0,0,1,129,128,0,1,1,0,1,1,1,0,1,1,1,1,1,1,129,128,0,0,1,0,0,1,1,0,1,1,1,1,1,1,129,128,0,0,0,0,0,0,1,0,0,1,1,0,1,1,129,
  128,0,0,0,0,0,0,0,0,0,0,1,0,0,1,129,128,0,1,1,0,1,1,1,1,1,1,1,1,1,1,129,128,0,0,0,0,0,0,1,0,1,1,1,1,1,1,129,128,0,0,0,0,0,0,0,0,0,0,1,0,1,1,129,
  128,0,0,1,0,1,1,1,1,1,1,1,1,1,1,129,128,0,0,0,0,0,0,0,1,1,1,1,1,1,1,129,128,0,0,0,1,1,1,1,1,1,1,1,1,1,1,129,128,0,0,0,0,0,0,0,0,0,0,0,1,1,1,129,
  128,0,0,0,1,0,0,0,1,1,1,0,1,1,1,129,128,1,129,1,0,0,0,1,0,0,0,0,0,0,0,0,128,0,0,0,0,0,0,0,129,0,0,0,1,1,1,0,128,1,129,1,0,0,1,1,0,0,0,1,0,0,0,0,
  128,0,129,1,0,0,0,1,0,0,0,0,0,0,0,0,128,0,0,0,1,0,0,0,129,1,0,0,1,1,1,0,128,0,0,0,0,0,0,0,129,0,0,0,1,1,0,0,128,1,1,1,0,0,1,1,0,0,1,1,0,0,0,129,
  128,0,129,1,0,0,0,1,0,0,0,1,0,0,0,0,128,0,0,0,1,0,0,0,129,0,0,0,1,1,0,0,128,1,129,0,0,1,1,0,0,1,1,0,0,1,1,0,128,0,129,1,0,1,1,0,0,1,1,0,1,1,0,0,
  128,0,0,1,0,1,1,1,129,1,1,0,1,0,0,0,128,0,0,0,1,1,1,1,129,1,1,1,0,0,0,0,128,1,129,1,0,0,0,1,1,0,0,0,1,1,1,0,128,0,129,1,1,0,0,1,1,0,0,1,1,1,0,0,
  128,1,0,1,0,1,0,1,0,1,0,1,0,1,0,129,128,0,0,0,1,1,1,1,0,0,0,0,1,1,1,129,128,1,0,1,1,0,129,0,0,1,0,1,1,0,1,0,128,0,1,1,0,0,1,1,129,1,0,0,1,1,0,0,
  128,0,129,1,1,1,0,0,0,0,1,1,1,1,0,0,128,1,0,1,0,1,0,1,129,0,1,0,1,0,1,0,128,1,1,0,1,0,0,1,0,1,1,0,1,0,0,129,128,1,0,1,1,0,1,0,1,0,1,0,0,1,0,129,
  128,1,129,1,0,0,1,1,1,1,0,0,1,1,1,0,128,0,0,1,0,0,1,1,129,1,0,0,1,0,0,0,128,0,129,1,0,0,1,0,0,1,0,0,1,1,0,0,128,0,129,1,1,0,1,1,1,1,0,1,1,1,0,0,
  128,1,129,0,1,0,0,1,1,0,0,1,0,1,1,0,128,0,1,1,1,1,0,0,1,1,0,0,0,0,1,129,128,1,1,0,0,1,1,0,1,0,0,1,1,0,0,129,128,0,0,0,0,1,129,0,0,1,1,0,0,0,0,0,
  128,1,0,0,1,1,129,0,0,1,0,0,0,0,0,0,128,0,129,0,0,1,1,1,0,0,1,0,0,0,0,0,128,0,0,0,0,0,129,0,0,1,1,1,0,0,1,0,128,0,0,0,0,1,0,0,129,1,1,0,0,1,0,0,
  128,1,1,0,1,1,0,0,1,0,0,1,0,0,1,129,128,0,1,1,0,1,1,0,1,1,0,0,1,0,0,129,128,1,129,0,0,0,1,1,1,0,0,1,1,1,0,0,128,0,129,1,1,0,0,1,1,1,0,0,0,1,1,0,
  128,1,1,0,1,1,0,0,1,1,0,0,1,0,0,129,128,1,1,0,0,0,1,1,0,0,1,1,1,0,0,129,128,1,1,1,1,1,1,0,1,0,0,0,0,0,0,129,128,0,0,1,1,0,0,0,1,1,1,0,0,1,1,129,
  128,0,0,0,1,1,1,1,0,0,1,1,0,0,1,129,128,0,129,1,0,0,1,1,1,1,1,1,0,0,0,0,128,0,129,0,0,0,1,0,1,1,1,0,1,1,1,0,128,1,0,0,0,1,0,0,0,1,1,1,0,1,1,129,
  128,0,1,129,0,0,1,1,0,2,2,1,2,2,2,130,128,0,0,129,0,0,1,1,130,2,1,1,2,2,2,1,128,0,0,0,2,0,0,1,130,2,1,1,2,2,1,129,128,2,2,130,0,0,2,2,0,0,1,1,0,1,1,129,
  128,0,0,0,0,0,0,0,129,1,2,2,1,1,2,130,128,0,1,129,0,0,1,1,0,0,2,2,0,0,2,130,128,0,2,130,0,0,2,2,1,1,1,1,1,1,1,129,128,0,1,1,0,0,1,1,130,2,1,1,2,2,1,129,
  128,0,0,0,0,0,0,0,129,1,1,1,2,2,2,130,128,0,0,0,1,1,1,1,129,1,1,1,2,2,2,130,128,0,0,0,1,1,129,1,2,2,2,2,2,2,2,130,128,0,1,2,0,0,129,2,0,0,1,2,0,0,1,130,
  128,1,1,2,0,1,129,2,0,1,1,2,0,1,1,130,128,1,2,2,0,129,2,2,0,1,2,2,0,1,2,130,128,0,1,129,0,1,1,2,1,1,2,2,1,2,2,130,128,0,1,129,2,0,0,1,130,2,0,0,2,2,2,0,
  128,0,0,129,0,0,1,1,0,1,1,2,1,1,2,130,128,1,1,129,0,0,1,1,130,0,0,1,2,2,0,0,128,0,0,0,1,1,2,2,129,1,2,2,1,1,2,130,128,0,2,130,0,0,2,2,0,0,2,2,1,1,1,129,
  128,1,1,129,0,1,1,1,0,2,2,2,0,2,2,130,128,0,0,129,0,0,0,1,130,2,2,1,2,2,2,1,128,0,0,0,0,0,129,1,0,1,2,2,0,1,2,130,128,0,0,0,1,1,0,0,130,2,129,0,2,2,1,0,
  128,1,2,130,0,129,2,2,0,0,1,1,0,0,0,0,128,0,1,2,0,0,1,2,129,1,2,2,2,2,2,130,128,1,1,0,1,2,130,1,129,2,2,1,0,1,1,0,128,0,0,0,0,1,129,0,1,2,130,1,1,2,2,1,
  128,0,2,2,1,1,0,2,129,1,0,2,0,0,2,130,128,1,1,0,0,129,1,0,2,0,0,2,2,2,2,130,128,0,1,1,0,1,2,2,0,1,130,2,0,0,1,129,128,0,0,0,2,0,0,0,130,2,1,1,2,2,2,129,
  128,0,0,0,0,0,0,2,129,1,2,2,1,2,2,130,128,2,2,130,0,0,2,2,0,0,1,2,0,0,1,129,128,0,1,129,0,0,1,2,0,0,2,2,0,2,2,130,128,1,2,0,0,129,2,0,0,1,130,0,0,1,2,0,
  128,0,0,0,1,1,129,1,2,2,130,2,0,0,0,0,128,1,2,0,1,2,0,1,130,0,129,2,0,1,2,0,128,1,2,0,2,0,1,2,129,130,0,1,0,1,2,0,128,0,1,1,2,2,0,0,1,1,130,2,0,0,1,129,
  128,0,1,1,1,1,130,2,2,2,0,0,0,0,1,129,128,1,0,129,0,1,0,1,2,2,2,2,2,2,2,130,128,0,0,0,0,0,0,0,130,1,2,1,2,1,2,129,128,0,2,2,1,129,2,2,0,0,2,2,1,1,2,130,
  128,0,2,130,0,0,1,1,0,0,2,2,0,0,1,129,128,2,2,0,1,2,130,1,0,2,2,0,1,2,2,129,128,1,0,1,2,2,130,2,2,2,2,2,0,1,0,129,128,0,0,0,2,1,2,1,130,1,2,1,2,1,2,129,
  128,1,0,129,0,1,0,1,0,1,0,1,2,2,2,130,128,2,2,130,0,1,1,1,0,2,2,2,0,1,1,129,128,0,0,2,1,129,1,2,0,0,0,2,1,1,1,130,128,0,0,0,2,129,1,2,2,1,1,2,2,1,1,130,
  128,2,2,2,0,129,1,1,0,1,1,1,0,2,2,130,128,0,0,2,1,1,1,2,129,1,1,2,0,0,0,130,128,1,1,0,0,129,1,0,0,1,1,0,2,2,2,130,128,0,0,0,0,0,0,0,2,1,129,2,2,1,1,130,
  128,1,1,0,0,129,1,0,2,2,2,2,2,2,2,130,128,0,2,2,0,0,1,1,0,0,129,1,0,0,2,130,128,0,2,2,1,1,2,2,129,1,2,2,0,0,2,130,128,0,0,0,0,0,0,0,0,0,0,0,2,129,1,130,
  128,0,0,130,0,0,0,1,0,0,0,2,0,0,0,129,128,2,2,2,1,2,2,2,0,2,2,2,129,2,2,130,128,1,0,129,2,2,2,2,2,2,2,2,2,2,2,130,128,1,1,129,2,0,1,1,130,2,0,1,2,2,2,0
]);

// Decodes one 16-byte block at src[at] into out (RGBA) at pixel (x0, y0) of an image w wide.
function bc7Block(src, at, out, w, h, x0, y0) {
  let pos = at * 8;
  const bits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v |= ((src[pos >> 3] >> (pos & 7)) & 1) << i;
    return v;
  };
  let mode = 0;
  while (mode < 8 && bits(1) === 0) mode++;
  if (mode >= 8) return; // reserved: left transparent

  let partition = 0, subsets = 1, rotation = 0, indexSelection = 0;
  if (mode === 0 || mode === 1 || mode === 2 || mode === 3 || mode === 7) {
    subsets = (mode === 0 || mode === 2) ? 3 : 2;
    partition = bits(mode === 0 ? 4 : 6);
  }
  const n = subsets * 2;
  if (mode === 4 || mode === 5) {
    rotation = bits(2);
    if (mode === 4) indexSelection = bits(1);
  }
  const ep = [];
  for (let j = 0; j < n; j++) ep.push([0, 0, 0, 0]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < n; j++) ep[j][i] = bits(COLOR_BITS[mode]);
  if (ALPHA_BITS[mode]) for (let j = 0; j < n; j++) ep[j][3] = bits(ALPHA_BITS[mode]);

  if (mode === 0 || mode === 1 || mode === 3 || mode === 6 || mode === 7) {
    for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) ep[i][j] <<= 1;
    if (mode === 1) {
      const a = bits(1), b = bits(1);
      for (let k = 0; k < 3; k++) { ep[0][k] |= a; ep[1][k] |= a; ep[2][k] |= b; ep[3][k] |= b; }
    } else if (HAS_PBITS & (1 << mode)) {
      for (let i = 0; i < n; i++) { const b = bits(1); for (let k = 0; k < 4; k++) ep[i][k] |= b; }
    }
  }
  const pbit = (HAS_PBITS >> mode) & 1;
  for (let i = 0; i < n; i++) {
    let j = COLOR_BITS[mode] + pbit;
    for (let k = 0; k < 3; k++) { ep[i][k] <<= (8 - j); ep[i][k] |= ep[i][k] >> j; }
    j = ALPHA_BITS[mode] + pbit;
    ep[i][3] <<= (8 - j); ep[i][3] |= ep[i][3] >> j;
    if (!ALPHA_BITS[mode]) ep[i][3] = 255;
  }

  const indexBits = (mode === 0 || mode === 1) ? 3 : (mode === 6 ? 4 : 2);
  const indexBits2 = mode === 4 ? 3 : (mode === 5 ? 2 : 0);
  const weights = indexBits === 2 ? W2 : (indexBits === 3 ? W3 : W4);
  const weights2 = indexBits2 === 2 ? W2 : W3;
  const set = (i, j) => (subsets === 1 ? ((i | j) ? 0 : 128) : PARTITIONS[(subsets - 2) * 1024 + partition * 16 + i * 4 + j]);
  const mix = (a, b, wt, idx) => (a * (64 - wt[idx]) + b * wt[idx] + 32) >> 6;

  const indices = new Uint8Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) indices[i * 4 + j] = bits((set(i, j) & 0x80) ? indexBits - 1 : indexBits);

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const s = set(i, j) & 3;
      const e0 = ep[s * 2], e1 = ep[s * 2 + 1];
      const index = indices[i * 4 + j];
      let r, g, b, a;
      if (!indexBits2) {
        r = mix(e0[0], e1[0], weights, index); g = mix(e0[1], e1[1], weights, index);
        b = mix(e0[2], e1[2], weights, index); a = mix(e0[3], e1[3], weights, index);
      } else {
        const index2 = bits((i | j) ? indexBits2 : indexBits2 - 1);
        if (!indexSelection) {
          r = mix(e0[0], e1[0], weights, index); g = mix(e0[1], e1[1], weights, index);
          b = mix(e0[2], e1[2], weights, index); a = mix(e0[3], e1[3], weights2, index2);
        } else {
          r = mix(e0[0], e1[0], weights2, index2); g = mix(e0[1], e1[1], weights2, index2);
          b = mix(e0[2], e1[2], weights2, index2); a = mix(e0[3], e1[3], weights, index);
        }
      }
      let t;
      if (rotation === 1) { t = a; a = r; r = t; }
      else if (rotation === 2) { t = a; a = g; g = t; }
      else if (rotation === 3) { t = a; a = b; b = t; }
      const x = x0 + j, y = y0 + i;
      if (x >= w || y >= h) continue;
      const o = (y * w + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
}

// Decodes the top mip level of a DDS file holding BC7 data. Returns { width, height, rgba }.
function decodeDds(file) {
  const d = lz4Frame(file);
  if (d.toString('latin1', 0, 4) !== 'DDS ') throw new Error('not a DDS texture');
  const height = d.readUInt32LE(12), width = d.readUInt32LE(16);
  const fourcc = d.toString('latin1', 84, 88);
  const format = fourcc === 'DX10' ? d.readUInt32LE(128) : -1;
  if (format !== 98 && format !== 99) throw new Error('texture format ' + (fourcc === 'DX10' ? 'DXGI ' + format : fourcc) + ' is not BC7');
  const rgba = Buffer.alloc(width * height * 4);
  let at = 148;
  for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4, at += 16) bc7Block(d, at, rgba, width, height, x, y);
  return { width, height, rgba };
}

// ---- images ------------------------------------------------------------------
function crop(img, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let r = 0; r < h; r++) img.rgba.copy(out, r * w * 4, ((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4);
  return { width: w, height: h, rgba: out };
}

function png(img) {
  const stride = img.width * 4 + 1;
  const raw = Buffer.alloc(stride * img.height);
  for (let y = 0; y < img.height; y++) img.rgba.copy(raw, y * stride + 1, y * img.width * 4, (y + 1) * img.width * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(img.width, 0);
  head.writeUInt32BE(img.height, 4);
  head[8] = 8; head[9] = 6; // 8 bits per channel, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { lz4Frame, decodeDds, crop, png };
