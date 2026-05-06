/**
 * Aurekai file-to-buffer mapping pool.
 *
 * Files are loaded into a single Buffer on first access using one read(2) call.
 * All subsequent reads return Buffer.subarray() views — genuinely zero-copy because
 * subarray() shares the underlying ArrayBuffer without allocating new memory.
 *
 * On macOS/Linux the Buffer is populated from the OS page cache via a single read
 * sequence; subsequent slices never touch the kernel.  Pool entries remain live until
 * explicitly evicted so GC cannot reclaim the backing ArrayBuffer while slices exist.
 */

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @typedef {{ buf: Buffer, mapped_at: number, hit_count: number, slice_count: number, size_bytes: number }} PoolEntry
 * @type {Map<string, PoolEntry>}
 */
const _pool = new Map();

/**
 * Map a file into the pool (or return the existing mapping).
 * One read(2) syscall sequence per unique file; zero copies on cache hit.
 * @param {string} filePath
 * @returns {Buffer}
 */
export function mapFile(filePath) {
  const p = resolve(filePath);
  const existing = _pool.get(p);
  if (existing) {
    existing.hit_count += 1;
    return existing.buf;
  }

  const fd = openSync(p, "r");
  const { size } = fstatSync(fd);
  // Allocate without zeroing — we will overwrite every byte.
  const buf = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const n = readSync(fd, buf, offset, size - offset, offset);
    if (n === 0) break;
    offset += n;
  }
  closeSync(fd);

  _pool.set(p, { buf, mapped_at: Date.now(), hit_count: 0, slice_count: 0, size_bytes: size });
  return buf;
}

/**
 * Return a zero-copy subarray view of a region in the mapped file.
 * Buffer.subarray() shares the underlying ArrayBuffer — no allocation, no copy.
 * @param {string} filePath
 * @param {number} start  byte offset into the file
 * @param {number} length byte length of the slice
 * @returns {Buffer}
 */
export function sliceFile(filePath, start, length) {
  const p = resolve(filePath);
  const buf = mapFile(p);
  const entry = _pool.get(p);
  entry.slice_count += 1;
  return buf.subarray(start, start + length);
}

/**
 * Return true if filePath is currently held in the pool.
 * @param {string} filePath
 */
export function isMapped(filePath) {
  return _pool.has(resolve(filePath));
}

/**
 * Evict a single file from the pool, allowing GC to reclaim the backing buffer
 * once all existing subarray references are dropped.
 * @param {string} filePath
 */
export function evict(filePath) {
  _pool.delete(resolve(filePath));
}

/** Evict all entries. */
export function evictAll() {
  _pool.clear();
}

/**
 * Return pool-wide statistics for introspection and benchmark gates.
 */
export function mmapStats() {
  let total_mapped_bytes = 0;
  let total_slice_count = 0;
  let total_hit_count = 0;
  const mappings = [];

  for (const [p, entry] of _pool.entries()) {
    total_mapped_bytes += entry.size_bytes;
    total_slice_count += entry.slice_count;
    total_hit_count += entry.hit_count;
    mappings.push({
      path: p,
      size_bytes: entry.size_bytes,
      mapped_at: new Date(entry.mapped_at).toISOString(),
      hit_count: entry.hit_count,
      slice_count: entry.slice_count,
    });
  }

  return {
    mapped_file_count: _pool.size,
    total_mapped_bytes,
    total_slice_count,
    total_hit_count,
    mappings,
  };
}
