/**
 * S3Vault — VaultStore backed by an S3 bucket prefix.
 *
 * The production vault: Lambda has no durable filesystem, so "file" means
 * "S3 object". The store is constructed with an injected S3Client so the
 * caller decides credentials/region (and tests can pass a stub).
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  assertVaultPath,
  assertVaultPrefix,
  contentHash,
  type VaultPutResult,
  type VaultStore,
} from "./vault.js";

export interface S3VaultOptions {
  client: S3Client;
  bucket: string;
  /**
   * Key prefix the vault lives under, e.g. "vault/". Defaults to "vault/".
   * A trailing slash is appended when missing so vault paths concatenate
   * cleanly.
   */
  prefix?: string;
}

/**
 * Build an S3Vault using the ambient AWS credential chain. Exists so callers
 * outside this package (e.g. the export CLI under tools/) don't need their
 * own dependency on @aws-sdk/client-s3 just to construct a client.
 */
export function createS3Vault(options: {
  bucket: string;
  prefix?: string;
  region?: string;
}): S3Vault {
  return new S3Vault({
    client: new S3Client(options.region ? { region: options.region } : {}),
    ...options,
  });
}

export class S3Vault implements VaultStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3VaultOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    const prefix = options.prefix ?? "vault/";
    this.prefix = prefix === "" || prefix.endsWith("/") ? prefix : `${prefix}/`;
  }

  async put(path: string, content: string): Promise<VaultPutResult> {
    assertVaultPath(path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + path,
        Body: content,
        ContentType: "application/yaml; charset=utf-8",
      }),
    );
    return { contentHash: contentHash(content) };
  }

  async get(path: string): Promise<string | null> {
    assertVaultPath(path);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.prefix + path }),
      );
      return (await response.Body?.transformToString("utf-8")) ?? null;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw error;
    }
  }

  async delete(path: string): Promise<void> {
    assertVaultPath(path);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.prefix + path }),
    );
  }

  async *list(prefix: string): AsyncIterable<string> {
    assertVaultPrefix(prefix);
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix + prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key) yield object.Key.slice(this.prefix.length);
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }
}
