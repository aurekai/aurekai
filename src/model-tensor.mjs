/**
 * model-tensor.mjs
 *
 * Real tensor metadata + sampling utilities.
 * No synthetic fallback paths: callers should fail if parsing cannot proceed.
 */

import { openSync, readSync, closeSync, statSync } from "node:fs";

const DTYPE_BYTES = {
  F16: 2,
  BF16: 2,
  F32: 4,
  F64: 8,
  I8: 1,
  U8: 1,
  I16: 2,
  U16: 2,
  I32: 4,
  U32: 4,
  I64: 8,
  U64: 8,
  BOOL: 1,
};

export function classifyTensorKind(name = "") {
  const n = name.toLowerCase();
  if (/q_proj|k_proj|v_proj|o_proj|attn|self_attn|query|key|value|attention/.test(n)) {
    if (/cross|enc_dec/.test(n)) return "cross_attention";
    return "self_attention";
  }
  if (/mlp|ffn|fc[12]|gate_proj|up_proj|down_proj|dense/.test(n)) return "ffn";
  if (/embed|_emb|emb_|tok_emb|wte|wpe|position_embedding|lm_head/.test(n)) return "embedding";
  if (/norm|ln_|layernorm|rmsnorm/.test(n)) return "norm";
  if (/kv_cache|kvcache|past_key|past_value/.test(n)) return "kv_cache";
  return "layer";
}

function product(shape = []) {
  if (!Array.isArray(shape) || shape.length === 0) return 0;
  return shape.reduce((a, b) => a * Number(b || 0), 1);
}

function bytesPerDtype(dtype) {
  const v = DTYPE_BYTES[dtype];
  if (!v) throw new Error(`Unsupported dtype '${dtype}'`);
  return v;
}

export function parseSafeTensors(path) {
  const st = statSync(path);
  if (st.size < 16) throw new Error("File too small to be safetensors");

  const fd = openSync(path, "r");
  try {
    const lenBuf = Buffer.alloc(8);
    readSync(fd, lenBuf, 0, 8, 0);
    const headerLen = Number(lenBuf.readBigUInt64LE(0));
    if (!Number.isFinite(headerLen) || headerLen <= 0 || headerLen > st.size - 8) {
      throw new Error("Invalid safetensors header length");
    }

    const headerBuf = Buffer.alloc(headerLen);
    readSync(fd, headerBuf, 0, headerLen, 8);
    const headerText = headerBuf.toString("utf8");
    const header = JSON.parse(headerText);

    const tensors = [];
    for (const [name, meta] of Object.entries(header)) {
      if (name === "__metadata__") continue;
      if (!meta || typeof meta !== "object") continue;
      const { dtype, shape, data_offsets } = meta;
      if (!dtype || !Array.isArray(shape) || !Array.isArray(data_offsets) || data_offsets.length !== 2) {
        continue;
      }

      const start = Number(data_offsets[0]);
      const end = Number(data_offsets[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error(`Invalid offsets for tensor '${name}'`);
      }

      const tensorBytes = end - start;
      const elements = product(shape);
      const bpe = bytesPerDtype(dtype);
      if (elements <= 0) throw new Error(`Invalid shape for tensor '${name}'`);

      tensors.push({
        name,
        dtype,
        shape,
        elements,
        bytes: tensorBytes,
        fileOffsetStart: 8 + headerLen + start,
        fileOffsetEnd: 8 + headerLen + end,
        bytesPerElement: bpe,
        kind: classifyTensorKind(name),
      });
    }

    if (tensors.length === 0) throw new Error("No tensors found in safetensors header");

    return {
      format: "safetensors",
      fileSize: st.size,
      headerLen,
      tensorCount: tensors.length,
      tensors,
    };
  } finally {
    closeSync(fd);
  }
}

function f16ToF32(u16) {
  const s = (u16 & 0x8000) >> 15;
  const e = (u16 & 0x7c00) >> 10;
  const f = u16 & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function bf16ToF32(u16) {
  const buf = Buffer.alloc(4);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(u16, 2);
  return buf.readFloatLE(0);
}

export function sampleTensor(path, tensorMeta, maxSamples = 4096) {
  const fd = openSync(path, "r");
  try {
    const byteLen = tensorMeta.fileOffsetEnd - tensorMeta.fileOffsetStart;
    if (byteLen < tensorMeta.bytesPerElement) throw new Error(`Tensor '${tensorMeta.name}' has no data`);

    const samples = [];
    const strideElems = Math.max(1, Math.floor(tensorMeta.elements / maxSamples));

    for (let i = 0; i < tensorMeta.elements && samples.length < maxSamples; i += strideElems) {
      const pos = tensorMeta.fileOffsetStart + i * tensorMeta.bytesPerElement;
      let v;
      if (tensorMeta.dtype === "F32") {
        const b = Buffer.alloc(4);
        readSync(fd, b, 0, 4, pos);
        v = b.readFloatLE(0);
      } else if (tensorMeta.dtype === "F16") {
        const b = Buffer.alloc(2);
        readSync(fd, b, 0, 2, pos);
        v = f16ToF32(b.readUInt16LE(0));
      } else if (tensorMeta.dtype === "BF16") {
        const b = Buffer.alloc(2);
        readSync(fd, b, 0, 2, pos);
        v = bf16ToF32(b.readUInt16LE(0));
      } else {
        // For non-float tensors, read as signed integer scaled to [-1,1]
        const b = Buffer.alloc(tensorMeta.bytesPerElement);
        readSync(fd, b, 0, tensorMeta.bytesPerElement, pos);
        if (tensorMeta.bytesPerElement === 1) {
          v = (b.readInt8(0) / 127);
        } else if (tensorMeta.bytesPerElement === 2) {
          v = (b.readInt16LE(0) / 32767);
        } else if (tensorMeta.bytesPerElement === 4) {
          v = (b.readInt32LE(0) / 2147483647);
        } else {
          continue;
        }
      }
      if (Number.isFinite(v)) samples.push(v);
    }

    if (samples.length < 64) throw new Error(`Insufficient numeric samples for tensor '${tensorMeta.name}'`);

    return samples;
  } finally {
    closeSync(fd);
  }
}

export function vectorStats(values) {
  const n = values.length;
  if (!n) throw new Error("No values to analyze");

  let sum = 0;
  let sumSq = 0;
  let sumAbs = 0;
  let maxAbs = 0;
  let zeroCount = 0;
  for (const v of values) {
    sum += v;
    sumSq += v * v;
    const av = Math.abs(v);
    sumAbs += av;
    if (av > maxAbs) maxAbs = av;
    if (av < 1e-8) zeroCount++;
  }

  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const stddev = Math.sqrt(variance);

  const sortedAbs = values.map(v => Math.abs(v)).sort((a, b) => a - b);
  const p50 = sortedAbs[Math.floor(0.5 * (n - 1))];
  const p95 = sortedAbs[Math.floor(0.95 * (n - 1))];

  return {
    n,
    mean,
    stddev,
    l2: Math.sqrt(sumSq),
    meanAbs: sumAbs / n,
    maxAbs,
    zeroFrac: zeroCount / n,
    p50Abs: p50,
    p95Abs: p95,
  };
}
