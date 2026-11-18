// The S3 transport is mocked. Assertions cover the actual SDK commands and
// failure handling without listing or deleting anything in a real bucket.
import { DeleteObjectsCommand, ListObjectVersionsCommand, type S3Client } from '@aws-sdk/client-s3';
import { afterEach, expect, it, vi } from 'vitest';
import { purgeAttachmentVersions } from './attachment-version-purge.js';
import { deleteAttachmentObjectBatch } from './attachment-sweep.js';
import { makeAttachmentsS3Client } from './s3-client.js';

vi.mock('./s3-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('./s3-client.js')>(),
  makeAttachmentsS3Client: vi.fn(),
}));
afterEach(() => vi.unstubAllEnvs());

const bucket = 'synthetic-attachments';
const key = 'profiles/synthetic/attachments/file';
const sibling = key + '-other';
const version = (VersionId: string, IsLatest: boolean, Key = key) => ({ Key, VersionId, IsLatest });
const empty = { IsTruncated: false };
function fake(...replies: Array<object | Error>) {
  const send = vi.fn(async (_command: ListObjectVersionsCommand | DeleteObjectsCommand) => {
    const reply = replies.shift();
    if (!reply || reply instanceof Error) throw reply ?? new Error('Unexpected request');
    return reply;
  });
  const client = { send, destroy: vi.fn() } as unknown as S3Client;
  return { client, send };
}

it('paginates exact keys, deletes null and historical versions before the newest marker, then verifies absence', async () => {
  const { client, send } = fake(
    { IsTruncated: true, DeleteMarkers: [version('new-marker', true)], NextKeyMarker: key, NextVersionIdMarker: 'new-marker' },
    { IsTruncated: false, Versions: [version('null', false), version('old', false), version('foreign', true, sibling)] },
    {}, {}, { IsTruncated: false, Versions: [version('foreign', true, sibling)] },
  );
  expect(await purgeAttachmentVersions(client, bucket, [key])).toEqual([]);
  expect(send.mock.calls.map(([command]) => command.input)).toEqual([
    { Bucket: bucket, Prefix: key, MaxKeys: 1000 },
    { Bucket: bucket, Prefix: key, MaxKeys: 1000, KeyMarker: key, VersionIdMarker: 'new-marker' },
    { Bucket: bucket, Delete: { Objects: [{ Key: key, VersionId: 'null' }, { Key: key, VersionId: 'old' }], Quiet: true } },
    { Bucket: bucket, Delete: { Objects: [{ Key: key, VersionId: 'new-marker' }], Quiet: true } },
    { Bucket: bucket, Prefix: key, MaxKeys: 1000 },
  ]);
});

it('deletes an unversioned null version explicitly and makes an absent key an idempotent no-op', async () => {
  const { client, send } = fake({ IsTruncated: false, Versions: [version('null', true)] }, {}, empty, empty);
  expect(await purgeAttachmentVersions(client, bucket, [key])).toEqual([]);
  expect(await purgeAttachmentVersions(client, bucket, [key])).toEqual([]);
  const deletes = send.mock.calls.flatMap(([command]) => command instanceof DeleteObjectsCommand ? [command.input] : []);
  expect(deletes).toEqual([{ Bucket: bucket, Delete: { Objects: [{ Key: key, VersionId: 'null' }], Quiet: true } }]);
});

it.each([
  { IsTruncated: true, Versions: [version('current', true)], NextKeyMarker: key },
  { IsTruncated: false, Versions: [{ Key: key, IsLatest: true }] },
  { IsTruncated: false, Versions: [version('one', true), version('two', true)] },
  { IsTruncated: false, Versions: [version('one', false)] },
  { Versions: [version('one', true)] },
])('keeps the key pending on an untrusted or incomplete listing', async listing => {
  const { client, send } = fake(listing);
  expect(await purgeAttachmentVersions(client, bucket, [key])).toEqual([key]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListObjectVersionsCommand);
});

it('refuses a repeated continuation cursor before any deletion', async () => {
  const page = { IsTruncated: true, NextKeyMarker: key, NextVersionIdMarker: 'no-progress' };
  const { client, send } = fake(page, page);
  expect(await purgeAttachmentVersions(client, bucket, [key])).toEqual([key]);
  expect(send.mock.calls.every(([command]) => command instanceof ListObjectVersionsCommand)).toBe(true);
});

it('holds the latest marker when S3 returns an item error for an older version', async () => {
  const { client, send } = fake({ IsTruncated: false, Versions: [version('older', false)], DeleteMarkers: [version('marker', true)] },
    { Errors: [{ Key: key, VersionId: 'older', Code: 'AccessDenied' }] });
  expect(await purgeAttachmentVersions(client, bucket, [key])).toEqual([key]);
  expect(send).toHaveBeenCalledTimes(2);
});

it('reports an ambiguous transport error or a concurrent PUT as failed work', async () => {
  const ambiguous = fake({ IsTruncated: false, Versions: [version('latest', true)] }, new Error('unknown outcome'));
  expect(await purgeAttachmentVersions(ambiguous.client, bucket, [key])).toEqual([key]);
  const concurrent = fake({ IsTruncated: false, Versions: [version('latest', true)] }, {},
    { IsTruncated: false, Versions: [version('late-put', true)] });
  expect(await purgeAttachmentVersions(concurrent.client, bucket, [key])).toEqual([key]);
});

it.each([
  { stage: 'production', endpoint: undefined, versioned: true },
  { stage: 'development', endpoint: undefined, versioned: false },
  { stage: 'production', endpoint: 'http://127.0.0.1:12345', versioned: false },
])('selects permanent purge only for AWS production', async ({ stage, endpoint, versioned }) => {
  vi.stubEnv('WAKA_STAGE', stage);
  vi.stubEnv('ATTACHMENTS_ENDPOINT', endpoint);
  vi.stubEnv('ATTACHMENTS_BUCKET', bucket);
  const { client, send } = versioned
    ? fake({ IsTruncated: false, Versions: [version('null', true)] }, {}, empty)
    : fake({});
  vi.mocked(makeAttachmentsS3Client).mockReturnValueOnce(client);
  expect(await deleteAttachmentObjectBatch([key, key])).toEqual([]);
  const deletes = send.mock.calls.flatMap(([command]) => command instanceof DeleteObjectsCommand ? [command.input] : []);
  expect(deletes).toEqual([{ Bucket: bucket, Delete: {
    Objects: [versioned ? { Key: key, VersionId: 'null' } : { Key: key }], Quiet: true,
  } }]);
  expect(client.destroy).toHaveBeenCalledTimes(1);
});
