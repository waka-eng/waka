/** WHAT THIS MOCKS, AND WHY: nothing. Pins the no-idle-poll deployment contract
 * while retaining enqueue wakes, the daily sweep and passive backlog alarms. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
const sst=readFileSync(resolve(import.meta.dirname,'../../../sst.config.ts'),'utf8');
it('removes the idle recovery timer while keeping the daily sweep and enqueue wake',()=>{
  expect(sst).not.toContain('new sst.aws.Cron("QueueRecovery"');
  expect(sst).not.toContain('schedule: "rate(15 minutes)"');
  expect(sst).not.toContain('event: { mode: "recovery" }');
  expect(sst).toContain('WAKA_BACKGROUND_WORKER_FUNCTION: backgroundWorker.name');
  expect(sst).toContain('schedule: "rate(1 day)"');expect(sst).toContain('WAKA_STAGE: $app.stage');
});
it('keeps passive backlog alarms without demanding periodic database reads',()=>{
  expect(sst).toContain('process.env.WAKA_ALERT_SNS_TOPIC_ARN');expect(sst).toContain('alarmActions: topic ? [topic] : []');
  expect(sst).not.toContain('"QueueRecoveryMissing"');
  expect(sst).toContain('["QueueOverdue", "OverdueJobs", "GreaterThanThreshold", 0, "notBreaching"]');
  expect(sst).toContain('["QueueExhausted", "ExhaustedLeases", "GreaterThanThreshold", 0, "notBreaching"]');
  expect(sst).toContain('evaluationPeriods: 2');expect(sst).toContain('dimensions: { Stage: $app.stage }');
});
