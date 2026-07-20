import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Hard cap on a COR upload — 10 MB (mirrors Sentire's server/src/storage.ts). */
export const COR_MAX_BYTES = 10 * 1024 * 1024;

/** Content types accepted for a COR file (BIR Form 2303 scan). */
export const COR_ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];

/** Hard cap on an avatar upload — 5 MB. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Content types accepted for a user avatar. */
export const AVATAR_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * COR file storage on S3-compatible object storage. Objects live at
 * `<firmId>/<clientId>` — one COR per client (a re-upload overwrites).
 *
 * Storage is **optional**: if the S3 env vars are not all set the service boots
 * disabled (no client) and the COR upload routes return a clear 503 rather than
 * crashing the app — mirroring how RedisService keeps Redis optional at boot.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>("S3_ENDPOINT");
    const bucket = config.get<string>("S3_BUCKET");
    const accessKeyId = config.get<string>("S3_ACCESS_KEY_ID");
    const secretAccessKey = config.get<string>("S3_SECRET_ACCESS_KEY");
    const region = config.get<string>("S3_REGION", "auto");

    this.bucket = bucket ?? "";
    if (endpoint && bucket && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        // S3-compatible providers (R2, MinIO, Sliplane) generally need path-style.
        forcePathStyle: true,
      });
      this.logger.log("COR object storage configured (S3-compatible).");
    } else {
      this.client = null;
      this.logger.warn(
        "COR object storage not configured — COR upload routes will return 503.",
      );
    }
  }

  /** True when the S3 env is fully configured. */
  isEnabled(): boolean {
    return this.client !== null;
  }

  /** Object key layout: `<firmId>/<clientId>`. */
  corKey(firmId: string, clientId: string): string {
    return `${firmId}/${clientId}`;
  }

  /** Object key layout for a user avatar: `avatars/<userId>`. */
  avatarKey(userId: string): string {
    return `avatars/${userId}`;
  }

  private require(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException("COR storage not configured");
    }
    return this.client;
  }

  async putCor(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const s3 = this.require();
    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** All objects under a key prefix (paginates past the 1000-object page cap). */
  async listObjects(
    prefix: string,
  ): Promise<Array<{ key: string; size: number; lastModified: string | null }>> {
    const s3 = this.require();
    const out: Array<{ key: string; size: number; lastModified: string | null }> = [];
    let continuationToken: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of page.Contents ?? []) {
        if (!obj.Key) continue;
        out.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
        });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  /** A short-lived (1 hour) presigned GET URL for an arbitrary stored object. */
  async signedGetUrl(key: string): Promise<string> {
    const s3 = this.require();
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 3600,
    });
  }

  /** A short-lived (1 hour) presigned GET URL for the stored COR. */
  async corSignedUrl(key: string): Promise<string> {
    return this.signedGetUrl(key);
  }

  async deleteCor(key: string): Promise<void> {
    const s3 = this.require();
    await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // --- Avatar objects --------------------------------------------------------

  async putAvatar(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const s3 = this.require();
    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Best-effort avatar delete — a transient failure must not block clearing the key. */
  async deleteAvatar(key: string): Promise<void> {
    const s3 = this.require();
    await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
