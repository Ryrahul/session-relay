/**
 * Where full transcripts are kept: local disk (Docker), R2 (Cloudflare), S3 later.
 * Keys are namespaced by org so tenants never share a path.
 */
export interface BlobStorage {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export function transcriptKey(orgId: string, sessionId: string): string {
  return `${orgId}/${sessionId}.json.gz`;
}

export function diffKey(orgId: string, sessionId: string): string {
  return `${orgId}/${sessionId}.diff.gz`;
}
