import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { blake3 } from "@napi-rs/blake-hash";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NATIVE_CHUNK_BIN = join(__dirname, "..", "native", "bin", "akai-chunk");

/**
 * Chunk a file using the native C operator (akai-chunk) if available.
 * Falls back to JS implementation otherwise.
 *
 * @param {string} filePath - Absolute path to file on disk.
 * @param {object} [opts]   - { targetSize, minSize, maxSize }
 * @returns {{ chunks: Array<{index,offset,length,sha256}>, native: boolean }}
 */
export function chunkFileFast(filePath, opts = {}) {
  const nativeAvailable = existsSync(NATIVE_CHUNK_BIN);
  if (nativeAvailable) {
    const args = [filePath];
    if (opts.minSize)    args.push("--min",    String(opts.minSize));
    if (opts.targetSize) args.push("--target", String(opts.targetSize));
    if (opts.maxSize)    args.push("--max",    String(opts.maxSize));
    const result = spawnSync(NATIVE_CHUNK_BIN, args.slice(1), {
      input: undefined,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status === 0 && result.stdout) {
      const doc = JSON.parse(result.stdout);
      return {
        chunks: doc.chunks.map(c => ({
          index: c.index,
          offset: c.offset,
          length: c.length,
          sha256: c.sha256,
          // blake3 not available from native binary — will be set by caller if needed
          blake3: null,
        })),
        native: true,
        size_bytes: doc.size_bytes,
      };
    }
    // fall through to JS on failure
  }
  return null; // caller falls back to chunkBufferCdc
}

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
