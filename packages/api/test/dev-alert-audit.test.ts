/** WHAT THIS MOCKS, AND WHY: closed AWS alarm fixtures. Real scoping, action
 * refusal and restore logic run without cloud credentials or notifications. */
import {expect,it,vi} from 'vitest';
import {auditDevAlerts} from '../../../scripts/dev-alert-audit.mjs';
const rows=()=>['OverdueJobs','ExhaustedLeases','RecoveryChecks'].map((metric,index)=>({AlarmName:'Queue-'+index,Namespace:'WAKA/QueueRecovery',MetricName:metric,Dimensions:[{Name:'Stage',Value:'development'}],StateValue:'OK',Period:900,EvaluationPeriods:2,AlarmActions:[],OKActions:[]}));
it('reads development configuration without mutating or exposing other-stage alarms',()=>{
  const read=vi.fn(()=>({MetricAlarms:[...rows(),{...rows()[0],Dimensions:[{Name:'Stage',Value:'production'}],AlarmName:'PRIVATE'}]}));
  const report=auditDevAlerts({awsRead:read});expect(report.complete).toBe(true);expect(report.alarms).toHaveLength(3);expect(read).toHaveBeenCalledOnce();expect(JSON.stringify(report)).not.toContain('PRIVATE');
});
it('refuses partial discovery, external actions and active alarms before state changes',()=>{
  for(const fixture of [{NextToken:'PRIVATE',MetricAlarms:rows()},{MetricAlarms:rows().map(row=>({...row,AlarmActions:['PRIVATE_DESTINATION']}))},{MetricAlarms:rows().map(row=>({...row,StateValue:'ALARM'}))}]){
    const read=vi.fn(()=>fixture);const result=auditDevAlerts({awsRead:read,exercise:true});expect(result.failures.length).toBeGreaterThan(0);expect(read).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain('PRIVATE');
  }
});
it('observes each console transition and restores its original state',()=>{
  const states=new Map(rows().map(row=>[row.AlarmName,'OK']));
  const read=vi.fn(args=>{if(args[1]==='set-alarm-state'){states.set(args[args.indexOf('--alarm-name')+1],args[args.indexOf('--state-value')+1]);return {};}
    if(args.includes('--alarm-names'))return {MetricAlarms:[{StateValue:states.get(args.at(-1))}]};return {MetricAlarms:rows()};});
  expect(auditDevAlerts({awsRead:read,exercise:true})).toMatchObject({consoleStatesVerified:true,externalDeliveryVerified:false,failures:[]});expect([...states.values()]).toEqual(['OK','OK','OK']);
});
it('restores state after a failed observation and sanitizes errors',()=>{
  let state='OK',failed=false;const read=vi.fn(args=>{if(args[1]==='set-alarm-state'){state=args[args.indexOf('--state-value')+1];return {};}
    if(args.includes('--alarm-names')){if(state==='ALARM'&&!failed){failed=true;throw Error('PRIVATE');}return {MetricAlarms:[{StateValue:state}]};}return {MetricAlarms:rows()};});
  const report=auditDevAlerts({awsRead:read,exercise:true});expect(report.consoleStatesVerified).toBe(false);expect(report.failures.length).toBeGreaterThan(0);expect(state).toBe('OK');expect(JSON.stringify(report)).not.toContain('PRIVATE');
});
