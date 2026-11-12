import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';

const root=resolve(__dirname,'../../..');
const load=()=>import(/* @vite-ignore */resolve(root,'infra/monitoring-relay-arn.mjs'));
const account='111122223333',name='waka-production-MonitorRelayFunction-localtest';
const source=ts.createSourceFile('sst.config.ts',readFileSync(resolve(root,'sst.config.ts'),'utf8'),ts.ScriptTarget.Latest,true);
function findNode(predicate:(n:ts.Node)=>boolean) {
  let found:ts.Node|undefined;
  const visit=(n:ts.Node)=>{if(predicate(n))found=n;else ts.forEachChild(n,visit);};visit(source);
  if(!found)throw Error('Expected source construction absent');return found;
}
it('executes the real config callback/helper with a known-name/null-ARN partial checkpoint',async()=>{
  const {monitorRelayAlarmActions}=await load();
  const declaration=findNode(n=>ts.isVariableDeclaration(n)&&n.name.getText(source)==='action') as ts.VariableDeclaration;
  const apply=declaration.initializer as ts.CallExpression;
  expect(ts.isCallExpression(apply)).toBe(true);expect(apply.expression.getText(source)).toBe('$util.all([caller.accountId, relay.name]).apply');
  const all=(apply.expression as ts.PropertyAccessExpression).expression as ts.CallExpression;
  expect(all.expression.getText(source)).toBe('$util.all');
  expect(all.arguments[0].getText(source)).toBe('[caller.accountId, relay.name]');
  const callbackSource=ts.transpileModule('const callback='+apply.arguments[0].getText(source)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const callback=new Function('monitorRelayAlarmActions','AWS_REGION',callbackSource+'return callback;')(monitorRelayAlarmActions,'us-west-2');
  const relay={arn:null,name};
  expect(JSON.parse(JSON.stringify([relay.arn]))).toEqual([null]); // observed provider failure input
  const actions=callback([account,relay.name]);
  expect(actions).toEqual([`arn:aws:lambda:us-west-2:${account}:function:${name}`]);expect(actions).not.toContain(null);
  // Raw unresolved/invalid values are refused, never interpolated into an ARN.
  // In deployment, Pulumi all().apply() defers this callback for unknown inputs.
  expect(()=>callback([account,undefined])).toThrow('monitor_relay_identity_invalid');
  const alarm=findNode(n=>ts.isNewExpression(n)&&n.expression.getText(source)==='aws.cloudwatch.MetricAlarm'&&n.arguments?.[0].getText(source)==='`Monitor${code}`') as ts.NewExpression;
  const options=alarm.arguments![2] as ts.ObjectLiteralExpression;
  const depends=options.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='dependsOn') as ts.PropertyAssignment;
  expect((depends.initializer as ts.ArrayLiteralExpression).elements.map(n=>n.getText(source))).toEqual(['relay.nodes.function','permission']);
  const args=alarm.arguments![1] as ts.ObjectLiteralExpression;
  for(const property of ['alarmActions','okActions'])expect((args.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)===property) as ts.PropertyAssignment).initializer.getText(source)).toBe('action');
});
it.each([
  ['eu-west-1',account,name],['us-west-2','foreign',name],['us-west-2',null,name],['us-west-2',undefined,name],
  ['us-west-2',account,null],['us-west-2',account,undefined],['us-west-2',account,{unknown:true}],
  ['us-west-2',account,'waka-development-MonitorRelayFunction-localtest'],['us-west-2',account,'other-function'],
  ['us-west-2',account,name+':alias'],['us-west-2',account,name+'*'],['us-west-2',account,'arn:aws:lambda:us-west-2:999988887777:function:foreign'],
])('refuses foreign, null, unresolved, qualified or wildcard identity %#',async(region,owner,fn)=>{
  const {monitorRelayAlarmActions}=await load();expect(()=>monitorRelayAlarmActions(region,owner,fn)).toThrow('monitor_relay_identity_invalid');
});
