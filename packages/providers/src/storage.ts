/**
 * Evidence storage abstraction (R2 / S3-compatible).
 *
 * All evidence writes are content-addressed: the key is derived from the SHA-256 of the
 * content so uploads are inherently idempotent. The bucket is private; read access
 * requires a presigned URL with a short TTL, generated only for break-glass moderator
 * access.
 */

import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";

export interface StorageOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export interface UploadResult {
  key: string;
  sha256: string;
  bucket: string;
}

export class EvidenceStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: StorageOptions) {
    const endpoint =
      opts.endpoint ?? `https://${opts.accountId}.r2.cloudflarestorage.com`;

    const config: S3ClientConfig = {
      region: "auto",
      endpoint,
      forcePathStyle: opts.forcePathStyle ?? false,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    };

    this.client = new S3Client(config);
    this.bucket = opts.bucket;
  }

  /**
   * Upload a piece of evidence. Key is content-addressed: `evidence/{sha256prefix}/{sha256}`.
   * Returns the key and the hex SHA-256 for the database row.
   */
  async upload(opts: {
    content: Buffer;
    contentType: string;
    reportId: string;
    caseType: "frame" | "chat_export" | "manifest";
    metadata?: Record<string, string>;
  }): Promise<UploadResult> {
    const sha256 = createHash("sha256").update(opts.content).digest("hex");
    const key = `evidence/${sha256.slice(0, 2)}/${sha256}/${opts.caseType}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: opts.content,
        ContentType: opts.contentType,
        ChecksumSHA256: sha256,
        Metadata: {
          report_id: opts.reportId,
          case_type: opts.caseType,
          ...opts.metadata,
        },
        // Server-side encryption (R2 encrypts at rest by default; S3 requires explicit SSE).
        ServerSideEncryption: "AES256",
      }),
    );

    return { key, sha256, bucket: this.bucket };
  }

  /**
   * Presign a short-lived URL for moderator download (break-glass access).
   * TTL is short: 5 minutes by default.
   */
  async presignDownload(key: string, ttlSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
