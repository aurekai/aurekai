// SPDX-License-Identifier: Apache-2.0
/**
 * @module
 * Aurekai SDK — TypeScript/JavaScript bridge for the Aurekai Native Runtime.
 * Published to JSR as @aurekai/sdk.
 */

// ---- Version ----

export const AUREKAI_VERSION = "0.8.0-alpha.2";
export const NATIVE_RUNTIME_VERSION = "0.8.0-alpha.2";
/** Versioned binary artifact protocol ID — stable across Aurekai releases. */
export const ABI = "bonfyre-abi-v1";

// ---- Manifest types ----

export type AurekaiManifest = {
  schema_version: string;
  product?: string;
  release?: string;
  target?: string;
  native_runtime?: NativeRuntimeRef;
};

export type NativeRuntimeRef = {
  name?: string;
  repo?: string;
  version?: string;
  revision?: string;
  abi?: string;
  operator_count?: number;
};

export function isAurekaiManifest(value: unknown): value is AurekaiManifest {
  return typeof value === "object" && value !== null &&
    "schema_version" in value &&
    String((value as AurekaiManifest).schema_version).startsWith("aurekai.");
}

// ---- Operator types ----

/** All 89 akai operator command names. */
export type OperatorCommand =
  "api" | "auth" | "brief" | "canon" | "capability" | "cli" | "clips" | "cms" | "compete" | "compress" | "control" | "detect-objects" | "discip" | "distribute" | "economy" | "embed" | "emit" | "entity" | "family" | "finance" | "flash-qla" | "flow" | "fpq" | "fpqx" | "fragment" | "frame-extract" | "gate" | "gen" | "graph" | "hash" | "index" | "ingest" | "kv-cache" | "layer" | "leapfrog" | "learn" | "ledger" | "media-prep" | "meter" | "mfa-dict" | "model" | "moq" | "narrate" | "net" | "offer" | "orchestrate" | "outreach" | "pack" | "paragraph" | "pay" | "physics" | "pipeline" | "project" | "proof" | "proxy" | "quant" | "query" | "queue" | "reason" | "recipe" | "render" | "repurpose" | "run" | "runtime" | "sae" | "scene-detect" | "segment" | "sli" | "space" | "speech-loop" | "stitch" | "surface" | "swarm" | "sync" | "tag" | "tel" | "tier" | "time" | "tone" | "transcribe" | "transcript-clean" | "transcript-family" | "vec" | "video-demux" | "violence" | "watch" | "weaviate-index" | "wire" | "workflow";

/** Operator category labels. */
export type OperatorCategory = "artifacts" | "data" | "inference" | "knowledge" | "media" | "misc" | "pipeline" | "platform" | "specialized";

export type OperatorInfo = {
  binary: string;
  command: OperatorCommand;
  category: OperatorCategory;
  description: string;
};

/** Complete operator registry indexed by akai command name. */
export const OPERATORS: Record<OperatorCommand, OperatorInfo> = Object.fromEntries([
  { binary: "BonfyreAPI", command: "api", category: "platform", description: "BonfyreAPI v2 \u2014 Async HTTP gateway for the Bonfyre binary family" },
  { binary: "BonfyreAuth", command: "auth", category: "platform", description: "BonfyreAuth \u2014 user management and session tokens" },
  { binary: "BonfyreBrief", command: "brief", category: "artifacts", description: "preserve document order */" },
  { binary: "BonfyreCanon", command: "canon", category: "data", description: "BonfyreCanon \u2014 structure-aware canonicalization via Tree-sitter" },
  { binary: "BonfyreCapability", command: "capability", category: "platform", description: "bonfyre-capability - capability discovery and matching layer" },
  { binary: "BonfyreCLI", command: "cli", category: "platform", description: "bonfyre \u2014 unified CLI dispatcher" },
  { binary: "BonfyreClips", command: "clips", category: "media", description: "BonfyreClips \u2014 Clip Discovery Engine" },
  { binary: "BonfyreCMS", command: "cms", category: "data", description: "BonfyreCMS \u2014 stripped binary CMS" },
  { binary: "BonfyreCompete", command: "compete", category: "specialized", description: "bonfyre-compete \u2014 stage/model A/B competition engine" },
  { binary: "BonfyreCompress", command: "compress", category: "data", description: "BonfyreCompress \u2014 family-aware compression engine" },
  { binary: "BonfyreControl", command: "control", category: "misc", description: "bonfyre-control \u2014 control plane for Bonfyre inference pipelines" },
  { binary: "BonfyreDetectObjects", command: "detect-objects", category: "specialized", description: "BonfyreDetectObjects \u2014 Object detection operator for V1/I1 pipelines" },
  { binary: "BonfyreDiscipl", command: "discip", category: "specialized", description: "BonfyreDiscipl operator" },
  { binary: "BonfyreDistribute", command: "distribute", category: "artifacts", description: "BonfyreDistribute operator" },
  { binary: "BonfyreEconomy", command: "economy", category: "specialized", description: "bonfyre-economy \u2014 cost-aware routing and budget enforcement" },
  { binary: "BonfyreEmbed", command: "embed", category: "inference", description: "BonfyreEmbed \u2014 text embeddings via ONNX Runtime C API" },
  { binary: "BonfyreEmit", command: "emit", category: "artifacts", description: "BonfyreEmit \u2014 multi-format output engine" },
  { binary: "BonfyreEntity", command: "entity", category: "knowledge", description: "bonfyre-entity \u2014 universal identity resolution layer" },
  { binary: "BonfyreFamily", command: "family", category: "specialized", description: "bonfyre-family - conceptual family browser for Bonfyre" },
  { binary: "BonfyreFinance", command: "finance", category: "data", description: "BonfyreFinance \u2014 service arbitrage, labor pipeline, and bundle pricing engine" },
  { binary: "BonfyreFlashQLA", command: "flash-qla", category: "inference", description: "bonfyre-flashqla \u2014 BonfyreGDN Chunked Prefill (native C kernel)" },
  { binary: "BonfyreFlow", command: "flow", category: "pipeline", description: "bonfyre-flow \u2014 coroutine-native pipeline programming" },
  { binary: "BonfyreFPQ", command: "fpq", category: "inference", description: "main.c \u2014 bonfyre-fpq CLI" },
  { binary: "BonfyreFPQx", command: "fpqx", category: "inference", description: "bonfyre-fpqx \u2014 Cross-family FPQ alignment" },
  { binary: "BonfyreFragment", command: "fragment", category: "knowledge", description: "BonfyreFragment \u2014 Fragment system CLI" },
  { binary: "BonfyreFrameExtract", command: "frame-extract", category: "media", description: "bonfyre-frame-extract" },
  { binary: "BonfyreGate", command: "gate", category: "pipeline", description: "BonfyreGate \u2014 license enforcement + access control" },
  { binary: "BonfyreGen", command: "gen", category: "data", description: "bonfyre-gen \u2014 natural language \u2192 recipe YAML generator" },
  { binary: "BonfyreGraph", command: "graph", category: "knowledge", description: "BonfyreGraph \u2014 Merkle-DAG artifact graph engine" },
  { binary: "BonfyreHash", command: "hash", category: "artifacts", description: "BonfyreHash \u2014 content-addressing + Merkle DAG hashing engine" },
  { binary: "BonfyreIndex", command: "index", category: "knowledge", description: "BonfyreIndex \u2014 artifact family indexer and search engine" },
  { binary: "BonfyreIngest", command: "ingest", category: "artifacts", description: "BonfyreIngest \u2014 universal intake binary" },
  { binary: "BonfyreKVCache", command: "kv-cache", category: "knowledge", description: "bonfyre-kvcache \u2014 v8 RLF KV cache compression" },
  { binary: "BonfyreLayer", command: "layer", category: "knowledge", description: "bonfyre-layer \u2014 Layer-aware ONNX model inspection and extraction (C port)" },
  { binary: "BonfyreLeapfrog", command: "leapfrog", category: "inference", description: "bonfyre-leapfrog \u2014 Hamiltonian conservation and reversibility test" },
  { binary: "BonfyreLearn", command: "learn", category: "inference", description: "bonfyre-learn \u2014 artifact-level feedback and threshold tuning" },
  { binary: "BonfyreLedger", command: "ledger", category: "artifacts", description: "BonfyreLedger \u2014 value accounting engine" },
  { binary: "BonfyreMediaPrep", command: "media-prep", category: "media", description: "BonfyreMediaPrep operator" },
  { binary: "BonfyreMeter", command: "meter", category: "platform", description: "BonfyreMeter \u2014 usage metering + billing events" },
  { binary: "BonfyreMFADict", command: "mfa-dict", category: "specialized", description: "BonfyreMFADict operator" },
  { binary: "BonfyreModel", command: "model", category: "inference", description: "BonfyreModel \u2014 model dependency manager for bonfyre pipelines" },
  { binary: "BonfyreMoQ", command: "moq", category: "specialized", description: "bonfyre-moq \u2014 Media over QUIC style relay for Bonfyre" },
  { binary: "BonfyreNarrate", command: "narrate", category: "media", description: "BonfyreNarrate v3 \u2014 Verified Tone-Aware Text-to-Speech Synthesis" },
  { binary: "BonfyreNet", command: "net", category: "platform", description: "bonfyre-net \u2014 Bonfyre Netlist Runtime" },
  { binary: "BonfyreOffer", command: "offer", category: "artifacts", description: "Also try to read proof-summary.json from" },
  { binary: "BonfyreOrchestrate", command: "orchestrate", category: "pipeline", description: "BonfyreOrchestrate operator" },
  { binary: "BonfyreOutreach", command: "outreach", category: "data", description: "BonfyreOutreach \u2014 quiet distribution engine" },
  { binary: "BonfyrePack", command: "pack", category: "artifacts", description: "BonfyrePack operator" },
  { binary: "BonfyreParagraph", command: "paragraph", category: "knowledge", description: "BonfyreParagraph operator" },
  { binary: "BonfyrePay", command: "pay", category: "data", description: "BonfyrePay \u2014 payment & invoice management" },
  { binary: "BonfyrePhysics", command: "physics", category: "inference", description: "bonfyre-physics \u2014 Hamiltonian Version Control Protocol (HVCP) CLI" },
  { binary: "BonfyrePipeline", command: "pipeline", category: "pipeline", description: "BonfyrePipeline \u2014 unified single-process pipeline" },
  { binary: "BonfyreProject", command: "project", category: "data", description: "BonfyreProject operator" },
  { binary: "BonfyreProof", command: "proof", category: "artifacts", description: "BonfyreProof operator" },
  { binary: "BonfyreProxy", command: "proxy", category: "platform", description: "BonfyreProxy \u2014 OpenAI-compatible API shim for Bonfyre binaries" },
  { binary: "BonfyreQuant", command: "quant", category: "data", description: "bonfyre-quant \u2014 FPQ v8 Recursive Lattice-Flow weight quantization" },
  { binary: "BonfyreQuery", command: "query", category: "knowledge", description: "BonfyreQuery \u2014 local analytics engine over artifacts via DuckDB" },
  { binary: "BonfyreQueue", command: "queue", category: "pipeline", description: "BonfyreQueue v2 \u2014 SQLite-backed job queue with built-in worker daemon" },
  { binary: "BonfyreReason", command: "reason", category: "specialized", description: "bonfyre-reason \u2014 Reason-state operator over the HVCP stack" },
  { binary: "BonfyreRecipe", command: "recipe", category: "pipeline", description: "BonfyreRecipe \u2014 Recipe Registry Management" },
  { binary: "BonfyreRender", command: "render", category: "artifacts", description: "BonfyreRender operator" },
  { binary: "BonfyreRepurpose", command: "repurpose", category: "media", description: "BonfyreRepurpose \u2014 Transform brief artifacts into social media formats" },
  { binary: "BonfyreRun", command: "run", category: "pipeline", description: "BonfyreRun \u2014 Recipe Executor" },
  { binary: "BonfyreRuntime", command: "runtime", category: "platform", description: "Try top-level sibling path: ../SiblingDir/binary */" },
  { binary: "BonfyreSAE", command: "sae", category: "inference", description: "bonfyre-sae \u2014 SAE feature dictionary runtime" },
  { binary: "BonfyreSceneDetect", command: "scene-detect", category: "media", description: "bonfyre-scene-detect" },
  { binary: "BonfyreSegment", command: "segment", category: "specialized", description: "BonfyreSegment \u2014 Idea Boundary Detection + Segment Graph" },
  { binary: "BonfyreSLI", command: "sli", category: "inference", description: "bonfyre-sli \u2014 Structured Layer Inference" },
  { binary: "BonfyreSpace", command: "space", category: "knowledge", description: "bonfyre-space \u2014 shared memory substrate" },
  { binary: "BonfyreSpeechLoop", command: "speech-loop", category: "media", description: "BonfyreSpeechLoop \u2014 Whisper \u2192 Transform \u2192 Piper speech transformation" },
  { binary: "BonfyreStitch", command: "stitch", category: "media", description: "BonfyreStitch \u2014 DAG materializer" },
  { binary: "BonfyreSurface", command: "surface", category: "specialized", description: "BonfyreSurface operator" },
  { binary: "BonfyreSwarm", command: "swarm", category: "pipeline", description: "BonfyreSwarm \u2014 P2P artifact distribution via BitTorrent v2 protocol" },
  { binary: "BonfyreSync", command: "sync", category: "artifacts", description: "BonfyreSync operator" },
  { binary: "BonfyreTag", command: "tag", category: "knowledge", description: "BonfyreTag \u2014 instant intent/topic tagging via fastText (pure C)" },
  { binary: "BonfyreTel", command: "tel", category: "platform", description: "BonfyreTel \u2014 FreeSWITCH Event Socket telephony adapter" },
  { binary: "BonfyreTier", command: "tier", category: "data", description: "bonfyre-tier \u2014 latency tier management and SLA enforcement" },
  { binary: "BonfyreTime", command: "time", category: "data", description: "bonfyre-time \u2014 temporal pipeline manager" },
  { binary: "BonfyreTone", command: "tone", category: "media", description: "BonfyreTone \u2014 speech tone/emotion/rhythm extraction via OpenSMILE" },
  { binary: "BonfyreTranscribe", command: "transcribe", category: "media", description: "================================================================" },
  { binary: "BonfyreTranscriptClean", command: "transcript-clean", category: "specialized", description: "BonfyreTranscriptClean operator" },
  { binary: "BonfyreTranscriptFamily", command: "transcript-family", category: "specialized", description: "BonfyreTranscriptFamily operator" },
  { binary: "BonfyreVec", command: "vec", category: "knowledge", description: "BonfyreVec \u2014 local vector search via sqlite-vec" },
  { binary: "BonfyreVideoDemux", command: "video-demux", category: "media", description: "bonfyre-video-demux" },
  { binary: "BonfyreViolence", command: "violence", category: "specialized", description: "bonfyre-violence \u2014 real coupling test harness" },
  { binary: "BonfyreWatch", command: "watch", category: "platform", description: "BonfyreWatch operator" },
  { binary: "BonfyreWeaviateIndex", command: "weaviate-index", category: "specialized", description: "BonfyreWeaviateIndex operator" },
  { binary: "BonfyreWire", command: "wire", category: "platform", description: "BonfyreWire operator" },
  { binary: "BonfyreWorkflow", command: "workflow", category: "pipeline", description: "bonfyre-workflow - workflow profile browser" },
].map((op) => [op.command, op])) as Record<OperatorCommand, OperatorInfo>;

/** List all operators, optionally filtered by category. */
export function listOperators(category?: OperatorCategory): OperatorInfo[] {
  const all = Object.values(OPERATORS);
  return category ? all.filter((op) => op.category === category) : all;
}

// ---- Artifact format types ----

/** Legacy Bonfyre artifact file extensions. */
export type BonfyreExt = ".bf" | ".bfa" | ".bfq" | ".bfqx" | ".bfmodel" | ".bfsae" | ".bfgraph" | ".bftag" | ".bftone" | ".bfvec" | ".bfrecipe" | ".bfproof";

/** Aurekai-native artifact file extensions (migration target for v1.0+). */
export type AurekaiExt = ".ak" | ".aka" | ".akq" | ".akqx" | ".akmodel" | ".aksae" | ".akgraph" | ".aktag" | ".aktone" | ".akvec" | ".akrecipe" | ".akproof";

export type FormatBridgeEntry = {
  bonfyreExt: BonfyreExt;
  aurekaiExt: AurekaiExt;
  description: string;
};

/** All 12 format bridge mappings (.bf* → .ak*). */
export const FORMAT_BRIDGE: FormatBridgeEntry[] = [
  { bonfyreExt: ".bf", aurekaiExt: ".ak", description: "General-purpose packed artifact bundle" },
  { bonfyreExt: ".bfa", aurekaiExt: ".aka", description: "Artifact archive (multi-item packed bundle)" },
  { bonfyreExt: ".bfq", aurekaiExt: ".akq", description: "FPQ quantization artifact (T-family transform snapshot)" },
  { bonfyreExt: ".bfqx", aurekaiExt: ".akqx", description: "FPQx cross-family alignment artifact" },
  { bonfyreExt: ".bfmodel", aurekaiExt: ".akmodel", description: "Embedded model snapshot (ONNX weights + metadata)" },
  { bonfyreExt: ".bfsae", aurekaiExt: ".aksae", description: "SAE feature dictionary (sparse autoencoder activation map)" },
  { bonfyreExt: ".bfgraph", aurekaiExt: ".akgraph", description: "Graph artifact (entity/relation store)" },
  { bonfyreExt: ".bftag", aurekaiExt: ".aktag", description: "Tag artifact (language classification output)" },
  { bonfyreExt: ".bftone", aurekaiExt: ".aktone", description: "Tone artifact (eGeMAPS feature vector)" },
  { bonfyreExt: ".bfvec", aurekaiExt: ".akvec", description: "Dense vector store snapshot" },
  { bonfyreExt: ".bfrecipe", aurekaiExt: ".akrecipe", description: "Pipeline recipe definition (DAG of operator steps)" },
  { bonfyreExt: ".bfproof", aurekaiExt: ".akproof", description: "Proof bundle (signed artifact + metrics attestation)" },
];

export function bonfyreToAurekaiExt(ext: BonfyreExt): AurekaiExt | undefined {
  return FORMAT_BRIDGE.find((e) => e.bonfyreExt === ext)?.aurekaiExt;
}

export function aurekaiToBonfyreExt(ext: AurekaiExt): BonfyreExt | undefined {
  return FORMAT_BRIDGE.find((e) => e.aurekaiExt === ext)?.bonfyreExt;
}

// ---- URI helpers ----

export function artifactUri(hash: string): string {
  return `akh:artifact:${hash}`;
}

export function featureUri(model: string, layer: number, hash: string): string {
  return `akh:feature:${model}:l${layer}:${hash}`;
}

export function operatorUri(command: OperatorCommand): string {
  return `akh:operator:${command}`;
}
