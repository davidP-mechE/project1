import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  NotFound,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSafeKey, type StorageDriver, type UploadTarget } from "./types";

export type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** AWS S3 or any S3-compatible service (Cloudflare R2, MinIO). */
export class S3Storage implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3Config) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: Boolean(cfg.endpoint),
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async createUploadUrl(
    key: string,
    opts: { contentType: string; contentLength: number; expiresInSeconds: number },
  ): Promise<UploadTarget> {
    assertSafeKey(key);
    // ContentLength is part of the signature, so the browser can't upload a bigger file.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: opts.expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return { url, method: "PUT", headers: { "Content-Type": opts.contentType } };
  }

  async createDownloadUrl(key: string, opts: { expiresInSeconds: number; contentType?: string }) {
    assertSafeKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: opts.contentType }),
      { expiresIn: opts.expiresInSeconds },
    );
  }

  async head(key: string) {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? 0) };
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async readRange(key: string, start: number, end: number) {
    assertSafeKey(key);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async getBuffer(key: string) {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string) {
    assertSafeKey(prefix.replace(/\/$/, ""));
    let token: string | undefined;
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (objects.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }));
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}
