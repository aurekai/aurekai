import { createHash } from "node:crypto";
import { blake3 } from "@napi-rs/blake-hash";

const CDC_DEFAULTS = {
  targetSize: 1024 * 1024,
  minSize: 256 * 1024,
  maxSize: 4 * 1024 * 1024,
  maskBits: 20,
};

function createGearTable() {
  const table = new Uint32Array(256);
  let seed = 0x9e3779b9;
  for (let i = 0; i < 256; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    table[i] = seed;
  }
  return table;
}

const GEAR_TABLE = createGearTable();

export function hashBytes(buffer) {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const blake3Hex = blake3(buffer).toString("hex");
  return {
    sha256: `sha256:${sha256}`,
    blake3: `blake3:${blake3Hex}`,
  };
}

export function hashStringsToBlake3(values) {
  const digest = blake3(Buffer.from(values.join("\n"), "utf8")).toString("hex");
  return `blake3:${digest}`;
}

export function chunkBufferCdc(buffer, opts = {}) {
  const targetSize = opts.targetSize || CDC_DEFAULTS.targetSize;
  const minSize = opts.minSize || CDC_DEFAULTS.minSize;
  const maxSize = opts.maxSize || CDC_DEFAULTS.maxSize;
  const maskBits = opts.maskBits || CDC_DEFAULTS.maskBits;
  const mask = 2 ** maskBits - 1;

  const chunks = [];
  let start = 0;
  let rolling = 0;

  for (let i = 0; i < buffer.length; i++) {
    rolling = ((rolling << 1) + GEAR_TABLE[buffer[i]]) >>> 0;
    const size = i - start + 1;
    const shouldCut = size >= minSize && ((rolling & mask) === 0 || size >= targetSize);
    const mustCut = size >= maxSize;

    if (shouldCut || mustCut) {
      chunks.push({ offset: start, length: size, buffer: buffer.subarray(start, i + 1) });
      start = i + 1;
      rolling = 0;
    }
  }

  if (start < buffer.length) {
    chunks.push({ offset: start, length: buffer.length - start, buffer: buffer.subarray(start) });
  }

  if (chunks.length === 0) {
    chunks.push({ offset: 0, length: 0, buffer: Buffer.alloc(0) });
  }

  return chunks.map((chunk, index) => ({
    index,
    offset: chunk.offset,
    length: chunk.length,
    hashes: hashBytes(chunk.buffer),
    buffer: chunk.buffer,
  }));
}
