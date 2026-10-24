import type { Config } from "../config.js";
import { LocalDiskStorage } from "./local.js";
import type { BlobStorage } from "./types.js";

export type { BlobStorage } from "./types.js";
export { transcriptKey } from "./types.js";

/** Storage for the Node/Docker entry. The Workers entry uses R2Storage directly. */
export function createStorage(config: Config): BlobStorage {
  switch (config.STORAGE_DRIVER) {
    case "local":
      return new LocalDiskStorage(config.STORAGE_LOCAL_DIR);
    case "s3":
      throw new Error("STORAGE_DRIVER=s3 is not implemented yet; use local for now.");
  }
}
