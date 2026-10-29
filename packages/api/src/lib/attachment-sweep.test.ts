/**
 * WHAT THIS MOCKS, AND WHY (gate G6)
 * `./s3-client.js` and `./attachment-storage.js` replace only the external
 * bucket boundary. Real SDK commands exercise batching and response handling.
 * `console.warn` records whether failures are visible without exposing keys
 * or provider messages. No objects are uploaded or removed by this suite.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { sweepAttachmentObjects } from './attachment-sweep.js';

const state = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock('./s3-client.js', () => ({ makeAttachmentsS3Client: () => state }));
vi.mock('./attachment-storage.js', () => ({ getAttachmentsBucket: () => 'test-bucket' }));
beforeEach(() => { state.send.mockReset(); state.destroy.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

it('reports a partial S3 failure even when the request succeeds, and continues remaining batches', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.send.mockResolvedValueOnce({ Errors: [{ Key: 'private/key', Message: 'private provider detail' }] })
    .mockResolvedValueOnce({});
  const keys = Array.from({ length: 1001 }, (_, i) => `private/${i}`);
  await expect(sweepAttachmentObjects([...keys, keys[0]!])).resolves.toBeUndefined();
  expect(state.send).toHaveBeenCalledTimes(2);
  const batches = state.send.mock.calls.map(([command]) => (command as DeleteObjectsCommand).input.Delete!.Objects!);
  expect(batches.map(batch => batch.length)).toEqual([1000, 1]);
  expect(batches.flat().map(item => item.Key)).toEqual(keys);
  expect(warn).toHaveBeenCalledExactlyOnceWith('[attachments] S3 sweep incomplete', { keyCount: 1 });
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  expect(state.destroy).toHaveBeenCalledOnce();
});

it('logs transport failures and releases the client without failing an already committed deletion', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.send.mockRejectedValue(new Error('private provider detail'));
  await expect(sweepAttachmentObjects(['private/key'])).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledExactlyOnceWith('[attachments] S3 sweep failed', { keyCount: 1, error: 'Error' });
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  expect(state.destroy).toHaveBeenCalledOnce();
});
