/** WHAT THIS MOCKS, AND WHY: nothing. Pins the dev-only scheduled mode and
 * alarm contract; compilation and live alarm delivery remain deployment gates. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
const sst=readFileSync(resolve(import.meta.dirname,'../../../sst.config.ts'),'utf8');
it('keeps the daily sweep and bounds dev-only recovery on the existing worker',()=>{
  const recovery=sst.slice(sst.indexOf('new sst.aws.Cron("QueueRecovery"'),sst.indexOf('// Console alarms'));
  expect(recovery).toContain('schedule: "rate(15 minutes)"');expect(recovery).toContain('enabled: isDevelopmentDomain');
  expect(recovery).toContain('function: backgroundWorker.arn');expect(recovery).toContain('event: { mode: "recovery" }');
  expect(sst).toContain('schedule: "rate(1 day)"');expect(sst).toContain('WAKA_STAGE: $app.stage');
});
it('does not manufacture an alert recipient and detects lost recovery heartbeats',()=>{
  expect(sst).toContain('process.env.WAKA_ALERT_SNS_TOPIC_ARN');expect(sst).toContain('alarmActions: topic ? [topic] : []');
  expect(sst).toContain('["QueueRecoveryMissing", "RecoveryChecks", "LessThanThreshold", 1, "breaching"]');
  expect(sst).toContain('evaluationPeriods: 2');expect(sst).toContain('dimensions: { Stage: $app.stage }');
});
