/** Operational counts only. Recovery uses the existing claim/budget path. */
import {emitOperationalMetric} from './operational-metrics.js';
export const QUEUE_RECOVERY_LIMITS={overdueMs:5*60*1000,claims:5,intervalMinutes:15} as const;
export interface QueueRecoveryState{overdue:number;oldestOverdueMs:number;exhaustedLeases:number}
export function recordQueueRecovery(state:QueueRecoveryState){
  const stage=['development','dev','production','local','test'].includes(process.env.WAKA_STAGE??'')?process.env.WAKA_STAGE!:'other';
  const value=(n:number)=>Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
  emitOperationalMetric({
    _aws:{Timestamp:Date.now(),CloudWatchMetrics:[{Namespace:'WAKA/QueueRecovery',Dimensions:[['Stage']],Metrics:[
      {Name:'OverdueJobs',Unit:'Count'},{Name:'OldestOverdueMs',Unit:'Milliseconds'},{Name:'ExhaustedLeases',Unit:'Count'},{Name:'RecoveryChecks',Unit:'Count'}]}]},
    event:'queue_recovery',Stage:stage,OverdueJobs:value(state.overdue),OldestOverdueMs:value(state.oldestOverdueMs),ExhaustedLeases:value(state.exhaustedLeases),RecoveryChecks:1,
  });
}
