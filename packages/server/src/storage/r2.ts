import type { BlobStorage } from "./types.js";

/** Minimal shape of a Workers R2 bucket binding, so this file needs no Workers types. */
export interface R2Like {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

export class R2Storage implements BlobStorage {
  constructor(private readonly bucket: R2Like) {}

  async put(key: string, body: Uint8Array): Promise<void> {
    await this.bucket.put(key, body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
