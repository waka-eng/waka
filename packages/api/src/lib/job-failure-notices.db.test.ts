/** The queue, migrations and acknowledgement update use disposable Postgres.
 * Lambda is intercepted at the SDK boundary; nothing goes to AWS or Discord. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/db.js';
import { deliverTerminalJobNotices } from './job-failure-notices.js';
import { readJobFailureNotice } from '../monitoring/job-failure.js';

const arn = 'arn:aws:lambda:us-west-2:111122223333:function:waka-production-JobFailureAlertFunction-fixture';
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
beforeEach(async () => {
  await t.truncateAll();
  vi.stubEnv('WAKA_STAGE', 'production');
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'fixture-worker');
  vi.stubEnv('WAKA_JOB_ALERT_RELAY_ARN', arn);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await t?.cleanup(); });

async function fixture() {
  const [owner] = await t.sql`INSERT INTO accounts(email) VALUES ('private@example.test') RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${owner.id},'human','private') RETURNING id`;
  const [job] = await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,last_error)
    VALUES (${profile.id},'derive_signals','{"failureDisposition":"permanent","text":"private"}','failed','private') RETURNING id`;
  return job.id as string;
}

it('scopes dispatch to the configured relay and only marks the exact failed row after a matching receipt', async () => {
  const id = await fixture(), references: string[] = [];
  const send = vi.spyOn(LambdaClient.prototype, 'send').mockImplementation(async (raw: any) => {
    expect(raw).toBeInstanceOf(InvokeCommand);
    expect(raw.input.FunctionName).toBe(arn);
    expect(raw.input.InvocationType).toBe('RequestResponse');
    const encoded = Buffer.from(raw.input.Payload).toString();
    expect(encoded).not.toContain('private');
    expect(encoded).not.toContain(id);
    const notice = readJobFailureNotice(JSON.parse(encoded))!;
    expect(notice.disposition).toBe('permanent');
    expect(notice.diagnostic).toBe('other');
    references.push(notice.reference);
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ delivered: references.length === 1 ? 'wrong' : notice.reference })) };
  });
  await deliverTerminalJobNotices(t.db, id);
  expect((await t.sql`SELECT terminal_notice_sent_for FROM background_jobs WHERE id=${id}`)[0].terminal_notice_sent_for).toBeNull();
  await deliverTerminalJobNotices(t.db);
  await deliverTerminalJobNotices(t.db);
  expect(send).toHaveBeenCalledTimes(2);
  expect(references[0]).toBe(references[1]);
  expect((await t.sql`SELECT terminal_notice_sent_for=updated_at AS confirmed FROM background_jobs WHERE id=${id}`)[0].confirmed).toBe(true);
});

it('a superseding failure cannot be acknowledged by an in-flight earlier delivery', async () => {
  const id = await fixture();
  const newer = vi.fn(async () => {
    await t.sql`UPDATE background_jobs SET request_version=request_version+1, updated_at=clock_timestamp() WHERE id=${id}`;
  });
  await deliverTerminalJobNotices(t.db, id, newer);
  const next = vi.fn(async () => {});
  await deliverTerminalJobNotices(t.db, id, next);
  expect(newer).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledOnce();
  expect(next.mock.calls[0]).not.toEqual(newer.mock.calls[0]);
});

it('never posts retrying work, nonproduction work or an unbound destination', async () => {
  const id = await fixture(), notify = vi.fn(async () => {});
  vi.stubEnv('WAKA_STAGE', 'dev');
  await deliverTerminalJobNotices(t.db, id, notify);
  vi.stubEnv('WAKA_STAGE', 'production');
  vi.stubEnv('WAKA_JOB_ALERT_RELAY_ARN', 'wrong');
  await deliverTerminalJobNotices(t.db, id, notify);
  vi.stubEnv('WAKA_JOB_ALERT_RELAY_ARN', arn);
  await t.sql`UPDATE background_jobs SET status='pending' WHERE id=${id}`;
  await deliverTerminalJobNotices(t.db, id, notify);
  expect(notify).not.toHaveBeenCalled();
});
