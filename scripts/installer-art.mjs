/**
 * The two pictures the Windows installer is allowed to have.
 *
 * `tauri icon` turns assets/app-icon.svg into the app's icons, but neither of
 * the images an installer wants is something it produces: NSIS reads its header
 * strip as a BMP, which no other part of this repository has a use for, and the
 * icon on the setup executable cannot be the app's — that mark is white on
 * nothing, drawn for a dark taskbar, and a file list is white, so it would ship
 * an installer with no icon at all. Both are drawn here instead, in the ink the
 * window uses for its primary, which is legible either way round.
 *
 * The geometry is assets/icon.svg's, mirrored the same way assets/app-icon.svg
 * mirrors it: change the mark there first, then bring it across. What is copied
 * is only the path, because a rounded rectangle with a bite out of it is a
 * distance function anyone can write, and a whole SVG renderer is not worth
 * carrying to draw one.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src-tauri", "installer");

/** The ink. `primary.main` of the light palette in src/theme.ts. */
const INK = [0x2f, 0x6f, 0xe4];

/* icon.svg's coordinates. The stroke is app-icon.svg's rather than icon.svg's:
   these are read at 16px, where a 2-unit hairline lands under a fifth of a
   pixel and disappears. */
const CENTRE = 70; // Both the box's centre and the rounded rectangle's.
const HALF = 40; // Half the rectangle's side: it spans 30..110.
const RADIUS = 18; // Its corner radius.
const STROKE = 10;
const DOT = { x: 94, y: 100, r: 9 };
/* Where the outline stops. The path runs from (110,76) the long way round to
   (72,110), so what it leaves out is everything past both of them — the corner
   the dot sits in. */
const GAP = { x: 72, y: 76 };
const ENDS = [
  { x: 110, y: 76 },
  { x: 72, y: 110 },
];

/** Distance from `(x, y)` to the rounded rectangle's outline, unsigned. */
function toOutline(x, y) {
  const dx = Math.abs(x - CENTRE) - (HALF - RADIUS);
  const dy = Math.abs(y - CENTRE) - (HALF - RADIUS);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return Math.abs(outside + Math.min(Math.max(dx, dy), 0) - RADIUS);
}

/** Distance from `(x, y)` to the mark, negative inside it. */
function toMark(x, y) {
  const half = STROKE / 2;
  /* The bitten-out corner is cut with a half-plane rather than by walking the
     path, and the two round caps are then put back as discs — which is exactly
     what stroke-linecap="round" draws. */
  let d = x > GAP.x && y > GAP.y ? Number.POSITIVE_INFINITY : toOutline(x, y) - half;
  for (const end of ENDS) d = Math.min(d, Math.hypot(x - end.x, y - end.y) - half);
  return Math.min(d, Math.hypot(x - DOT.x, y - DOT.y) - DOT.r);
}

/* The mark's drawn extent, stroke included: everything outside this is blank. */
const EXTENT = HALF * 2 + STROKE;

/**
 * Coverage of the mark over `size × size` pixels, 0..1 per pixel.
 *
 * `inset` is how much of the square is left empty around the mark. Sampling is
 * a plain 8×8 grid, which is more than the shape needs — there is no glyph here
 * small enough for the cost to be worth thinking about.
 */
function coverage(size, inset) {
  const scale = EXTENT / (size - inset * 2);
  const origin = CENTRE - (size / 2) * scale;
  const out = new Float32Array(size * size);
  const SUB = 8;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const x = origin + (px + (sx + 0.5) / SUB) * scale;
          const y = origin + (py + (sy + 0.5) / SUB) * scale;
          if (toMark(x, y) < 0) hits++;
        }
      }
      out[py * size + px] = hits / (SUB * SUB);
    }
  }
  return out;
}

/** The mark as straight RGBA, `size × size`, on nothing. */
function markRgba(size, inset) {
  const alpha = coverage(size, inset);
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = INK[0];
    px[i * 4 + 1] = INK[1];
    px[i * 4 + 2] = INK[2];
    px[i * 4 + 3] = Math.round(alpha[i] * 255);
  }
  return px;
}

/**
 * NSIS's header strip: the mark, centred, on the header's own white.
 *
 * 150×57 is the size of the control MUI puts it in, and matching it exactly is
 * what keeps the bitmap from being stretched into it.
 */
function headerBmp(width, height, markSize) {
  const mark = coverage(markSize, 0);
  const left = Math.round((width - markSize) / 2);
  const top = Math.round((height - markSize) / 2);

  /* 24-bit BMP: rows are BGR, bottom-up, and padded to a multiple of four. */
  const stride = (width * 3 + 3) & ~3;
  const pixels = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < markSize; y++) {
    for (let x = 0; x < markSize; x++) {
      const a = mark[y * markSize + x];
      if (a === 0) continue;
      const row = height - 1 - (top + y);
      const at = row * stride + (left + x) * 3;
      for (let c = 0; c < 3; c++) pixels[at + c] = Math.round(0xff + (INK[2 - c] - 0xff) * a);
    }
  }

  const header = Buffer.alloc(54);
  header.write("BM", 0, "ascii");
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14); // BITMAPINFOHEADER
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26); // planes
  header.writeUInt16LE(24, 28); // bits per pixel
  header.writeUInt32LE(pixels.length, 34);
  header.writeInt32LE(2835, 38); // 72dpi, in pixels per metre
  header.writeInt32LE(2835, 42);
  return Buffer.concat([header, pixels]);
}

/** One PNG chunk, length and CRC included. */
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGBA pixels as a PNG. The icon's largest entry is one of these. */
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** One icon entry as a bottom-up 32-bit DIB, which is what Windows reads first. */
function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // colour rows and mask rows together
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);

  const colour = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      colour[to] = rgba[from + 2]; // BGRA
      colour[to + 1] = rgba[from + 1];
      colour[to + 2] = rgba[from];
      colour[to + 3] = rgba[from + 3];
    }
  }
  /* The 1-bit AND mask predates alpha and is ignored when there is any, but the
     rows still have to be there, padded to four bytes each. */
  const mask = Buffer.alloc((((size + 31) >> 5) << 2) * size);
  return Buffer.concat([header, colour, mask]);
}

/**
 * The setup executable's icon.
 *
 * Sizes below 256 go in as DIBs and 256 as a PNG, which is the layout every
 * version of Windows that runs a Tauri app knows how to read.
 */
function ico(sizes) {
  const entries = sizes.map((size) => {
    const rgba = markRgba(size, Math.max(1, Math.round(size / 16)));
    return { size, body: size === 256 ? png(size, rgba) : dib(size, rgba) };
  });

  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(1, 2); // an icon, rather than a cursor
  directory.writeUInt16LE(entries.length, 4);
  let offset = directory.length;
  entries.forEach((entry, i) => {
    const at = 6 + i * 16;
    directory[at] = entry.size === 256 ? 0 : entry.size; // 0 means 256
    directory[at + 1] = entry.size === 256 ? 0 : entry.size;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.body.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.body.length;
  });
  return Buffer.concat([directory, ...entries.map((entry) => entry.body)]);
}

/* 150x57 is the control MUI hands the bitmap, and the mark inside it is 40:
   the strip is 57 tall, and a mark that fills it has nothing to sit in. */
writeFileSync(join(OUT, "header.bmp"), headerBmp(150, 57, 40));
writeFileSync(join(OUT, "icon.ico"), ico([16, 24, 32, 48, 64, 128, 256]));
console.log("src-tauri/installer/header.bmp, src-tauri/installer/icon.ico");
