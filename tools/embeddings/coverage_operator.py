"""Prepared keyless C0 only. No live-read authority is conferred by this file.
AWS service returns full configuration to CLI; --query narrows CLI stdout.
Independent historical target fingerprint is checked before any SQL.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import urlparse, parse_qs

ACCOUNT='182498323408'
WORKER='waka-development-BackgroundWorkerFunction-xxbrbmcx'
ARN=f'arn:aws:lambda:us-west-2:{ACCOUNT}:function:{WORKER}'
EXPECTED_DB_SHA='6fabf56590aab323e5eacfd976ce05566cde21553297c2edaa3f08d7ea6bebda'

class Refusal(Exception):
    def __init__(self,code):self.code=code

def digest(raw):return hashlib.sha256(raw).hexdigest()

def aws(args):
    r=subprocess.run(['aws',*args,'--cli-connect-timeout','5','--cli-read-timeout','8'],capture_output=True,text=True,timeout=12,env={**os.environ,'AWS_MAX_ATTEMPTS':'1','AWS_PAGER':''})
    if r.returncode:raise Refusal(next((v for v in ['AccessDenied','AccessDeniedException','ExpiredToken','ThrottlingException','ResourceNotFoundException'] if re.search(r'\b'+v+r'\b',r.stderr)),'aws_read_refused'))
    try:return json.loads(r.stdout)
    except Exception:raise Refusal('aws_json')

def main():
    p=argparse.ArgumentParser(description='Keyless C0 current embedding coverage, read only')
    p.add_argument('--execute-reviewed',action='store_true')
    for name in ['bundle','manifest','invocation','approved-bundle-sha','approved-manifest-sha','approved-operator-sha']:p.add_argument('--'+name,required=True)
    a=p.parse_args()
    if not a.execute_reviewed:raise Refusal('explicit_execution_required')
    if any(not re.fullmatch(r'[a-f0-9]{64}',v) for v in [a.approved_bundle_sha,a.approved_manifest_sha,a.approved_operator_sha]):raise Refusal('approval_hash')
    if digest(Path(__file__).read_bytes())!=a.approved_operator_sha or digest(Path(a.bundle).read_bytes())!=a.approved_bundle_sha:raise Refusal('source_guard')
    path=Path(a.manifest)
    if path.is_symlink() or not path.is_file() or stat.S_IMODE(path.stat().st_mode)!=0o600 or path.stat().st_size>16384:raise Refusal('manifest_private')
    body=path.read_bytes()
    if digest(body)!=a.approved_manifest_sha:raise Refusal('manifest_hash')
    m=json.loads(body)
    if json.dumps(m,ensure_ascii=False,separators=(',',':')).encode()!=body:raise Refusal('canonical_json_required')
    if m.get('version')!='embedding-coverage-v1' or m.get('approvedDbSha256')!=EXPECTED_DB_SHA:raise Refusal('manifest')
    try:
        remaining=(datetime.fromisoformat(m['expiresAt'].replace('Z','+00:00'))-datetime.now(timezone.utc)).total_seconds()
        if not 0<remaining<=86400:raise ValueError()
    except Exception:raise Refusal('expiry')
    if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',a.invocation):raise Refusal('invocation')
    base='/tmp/waka-embedding-coverage-'+a.approved_manifest_sha+'-'+a.invocation
    if any(os.path.lexists(base+s) for s in ['.once','.pending','.private.json']):raise Refusal('once')
    # Native east execution is distinct from the west runtime being attested.
    # Never rewrite/spoof a west shell into east: inventory must agree first.
    if os.environ.get('AWS_REGION')!='us-east-1' or os.environ.get('AWS_DEFAULT_REGION')!='us-east-1':raise Refusal('native_region')
    node=subprocess.check_output(['node','--version'],text=True,timeout=3).strip()
    if not re.fullmatch(r'v20\.\d+\.\d+',node):raise Refusal('node_version')
    identity=aws(['sts','get-caller-identity','--region','us-west-2','--query','{account:Account}','--output','json'])
    if identity.get('account')!=ACCOUNT:raise Refusal('account')
    projection='{arn:FunctionArn,app:Environment.Variables.SST_RESOURCE_App,stage:Environment.Variables.WAKA_STAGE,db:Environment.Variables.DB_CONNECTION_URL}'
    runtime=aws(['lambda','get-function-configuration','--region','us-west-2','--function-name',WORKER,'--query',projection,'--output','json'])
    try:app=json.loads(runtime.get('app',''))
    except Exception:raise Refusal('app')
    if runtime.get('arn')!=ARN or runtime.get('stage')!='development' or app.get('name')!='waka' or app.get('stage')!='development':raise Refusal('runtime')
    uri=runtime.get('db')
    if not isinstance(uri,str) or digest(uri.encode())!=EXPECTED_DB_SHA:raise Refusal('independent_fingerprint')
    parsed=urlparse(uri);params=parse_qs(parsed.query);tls=(params.get('sslmode') or params.get('ssl') or ['require'])[0]
    if parsed.scheme not in ['postgres','postgresql'] or not parsed.username or not parsed.password or not parsed.hostname or not parsed.hostname.endswith('.neon.tech') or 'us-east-1' not in parsed.hostname or '-pooler' not in parsed.hostname or tls in ['disable','false']:raise Refusal('topology')
    payload={'manifest':m,'manifestSha256':a.approved_manifest_sha,'invocationId':a.invocation,'dbUrl':uri,'attestation':{'accountId':ACCOUNT,'stage':'development','workerArn':ARN,'appName':'waka','appStage':'development','executionRegion':'us-east-1','runtimeConfigurationRegion':'us-west-2'}}
    env={k:v for k,v in os.environ.items() if k in ['PATH','LANG','LC_ALL','TZ','AWS_REGION','AWS_DEFAULT_REGION']};env['WAKA_BACKGROUND_JOB_AUTODRAIN']='0'
    r=subprocess.run(['node',a.bundle,'--execute-reviewed','--approved-sha',a.approved_bundle_sha],input=json.dumps(payload),capture_output=True,text=True,timeout=70,env=env)
    payload.clear();runtime.clear();uri=None
    if len(r.stdout.encode())>16384:raise Refusal('receipt_size')
    receipt=json.loads(r.stdout)
    if not isinstance(receipt,dict) or type(receipt.get('passed')) is not bool or receipt.get('mode')!='C0':raise Refusal('receipt')
    if receipt['passed']:
        if r.returncode!=0 or set(receipt)!={'passed','mode','executionRegion','runtimeConfigurationRegion','bundleSha256','manifestSha256','report','privateMetadataSha256','privateMetadataBytes','privateMetadataMode','automaticRetryAuthorized'} or receipt['bundleSha256']!=a.approved_bundle_sha or receipt['manifestSha256']!=a.approved_manifest_sha or receipt['executionRegion']!='us-east-1' or receipt['runtimeConfigurationRegion']!='us-west-2':raise Refusal('receipt_identity')
        report=receipt['report']
        if not isinstance(report,dict) or set(report)!={'snapshotAt','complete','counts','unresolvedAttempts','reconciliation','measurements','providerCalls','memoryMutations','providerOutcomeProven','invoiceProven','activationAuthorized'}:raise Refusal('report')
        if type(report['complete']) is not bool or not isinstance(report['snapshotAt'],str) or not re.fullmatch(r'[0-9TZ.:+ -]{20,40}',report['snapshotAt']):raise Refusal('report')
        expected_counts={'profiles','domainCells','eligibleCells','ineligibleCells','currentCells','missingWork','pendingWork','invalidWork','missingVector','wrongHash','invalidGeometry','unexpectedVector','missingGeneration'}
        expected_measurements={'applicationStatements','reservedControlStatements','statementBudgetUnits','fieldPayloadBytes','rowsRead','elapsedMs'}
        for field,keys in [('counts',expected_counts),('measurements',expected_measurements)]:
            if not isinstance(report[field],dict) or set(report[field])!=keys or any(type(v) not in [int,float] or not 0<=v<1e12 for v in report[field].values()):raise Refusal('report_numbers')
        if any(report[k]!=0 or type(report[k]) is not int for k in ['providerCalls','memoryMutations']) or any(report[k] is not False for k in ['providerOutcomeProven','invoiceProven','activationAuthorized']):raise Refusal('report_effects')
        unresolved=report['unresolvedAttempts']
        if not isinstance(unresolved,dict) or set(unresolved)!={'reserved','received','unknown','total','resolutionRequired'} or any(type(unresolved[k]) is not int or not 0<=unresolved[k]<=1000 for k in ['reserved','received','unknown','total']) or type(unresolved['resolutionRequired']) is not bool or unresolved['total']!=unresolved['reserved']+unresolved['received']+unresolved['unknown'] or unresolved['resolutionRequired']!=(unresolved['total']>0):raise Refusal('report_unresolved')
        reconciliation=report['reconciliation']
        if reconciliation is not None:
            keys={'found','attempts','formattedBytes','reserved','received','unknown','committed','stale','httpFailed','http429','http4xx','http5xx','providerOutcomeProven','invoiceProven'}
            if not isinstance(reconciliation,dict) or set(reconciliation)!=keys or type(reconciliation['found']) is not bool or not isinstance(reconciliation['formattedBytes'],str) or not re.fullmatch(r'\d{1,20}',reconciliation['formattedBytes']) or any(reconciliation[k] is not False for k in ['providerOutcomeProven','invoiceProven']):raise Refusal('report_attempts')
            if any(type(reconciliation[k]) is not int or not 0<=reconciliation[k]<=1000 for k in keys-{'found','formattedBytes','providerOutcomeProven','invoiceProven'}):raise Refusal('report_attempts')
        if not re.fullmatch(r'[a-f0-9]{64}',receipt['privateMetadataSha256']) or type(receipt['privateMetadataBytes']) is not int or not 0<receipt['privateMetadataBytes']<=16384 or receipt['privateMetadataMode']!='0600' or receipt['automaticRetryAuthorized'] is not False:raise Refusal('private_report')
    else:
        if set(receipt)!={'passed','mode','executionRegion','runtimeConfigurationRegion','phase','code','sqlMayHaveStarted','memoryMutations','providerCalls','automaticRetryAuthorized'} or receipt['executionRegion'] not in [None,'us-east-1'] or receipt['runtimeConfigurationRegion'] not in [None,'us-west-2'] or (receipt['executionRegion'] is None)!=(receipt['runtimeConfigurationRegion'] is None) or receipt['phase'] not in ['approval','input','target','once','C0','private_report'] or receipt['code'] not in ['identity','scope','policy','foreign_manifest','domain_limit','source_limit','byte_limit','statement_limit','deadline','ledger_limit','read_bound','database_read','read_refused','statement_timeout','lock_timeout','readonly_violation','schema_mismatch','already_attempted'] or type(receipt['sqlMayHaveStarted']) is not bool or receipt['memoryMutations']!=0 or receipt['providerCalls']!=0 or receipt['automaticRetryAuthorized'] is not False:raise Refusal('failure_report')
    print(json.dumps(receipt,separators=(',',':')));return r.returncode

if __name__=='__main__':
    try:sys.exit(main())
    except Refusal as e:print(json.dumps({'passed':False,'code':e.code,'automaticRetryAuthorized':False}));sys.exit(1)
    except subprocess.TimeoutExpired:print(json.dumps({'passed':False,'code':'deadline','automaticRetryAuthorized':False}));sys.exit(1)
    except Exception:print(json.dumps({'passed':False,'code':'operator_refused','automaticRetryAuthorized':False}));sys.exit(1)
