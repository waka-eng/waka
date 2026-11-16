#!/usr/bin/env python3
"""Keyless dev C1/reconcile operator. Preparation only; no live authority.
AWS returns full config to CLI memory; --query narrows stdout, not service IAM.
A fatal/nonzero/missing child receipt is UNKNOWN, never mutation replay.
"""
import argparse, hashlib, json, os, re, stat, subprocess, sys
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlparse,parse_qs
ACCOUNT='182498323408'
WORKER='waka-development-BackgroundWorkerFunction-xxbrbmcx'
ARN=f'arn:aws:lambda:us-west-2:{ACCOUNT}:function:{WORKER}'
EXPECTED_DB_SHA='6fabf56590aab323e5eacfd976ce05566cde21553297c2edaa3f08d7ea6bebda'
class Refusal(Exception):
    def __init__(self,code):self.code=code

def digest(v):return hashlib.sha256(v).hexdigest()
def aws(args):
    r=subprocess.run(['aws',*args,'--cli-connect-timeout','5','--cli-read-timeout','8'],capture_output=True,text=True,timeout=12,env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_PAGER':''})
    if r.returncode or len(r.stdout.encode())>65536:raise Refusal('aws_read_refused')
    try:return json.loads(r.stdout)
    except Exception:raise Refusal('aws_json')
def run_cutover_child(argv,*,input,env):
    # Own exactly this spawned child. Preserve actual exit on hard timeout;
    # no process group/backend kill and no retry/uncaught-error swallowing.
    child=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    timed_out=False
    try:stdout,stderr=child.communicate(input=input,timeout=6)
    except subprocess.TimeoutExpired:
        timed_out=True;child.kill();stdout,stderr=child.communicate()
    return subprocess.CompletedProcess(argv,child.returncode,stdout,stderr),timed_out

def receipt_acceptance(r,mode,operation_sha,bundle_sha,intent_sha):
    # Never pass through raw child stderr/stdout or unknown fields.
    if r.returncode!=0:raise Refusal('child_unknown')
    if len(r.stdout.encode())>16384:raise Refusal('receipt_size')
    try:v=json.loads(r.stdout)
    except Exception:raise Refusal('child_unknown')
    keys={'passed','mode','executionRegion','runtimeConfigurationRegion','bundleSha256','operationSha256','intentSha256','profiles','outcome','providerCalls','memoryTextMutations','currentCoverageProven','billingProven','activationReplayAuthorized','privateMetadataSha256','privateMetadataBytes','privateMetadataMode'}
    if not isinstance(v,dict) or set(v)!=keys or v['passed'] is not True or v['mode']!=mode or v['bundleSha256']!=bundle_sha or v['operationSha256']!=operation_sha or v['intentSha256']!=intent_sha or v['executionRegion']!='us-east-1' or v['runtimeConfigurationRegion']!='us-west-2':raise Refusal('child_unknown')
    if v['outcome'] not in (['activated'] if mode=='C1' else ['after','before_or_in_flight','hold']) or type(v['profiles']) is not int or not 1<=v['profiles']<=32:raise Refusal('receipt')
    if any(type(v[k]) is not int or v[k]!=0 for k in ['providerCalls','memoryTextMutations']) or any(v[k] is not False for k in ['currentCoverageProven','billingProven','activationReplayAuthorized']):raise Refusal('receipt')
    if not isinstance(v['privateMetadataSha256'],str) or not re.fullmatch(r'[a-f0-9]{64}',v['privateMetadataSha256']) or type(v['privateMetadataBytes']) is not int or not 0<v['privateMetadataBytes']<=16384 or v['privateMetadataMode']!='0600':raise Refusal('receipt')
    return v

def main():
    global sql_may_have_started,child_exit,child_deadline
    sql_may_have_started=False;child_exit=None;child_deadline=False
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--execute-reviewed',action='store_true')
    for n in ['bundle','operation','invocation','approved-bundle-sha','approved-operation-sha','approved-operator-sha']:p.add_argument('--'+n,required=True)
    a=p.parse_args()
    if not a.execute_reviewed:raise Refusal('explicit_execution_required')
    if any(not re.fullmatch(r'[a-f0-9]{64}',v) for v in [a.approved_bundle_sha,a.approved_operation_sha,a.approved_operator_sha]):raise Refusal('approval_hash')
    if digest(Path(__file__).read_bytes())!=a.approved_operator_sha or digest(Path(a.bundle).read_bytes())!=a.approved_bundle_sha:raise Refusal('source_guard')
    op=Path(a.operation)
    if op.is_symlink() or not op.is_file() or stat.S_IMODE(op.stat().st_mode)!=0o600 or op.stat().st_size>32768:raise Refusal('operation_private')
    body=op.read_bytes()
    if digest(body)!=a.approved_operation_sha:raise Refusal('operation_hash')
    operation=json.loads(body)
    if json.dumps(operation,ensure_ascii=False,separators=(',',':')).encode()!=body:raise Refusal('canonical_json_required')
    mode={'embedding-cutover-v1':'C1','embedding-cutover-read-v1':'C1_reconcile'}.get(operation.get('version'))
    if mode is None or operation.get('approvedDbSha256')!=EXPECTED_DB_SHA:raise Refusal('operation')
    try:
        left=(datetime.fromisoformat(operation['expiresAt'].replace('Z','+00:00'))-datetime.now(timezone.utc)).total_seconds()
        if not 0<left<=7200:raise ValueError()
    except Exception:raise Refusal('expiry')
    if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',a.invocation):raise Refusal('invocation')
    base='/tmp/waka-embedding-cutover-'+('intent-' if mode=='C1' else 'read-')+a.approved_operation_sha
    if any(os.path.lexists(base+s) for s in ['.once','.pending','.private.json']):raise Refusal('once')
    if os.environ.get('AWS_REGION')!='us-east-1' or os.environ.get('AWS_DEFAULT_REGION')!='us-east-1':raise Refusal('native_region')
    node=subprocess.check_output(['node','--version'],text=True,timeout=3).strip()
    if not re.fullmatch(r'v20\.\d+\.\d+',node):raise Refusal('node_version')
    pre=subprocess.run(['node',a.bundle,'--validate-operation','--approved-sha',a.approved_bundle_sha],input=json.dumps({'operation':operation}),capture_output=True,text=True,timeout=3)
    try:check=json.loads(pre.stdout)
    except Exception:raise Refusal('schema_preflight')
    if pre.returncode or set(check)!={'passed','mode','operationSha256','intentSha256','operationKind'} or check.get('passed') is not True or check.get('mode')!='preflight' or check.get('operationSha256')!=a.approved_operation_sha or check.get('operationKind')!=mode or not re.fullmatch(r'[a-f0-9]{64}',check.get('intentSha256','')):raise Refusal('schema_preflight')
    identity=aws(['sts','get-caller-identity','--region','us-west-2','--query','{account:Account}','--output','json'])
    if identity.get('account')!=ACCOUNT:raise Refusal('account')
    projection='{arn:FunctionArn,app:Environment.Variables.SST_RESOURCE_App,stage:Environment.Variables.WAKA_STAGE,db:Environment.Variables.DB_CONNECTION_URL}'
    runtime=aws(['lambda','get-function-configuration','--region','us-west-2','--function-name',WORKER,'--query',projection,'--output','json'])
    try:app=json.loads(runtime.get('app',''))
    except Exception:raise Refusal('app')
    if runtime.get('arn')!=ARN or runtime.get('stage')!='development' or app.get('name')!='waka' or app.get('stage')!='development':raise Refusal('runtime')
    uri=runtime.get('db')
    if not isinstance(uri,str) or digest(uri.encode())!=EXPECTED_DB_SHA:raise Refusal('independent_fingerprint')
    u=urlparse(uri);tls=(parse_qs(u.query).get('sslmode') or parse_qs(u.query).get('ssl') or ['require'])[0]
    if u.scheme not in ['postgres','postgresql'] or not u.username or not u.password or not u.hostname or not u.hostname.endswith('.neon.tech') or 'us-east-1' not in u.hostname or '-pooler' not in u.hostname or tls in ['disable','false']:raise Refusal('topology')
    if (datetime.fromisoformat(operation['expiresAt'].replace('Z','+00:00'))-datetime.now(timezone.utc)).total_seconds()<=6:raise Refusal('expiry')
    payload={'operation':operation,'operationSha256':a.approved_operation_sha,'invocationId':a.invocation,'dbUrl':uri,'attestation':{'accountId':ACCOUNT,'stage':'development','workerArn':ARN,'appName':'waka','appStage':'development','executionRegion':'us-east-1','runtimeConfigurationRegion':'us-west-2'}}
    env={k:v for k,v in os.environ.items() if k in ['PATH','LANG','LC_ALL','TZ','AWS_REGION','AWS_DEFAULT_REGION']};env['WAKA_BACKGROUND_JOB_AUTODRAIN']='0'
    # Hard dedicated-child boundary. A stalled JS process is killed by6s;
    # PG17's5s transaction deadline independently bounds SQL-held locks.
    sql_may_have_started=True
    r,child_deadline=run_cutover_child(['node',a.bundle,'--execute-reviewed','--approved-sha',a.approved_bundle_sha],input=json.dumps(payload),env=env)
    child_exit=r.returncode
    payload.clear();runtime.clear();uri=None
    if child_deadline:raise Refusal('deadline')
    receipt=receipt_acceptance(r,mode,a.approved_operation_sha,a.approved_bundle_sha,check['intentSha256'])
    receipt.update(childExit=child_exit,childDeadlineReached=child_deadline)
    print(json.dumps(receipt,separators=(',',':')));return 0

sql_may_have_started=False
child_exit=None
child_deadline=False
if __name__=='__main__':
    try:sys.exit(main())
    except Refusal as e:code=e.code
    except subprocess.TimeoutExpired:code='deadline'
    except Exception:code='operator_refused'
    print(json.dumps({'passed':False,'code':code,'sqlMayHaveStarted':sql_may_have_started,'childExit':child_exit,'childDeadlineReached':child_deadline,'outcome':'unknown' if sql_may_have_started else 'not_started','activationReplayAuthorized':False}));sys.exit(1)
