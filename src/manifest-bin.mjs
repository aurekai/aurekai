const MANIFEST_MAGIC = Buffer.from("AKMBIN01", "ascii");
const HEADER_BYTES = 24;
const CHUNK_ENTRY_BYTES = 48;
const REGION_ENTRY_BYTES = 20;

function writeU32LE(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function writeU64LE(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value), 0);
  return out;
}

function hexToBytes(hex) {
  return Buffer.from(String(hex || "").replace(/[^a-f0-9]/gi, ""), "hex");
}

function bytesToHex(buf) {
  return Buffer.from(buf).toString("hex");
}

export function compileManifestBinary(metadata) {
  const strings = [];
  const stringOffsets = new Map();
  let stringCursor = 0;

  for (const region of metadata.regions) {
    const name = region.name;
    if (!stringOffsets.has(name)) {
      stringOffsets.set(name, stringCursor);
      const len = Buffer.byteLength(name, "utf8") + 1;
      stringCursor += len;
      strings.push(name);
    }
  }

  const stringTable = Buffer.concat(
    strings.map(str => Buffer.concat([Buffer.from(str, "utf8"), Buffer.from([0])])),
  );
  const header = Buffer.concat([
    MANIFEST_MAGIC,
    writeU32LE(metadata.regions.length),
    writeU32LE(metadata.chunks.length),
    writeU32LE(stringTable.length),
    writeU32LE(1),
  ]);

  const chunkEntries = Buffer.concat(metadata.chunks.map(chunk => Buffer.concat([
    hexToBytes(String(chunk.blake3 || "").replace("blake3:", "")),
    writeU64LE(chunk.pack_offset_bytes),
    writeU32LE(chunk.size_bytes),
    writeU32LE(chunk.logical_ref_count || 1),
  ])));

  const regionEntries = Buffer.concat(metadata.regions.map(region => Buffer.concat([
    writeU32LE(stringOffsets.get(region.name) || 0),
    writeU32LE(region.first_chunk_index),
    writeU32LE(region.chunk_count),
    writeU64LE(region.logical_size_bytes),
  ])));

  return Buffer.concat([header, chunkEntries, regionEntries, stringTable]);
}

export function parseManifestBinary(buffer) {
  const magic = buffer.subarray(0, MANIFEST_MAGIC.length);
  if (!magic.equals(MANIFEST_MAGIC)) {
    throw new Error("invalid binary manifest magic");
  }

  const regionCount = buffer.readUInt32LE(8);
  const chunkCount = buffer.readUInt32LE(12);
  const stringBytes = buffer.readUInt32LE(16);
  const version = buffer.readUInt32LE(20);

  const chunks = [];
  let offset = HEADER_BYTES;
  for (let i = 0; i < chunkCount; i++) {
    const hash = bytesToHex(buffer.subarray(offset, offset + 32));
    const packOffset = Number(buffer.readBigUInt64LE(offset + 32));
    const sizeBytes = buffer.readUInt32LE(offset + 40);
    const logicalRefCount = buffer.readUInt32LE(offset + 44);
    chunks.push({ blake3: `blake3:${hash}`, pack_offset_bytes: packOffset, size_bytes: sizeBytes, logical_ref_count: logicalRefCount });
    offset += CHUNK_ENTRY_BYTES;
  }

  const rawRegions = [];
  for (let i = 0; i < regionCount; i++) {
    rawRegions.push({
      name_offset: buffer.readUInt32LE(offset),
      first_chunk_index: buffer.readUInt32LE(offset + 4),
      chunk_count: buffer.readUInt32LE(offset + 8),
      logical_size_bytes: Number(buffer.readBigUInt64LE(offset + 12)),
    });
    offset += REGION_ENTRY_BYTES;
  }

  const stringTable = buffer.subarray(offset, offset + stringBytes);
  const decodeString = start => {
    let end = start;
    while (end < stringTable.length && stringTable[end] !== 0) end += 1;
    return stringTable.subarray(start, end).toString("utf8");
  };

  const regions = rawRegions.map(region => ({
    name: decodeString(region.name_offset),
    first_chunk_index: region.first_chunk_index,
    chunk_count: region.chunk_count,
    logical_size_bytes: region.logical_size_bytes,
  }));

  return {
    schema_version: "aurekai.manifest.bin.v1",
    version,
    region_count: regionCount,
    chunk_count: chunkCount,
    string_bytes: stringBytes,
    chunks,
    regions,
  };
}
