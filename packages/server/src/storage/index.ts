import type { Config } from "../config.js";
import { LocalDiskStorage } from "./local.js";

/**
 * Where full transcripts are kept. Self-hosted installs default to local disk;
 * the hosted version plugs in S3/R2 behind the same interface.
 */
export interface BlobStorage {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export function createStorage(config: Config): BlobStorage {
  switch (config.STORAGE_DRIVER) {
    case "local":
      return new LocalDiskStorage(config.STORAGE_LOCAL_DIR);
    case "s3":
      throw new Error("STORAGE_DRIVER=s3 is not implemented yet; use local for now.");
  }
}

/** Keys are namespaced by org so tenants never share a path. */
export function transcriptKey(orgId: string, sessionId: string): string {
  return `${orgId}/${sessionId}.json.gz`;
}
