import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  type ObjectIdentifier,
  type S3Client,
} from '@aws-sdk/client-s3';

type Store = Pick<S3Client, 'send'>;
const PAGE_SIZE = 1000;
const MAX_PAGES = 4;
const CONCURRENCY = 8;
type Version = { Key: string; VersionId: string; latest: boolean };

async function listExactVersions(client: Store, bucket: string, key: string, signal: AbortSignal): Promise<Version[]> {
  const versions = new Map<string, Version>();
  const seenCursors = new Set<string>();
  let cursor: { KeyMarker: string; VersionIdMarker: string } | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await client.send(new ListObjectVersionsCommand({
      Bucket: bucket, Prefix: key, MaxKeys: PAGE_SIZE, ...cursor,
    }), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    for (const row of [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])]) {
      if (!row.Key?.startsWith(key)) throw new Error('Invalid attachment version listing');
      if (row.Key !== key) continue;
      const id = row.VersionId;
      if (!id || typeof row.IsLatest !== 'boolean' || versions.has(id)) {
        throw new Error('Invalid attachment version listing');
      }
      versions.set(id, { Key: key, VersionId: id, latest: row.IsLatest });
    }
    if (result.IsTruncated === false) return [...versions.values()];
    const nextKey = result.NextKeyMarker, nextVersion = result.NextVersionIdMarker;
    if (result.IsTruncated !== true || !nextKey?.startsWith(key) || !nextVersion) {
      throw new Error('Incomplete attachment version listing');
    }
    const pair = JSON.stringify([nextKey, nextVersion]);
    if (seenCursors.has(pair)) throw new Error('Repeated attachment version cursor');
    seenCursors.add(pair);
    cursor = { KeyMarker: nextKey, VersionIdMarker: nextVersion };
  }
  throw new Error('Attachment version listing exceeded its limit');
}

async function deleteVersions(client: Store, bucket: string, records: Version[], signal: AbortSignal) {
  for (let start = 0; start < records.length; start += PAGE_SIZE) {
    const Objects: ObjectIdentifier[] = records.slice(start, start + PAGE_SIZE)
      .map(({ Key, VersionId }) => ({ Key, VersionId }));
    const response = await client.send(new DeleteObjectsCommand({
      Bucket: bucket, Delete: { Objects, Quiet: true },
    }), { abortSignal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    if (response.Errors?.length) throw new Error('Attachment version deletion failed');
  }
}

async function purgeKey(client: Store, bucket: string, key: string, signal: AbortSignal) {
  const versions = await listExactVersions(client, bucket, key, signal);
  if (!versions.length) return;
  const latest = versions.filter(version => version.latest);
  if (latest.length !== 1) throw new Error('Attachment versions changed while listing');
  // Keep the current object or marker in place until all older data is gone.
  // Dropping it early could expose a previous version through a normal GET.
  await deleteVersions(client, bucket, versions.filter(version => !version.latest), signal);
  await deleteVersions(client, bucket, latest, signal);
  if ((await listExactVersions(client, bucket, key, signal)).length) {
    throw new Error('Attachment versions remain after deletion');
  }
}

/** Delete version IDs, including the literal null version and delete markers.
 * Caller owns the durable key inventory and retry policy. No key-only fallback. */
export async function purgeAttachmentVersions(client: Store, bucket: string, keys: string[]): Promise<string[]> {
  const signal = AbortSignal.timeout(20_000);
  const failed: string[] = [];
  for (let start = 0; start < keys.length; start += CONCURRENCY) {
    if (signal.aborted) return [...failed, ...keys.slice(start)];
    const results = await Promise.all(keys.slice(start, start + CONCURRENCY).map(async key => {
      try {
        await purgeKey(client, bucket, key, signal);
        return null;
      } catch {
        return key;
      }
    }));
    failed.push(...results.filter(key => key !== null));
  }
  return failed;
}
