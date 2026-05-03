export const AUREKAI_VERSION = "0.8.0-alpha.1";

export type AurekaiManifest = {
  schema_version: string;
  product?: string;
  release?: string;
  target?: string;
};

export function isAurekaiManifest(value: unknown): value is AurekaiManifest {
  return typeof value === "object" &&
    value !== null &&
    "schema_version" in value &&
    String((value as AurekaiManifest).schema_version).startsWith("aurekai.");
}

export function artifactUri(hash: string): string {
  return `akh:artifact:${hash}`;
}

export function featureUri(model: string, layer: number, hash: string): string {
  return `akh:feature:${model}:l${layer}:${hash}`;
}