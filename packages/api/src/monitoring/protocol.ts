import { createHash } from 'node:crypto';

export const alarmLabels = {
  ProbeMissing: 'Public liveness probe not observed',
  Availability: 'Public web/API liveness', ApplicationFault: 'Application processing failure',
  LambdaErrors: 'Lambda execution errors', LambdaThrottles: 'Lambda capacity throttling',
  AttachmentDlq: 'Attachment events need recovery', DeliveryDlq: 'Alert delivery needs recovery',
  ScheduleDelivery: 'Scheduled invocation delivery failed', WorkerTimeout: 'Worker near its execution deadline',
} as const;
export type AlarmCode = keyof typeof alarmLabels;
export interface AlarmTransition { id: string; alarm: string; code: AlarmCode; state: 'ALARM' | 'OK'; timestamp: number }
export function readTransition(raw: unknown, account: string, region: string, now = Date.now()): AlarmTransition | null {
  if (!/^\d{12}$/.test(account) || region !== 'us-west-2' || !raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, any>;
  const name = e.alarmData?.alarmName;
  const code = typeof name === 'string' ? name.replace('waka-production-', '') as AlarmCode : null;
  if (!code || !Object.hasOwn(alarmLabels, code) || name !== `waka-production-${code}` || e.source !== 'aws.cloudwatch' || e.accountId !== account || e.region !== region ||
    e.alarmArn !== `arn:aws:cloudwatch:${region}:${account}:alarm:${name}`) return null;
  const state = e.alarmData?.state?.value;
  const timestamp = Date.parse(e.alarmData?.state?.timestamp);
  if (!['ALARM', 'OK'].includes(state) || !Number.isFinite(timestamp) || timestamp > now + 300000 || timestamp < now - 30 * 86400000) return null;
  // Initial healthy state is setup, not recovery. Never send raw reason/body.
  if (state === 'OK' && e.alarmData?.previousState?.value !== 'ALARM') return null;
  return { id: 'event:'+createHash('sha256').update(`${name}:${timestamp}:${state}`).digest('hex'), alarm: name, code, state, timestamp };
}
export function discordDestination(value: string): string {
  let url: URL; try { url = new URL(value); } catch { throw Error('monitor_destination_invalid'); }
  if (url.origin !== 'https://discord.com' || url.username || url.password || url.hash || url.search || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) throw Error('monitor_destination_invalid');
  url.searchParams.set('wait', 'true'); return url.href;
}
export function discordPayload(t: AlarmTransition) {
  return { allowed_mentions: { parse: [] }, content: `WAKA production · ${t.state === 'ALARM' ? 'Attention needed' : 'Metric back in range'}\n${alarmLabels[t.code]}\n${new Date(t.timestamp).toISOString()}\nhttps://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#alarmsV2:alarm/${encodeURIComponent(t.alarm)}` };
}
