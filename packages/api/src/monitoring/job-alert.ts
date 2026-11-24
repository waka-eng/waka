import { randomUUID } from 'node:crypto';
import { discordDestination } from './protocol.js';
import { jobFailureDiscordPayload, readJobFailureNotice, type JobFailureNotice } from './job-failure.js';
import { dynamoStore, type DeliveryStore } from './relay.js';

/** Job incidents are independent. Two failures in the same CloudWatch alarm
 * period each get a notice. Concurrent deliveries share the existing event lease. */
export async function deliverJobFailure(notice: JobFailureNotice, store: Pick<DeliveryStore, 'remember' | 'claim' | 'settle' | 'defer'>, destination: string,
  fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  const event = { id: 'event:job:' + notice.reference, timestamp: notice.timestamp, kind: 'job_failure' } as const;
  const url = discordDestination(destination);
  await store.remember(event);
  const token = randomUUID();
  if (await store.claim(event, token, clock())) {
    const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobFailureDiscordPayload(notice)) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After') ?? 60);
        const now = clock();
        await store.defer(event, token, now + Math.min(3600000, Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000)), now);
      }
      throw Error('monitor_job_delivery_rejected');
    }
    // wait=true returns the actual Discord message. Only acknowledge a confirmed post.
    const message = await response.json() as { id?: unknown };
    if (typeof message?.id !== 'string' || !/^\d{17,20}$/.test(message.id)) throw Error('monitor_job_delivery_unconfirmed');
    await store.settle(event, token, true, clock());
  }
  return { delivered: notice.reference };
}

export async function handler(event: unknown) {
  if (process.env.WAKA_STAGE !== 'production') throw Error('monitor_job_stage_invalid');
  const notice = readJobFailureNotice(event);
  if (!notice) throw Error('monitor_job_notice_invalid');
  try {
    return await deliverJobFailure(notice, dynamoStore(process.env.MONITOR_TABLE ?? ''), process.env.WAKA_DISCORD_WEBHOOK_URL ?? '');
  } catch {
    // No Discord URL, response body or AWS error message in function logs.
    throw Error('monitor_job_delivery_unconfirmed');
  }
}
