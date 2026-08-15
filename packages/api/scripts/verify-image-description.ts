/**
 * Sends a generated image to the vision model and prints what came back.
 *
 * The unit suite asserts the request shape against a stubbed fetch, which
 * proves the wiring but not the capability: whether the model actually reads
 * rendered text back verbatim is a fact about the model, and the only way to
 * learn it is to ask. Costs one flash-lite call.
 *
 *   pnpm tsx packages/api/scripts/verify-image-description.ts
 */

import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });

const { describeImage } = await import("../src/lib/image-description.js");

/** A 5x7 bitmap font, enough to render the marker legibly. */
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

const TEXT = "SMALL TOOLS";
const SCALE = 12;
const PADDING = 24;

const width = PADDING * 2 + TEXT.length * 6 * SCALE;
const height = PADDING * 2 + 7 * SCALE;

// White canvas, black glyphs, one byte per channel.
const pixels = Buffer.alloc(width * height * 3, 0xff);
for (let index = 0; index < TEXT.length; index++) {
  const glyph = GLYPHS[TEXT[index]!] ?? GLYPHS[" "]!;
  for (let row = 0; row < glyph.length; row++) {
    for (let column = 0; column < 5; column++) {
      if (glyph[row]![column] !== "1") continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const x = PADDING + index * 6 * SCALE + column * SCALE + dx;
          const y = PADDING + row * SCALE + dy;
          const offset = (y * width + x) * 3;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    }
  }
}

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

// Each scanline is prefixed with its filter byte (0 = none).
const raw = Buffer.alloc(height * (width * 3 + 1));
for (let y = 0; y < height; y++) {
  raw[y * (width * 3 + 1)] = 0;
  pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolour
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

console.log(`rendered ${width}x${height} png (${png.length} bytes) reading "${TEXT}"`);

const description = await describeImage({
  bytes: new Uint8Array(png),
  contentType: "image/png",
});

console.log("---");
console.log(description);
console.log("---");
console.log(
  description.toUpperCase().includes(TEXT)
    ? `PASS: the model transcribed "${TEXT}" verbatim`
    : `FAIL: "${TEXT}" is not present in the description`,
);
process.exit(description.toUpperCase().includes(TEXT) ? 0 : 1);
