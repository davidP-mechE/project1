import "server-only";
import { env } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { StorageDriver } from "./types";

export * from "./types";

function createStorage(): StorageDriver {
  if (env.STORAGE_DRIVER === "s3") {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
    }
    return new S3Storage({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  if (env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    console.warn("[storage] Using local disk storage in production. Set STORAGE_DRIVER=s3 for real deployments.");
  }
  return new LocalStorage(env.LOCAL_STORAGE_DIR, env.APP_URL, env.BETTER_AUTH_SECRET);
}

export const storage: StorageDriver = createStorage();
