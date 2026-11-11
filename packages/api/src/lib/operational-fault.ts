import { emitOperationalMetric } from './operational-metrics.js';

export type OperationalFault = 'api_5xx' | 'job_terminal' | 'queue_recovery' | 'worker_execution' | 'worker_wake' | 'wake_schedule' | 'attachment_cleanup' | 'attachment_backlog' | 'provider_failure' | 'maintenance';
const codes = new Set(['api_5xx','job_terminal','queue_recovery','worker_execution','worker_wake','wake_schedule','attachment_cleanup','attachment_backlog','provider_failure','maintenance']);
/** One Stage-only series; the closed code is a log field, never a dimension.
 * Do not pass an error, route, owner identifier or arbitrary caller string. */
export function recordOperationalFault(code: OperationalFault) {
  if (process.env.WAKA_STAGE !== 'production' || !codes.has(code)) return;
  emitOperationalMetric({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: 'WAKA/Operations', Dimensions: [['Stage']], Metrics: [{ Name: 'Faults', Unit: 'Count' }] }] },
    Stage: process.env.WAKA_STAGE, event: 'operational_fault', code, Faults: 1 });
}
export function recordDailySweep() {
  if (process.env.WAKA_STAGE !== 'production') return;
  emitOperationalMetric({ _aws:{Timestamp:Date.now(),CloudWatchMetrics:[{Namespace:'WAKA/Operations',Dimensions:[['Stage']],Metrics:[{Name:'DailySweeps',Unit:'Count'}]}]}, Stage:'production',event:'daily_sweep_completed',DailySweeps:1 });
}
