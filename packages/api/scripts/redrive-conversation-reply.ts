import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { getDb } from '../src/lib/db.js';
import { inspectQueueRedrive } from '../src/lib/queue-redrive.js';

const usage = 'redrive-conversation-reply --db-sha256 <hash> --account <uuid> --profile <uuid> --job <uuid> --reply-request <uuid> --request-version <integer> [--apply]';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

async function run() {
  const { values } = parseArgs({ options: {
    'db-sha256': { type: 'string' }, account: { type: 'string' }, profile: { type: 'string' },
    job: { type: 'string' }, 'reply-request': { type: 'string' }, 'request-version': { type: 'string' },
    apply: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); return; }
  const { account, profile, job, 'reply-request': replyRequestId, 'request-version': requestVersion } = values;
  const uri = process.env.DB_CONNECTION_URL;
  const targetHash = values['db-sha256'];
  if (!uri || !targetHash || !/^[0-9a-f]{64}$/.test(targetHash)
    || createHash('sha256').update(uri).digest('hex') !== targetHash
    || !account || !uuid.test(account) || !profile || !uuid.test(profile) || !job || !uuid.test(job)
    || !replyRequestId || !uuid.test(replyRequestId) || !requestVersion || !/^[1-9]\d{0,18}$/.test(requestVersion)
    || BigInt(requestVersion) > 9223372036854775807n) {
    console.error('Exact target and request identity are required.');
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  try {
    const result = await inspectQueueRedrive(db, { accountId: account, profileId: profile, jobId: job, replyRequestId, requestVersion }, values.apply);
    console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'preview', ...result }));
    if (!result.eligible) process.exitCode = 1;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

run().catch(() => {
  console.error('Queue operation unconfirmed. Reconcile the exact job before taking further action.');
  process.exitCode = 1;
});
