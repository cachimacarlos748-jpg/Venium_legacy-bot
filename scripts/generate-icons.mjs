// Generates the PWA icons (plain + maskable) from a drawn "V" lightning logo.
// Run: node scripts/generate-icons.mjs
// Writes PNGs with pure zlib (no dependencies).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Simple 2D helpers
function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}
function setPx(canvas, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  canvas.data[i] = r;
  canvas.data[i + 1] = g;
  canvas.data[i + 2] = b;
  canvas.data[i + 3] = a;
}
function fillCircle(canvas, cx, cy, radius, r, g, b, a = 255) {
  for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= radius) setPx(canvas, x, y, r, g, b, a);
    }
  }
}
// Fills a convex polygon with scanline rasterization.
function fillPolygon(canvas, points, r, g, b) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) {
        setPx(canvas, x, y, r, g, b, 255);
      }
    }
  }
}

// Dark rounded square + cyan/blue gradient bolt (the "V" lightning of Vex).
function drawIcon(size, { maskable = false } = {}) {
  const canvas = makeCanvas(size);
  const s = size / 512;
  if (!maskable) {
    // Rounded-rect background
    const radius = 96 * s;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = Math.min(x, size - x);
        const dy = Math.min(y, size - y);
        const inside = dx >= 0 && dy >= 0 && (dx < radius || dy < radius ? Math.hypot(Math.max(dx - radius, 0), Math.max(dy - radius, 0)) <= radius : true);
        if (inside) {
          // vertical gradient #4f7cff -> #22d3ee hints
          setPx(canvas, x, y, 0x0b, 0x10, 0x20);
        }
      }
    }
  } else {
    // Maskable: full-bleed background with a safe zone.
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setPx(canvas, x, y, 0x0b, 0x10, 0x20);
  }
  // Accent circle behind the bolt
  fillCircle(canvas, size / 2, size / 2, 170 * s, 0x1b, 0x2a, 0x6b, 255);
  // Lightning bolt polygon (a stylized V/bolt hybrid)
  const bolt = [
    [300 * s, 60 * s],
    [150 * s, 300 * s],
    [250 * s, 300 * s],
    [190 * s, 460 * s],
    [370 * s, 220 * s],
    [270 * s, 220 * s],
  ];
  fillPolygon(canvas, bolt, 0x22, 0xd3, 0xee);
  // Slight white core to pop
  const core = [
    [285 * s, 110 * s],
    [200 * s, 275 * s],
    [255 * s, 275 * s],
    [222 * s, 395 * s],
    [330 * s, 235 * s],
    [272 * s, 235 * s],
  ];
  fillPolygon(canvas, core, 0xe7, 0xec, 0xff);
  return png(size, size, canvas.data);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", drawIcon(192));
writeFileSync("public/icons/icon-512.png", drawIcon(512));
writeFileSync("public/icons/icon-maskable-512.png", drawIcon(512, { maskable: true }));
console.log("[icons] written to public/icons/");
