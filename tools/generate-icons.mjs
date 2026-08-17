import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "extension", "icons");
mkdirSync(outDir, { recursive: true });

const sizes = [16, 32, 48, 128];
const crcTable = makeCrcTable();

for (const size of sizes) {
  const rgba = drawIcon(size);
  const png = encodePng(size, size, rgba);
  writeFileSync(resolve(outDir, `icon${size}.png`), png);
  console.log(`icon${size}.png (${png.length} bytes)`);
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }

  const margin = Math.max(1, Math.round(size * 0.11));
  const finder = Math.max(2, Math.round(size * 0.21));

  drawFinder(pixels, size, margin, margin, finder);
  drawFinder(pixels, size, size - margin - finder, margin, finder);
  drawFinder(pixels, size, margin, size - margin - finder, finder);

  const modules = size >= 48 ? 21 : size >= 32 ? 13 : 7;
  const cell = Math.floor((size - margin * 2) / modules);
  const start = margin + Math.floor((size - margin * 2 - cell * modules) / 2);

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      const isFinder = (row < 7 && col < 7) || (row < 7 && col >= modules - 7) || (row >= modules - 7 && col < 7);
      if (isFinder) {
        continue;
      }

      const value = ((row * 31 + col * 17 + row * col * 5 + modules) % 11) > 6;
      if (!value) {
        continue;
      }

      fillRect(
        pixels,
        size,
        start + col * cell,
        start + row * cell,
        Math.max(1, Math.floor(cell * 0.62)),
        Math.max(1, Math.floor(cell * 0.62)),
        24,
        31,
        37
      );
    }
  }

  return pixels;
}

function drawFinder(pixels, size, x, y, side) {
  fillRect(pixels, size, x, y, side, side, 24, 31, 37);
  const inset = Math.max(1, Math.round(side * 0.34));
  fillRect(pixels, size, x + inset, y + inset, side - inset * 2, side - inset * 2, 255, 255, 255);
  const center = Math.max(1, Math.round(side * 0.3));
  const centerOffset = Math.max(0, Math.round((side - center) / 2));
  fillRect(pixels, size, x + centerOffset, y + centerOffset, center, center, 37, 99, 235);
}

function fillRect(pixels, size, x, y, width, height, r, g, b) {
  const endX = Math.min(size, x + width);
  const endY = Math.min(size, y + height);

  for (let py = y; py < endY; py += 1) {
    for (let px = x; px < endX; px += 1) {
      const offset = (py * size + px) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
