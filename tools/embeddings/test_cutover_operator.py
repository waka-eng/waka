"""Offline seams only. Actual JS schema/bundle tests live in the API CLI suite.
No AWS/DB/provider/credential read; URI fingerprint substitution is explicit.
"""
import importlib.util,io,json,os,subprocess,tempfile,unittest
from pathlib import Path
from contextlib import redirect_stdout
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('cutover_operator',Path(__file__).with_name('cutover_operator.py'));op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)
URI='postgresql://synthetic:PRIVATE_SENTINEL@ep-test-pooler.us-east-1.aws.neon.tech/test?sslmode=require'
class OperatorTest(unittest.TestCase):
 def setup_call(self,d,mode='C1'):
  p=Path(d);bundle=p/'bundle.mjs';bundle.write_text('offline only')
  intent={'version':'embedding-cutover-v1','approvedDbSha256':op.EXPECTED_DB_SHA,'expiresAt':'2099-01-01T00:00:00Z'}
  operation=intent if mode=='C1' else {'version':'embedding-cutover-read-v1','intent':{**intent,'expiresAt':'2020-01-01T00:00:00Z'},'intentSha256':'c'*64,'approvedDbSha256':op.EXPECTED_DB_SHA,'expiresAt':intent['expiresAt'],'maxDurationMs':5000}
  # New test-only window, not a real operation binding/expiry refresh.
  from datetime import datetime,timedelta,timezone
  operation['expiresAt']=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()
  file=p/'operation.json';file.write_text(json.dumps(operation,separators=(',',':')));file.chmod(0o600)
  sha=op.digest(file.read_bytes());bs=op.digest(bundle.read_bytes())
  args=['operator','--execute-reviewed','--bundle',str(bundle),'--operation',str(file),'--invocation','12345678-1234-4234-8234-123456789012','--approved-bundle-sha',bs,'--approved-operation-sha',sha,'--approved-operator-sha',op.digest(Path(op.__file__).read_bytes())]
  pre={'passed':True,'mode':'preflight','operationSha256':sha,'intentSha256':'c'*64,'operationKind':mode}
  runtime={'arn':op.ARN,'app':json.dumps({'name':'waka','stage':'development'}),'stage':'development','db':URI}
  receipt={'passed':True,'mode':mode,'executionRegion':'us-east-1','runtimeConfigurationRegion':'us-west-2','bundleSha256':bs,'operationSha256':sha,'intentSha256':'c'*64,'profiles':1,'outcome':'activated' if mode=='C1' else 'before_or_in_flight','providerCalls':0,'memoryTextMutations':0,'currentCoverageProven':False,'billingProven':False,'activationReplayAuthorized':False,'privateMetadataSha256':'a'*64,'privateMetadataBytes':300,'privateMetadataMode':'0600'}
  return args,pre,runtime,receipt
 def test_bad_source_before_any_tool(self):
  with tempfile.TemporaryDirectory() as d:
   args,*_=self.setup_call(d);args[-1]='0'*64
   with patch.object(op.sys,'argv',args),patch.object(op.subprocess,'check_output') as tool,patch.object(op,'aws') as aws:
    with self.assertRaises(op.Refusal):op.main()
    tool.assert_not_called();aws.assert_not_called()
 def test_schema_failure_before_aws(self):
  with tempfile.TemporaryDirectory() as d:
   args,*_=self.setup_call(d)
   with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-east-1','AWS_DEFAULT_REGION':'us-east-1'}),patch.object(op.subprocess,'check_output',return_value='v20.20.2'),patch.object(op.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'{}','PRIVATE_ERROR')),patch.object(op,'aws') as aws:
    with self.assertRaises(op.Refusal) as r:op.main()
    self.assertEqual(r.exception.code,'schema_preflight');aws.assert_not_called()
 def test_native_region_refuses_without_tools(self):
  with tempfile.TemporaryDirectory() as d:
   args,*_=self.setup_call(d)
   with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-west-2','AWS_DEFAULT_REGION':'us-west-2'}),patch.object(op.subprocess,'check_output') as tool:
    with self.assertRaises(op.Refusal) as r:op.main()
    self.assertEqual(r.exception.code,'native_region');tool.assert_not_called()
 def test_independent_mismatch_refuses_before_sql_child(self):
  with tempfile.TemporaryDirectory() as d:
   args,pre,runtime,_=self.setup_call(d)
   with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-east-1','AWS_DEFAULT_REGION':'us-east-1'}),patch.object(op.subprocess,'check_output',return_value='v20.20.2'),patch.object(op.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(pre),'')) as run,patch.object(op,'aws',side_effect=[{'account':op.ACCOUNT},runtime]):
    with self.assertRaises(op.Refusal) as r:op.main()
    self.assertEqual(r.exception.code,'independent_fingerprint');self.assertEqual(run.call_count,1)
 def test_success_and_read_are_keyless_no_wake_and_have_six_second_child_cap(self):
  for mode in ['C1','C1_reconcile']:
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
    args,pre,runtime,receipt=self.setup_call(d,mode);real=op.digest;events=[]
    def digest(b):return op.EXPECTED_DB_SHA if b==URI.encode() else real(b)
    def run(argv,**kw):
     events.append('preflight' if '--validate-operation' in argv else 'sql_child')
     if '--validate-operation' in argv:return subprocess.CompletedProcess(argv,0,json.dumps(pre),'')
     self.assertEqual(kw['env']['WAKA_BACKGROUND_JOB_AUTODRAIN'],'0');self.assertFalse(any('KEY' in k or k in ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'] for k in kw['env']));self.assertNotIn(URI,argv);self.assertEqual(json.loads(kw['input'])['attestation']['runtimeConfigurationRegion'],'us-west-2');return subprocess.CompletedProcess(argv,0,json.dumps(receipt),'PRIVATE_DISCARDED_STDERR')
    def aws(argv):
     self.assertIn('us-west-2',argv);events.append(argv[0]);self.assertNotIn('KEY',' '.join(argv));return {'account':op.ACCOUNT} if argv[0]=='sts' else runtime
    with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-east-1','AWS_DEFAULT_REGION':'us-east-1','OPENROUTER_API_KEY':'PRIVATE_KEY'}),patch.object(op.subprocess,'check_output',return_value='v20.20.2'),patch.object(op.subprocess,'run',side_effect=run),patch.object(op,'run_cutover_child',side_effect=lambda argv,**kw:(run(argv,**kw),False)),patch.object(op,'aws',side_effect=aws),patch.object(op,'digest',side_effect=digest):
     out=io.StringIO()
     with redirect_stdout(out):self.assertEqual(op.main(),0)
     self.assertEqual(events,['preflight','sts','lambda','sql_child']);self.assertNotIn('PRIVATE',out.getvalue());self.assertNotIn(URI,out.getvalue())
 def test_hard_timeout_preserves_actual_owned_child_exit_without_retry(self):
  from unittest.mock import MagicMock
  child=MagicMock();child.returncode=-9;child.communicate.side_effect=[subprocess.TimeoutExpired(['node'],6),('PRIVATE_OUTPUT','PRIVATE_ERROR')]
  with patch.object(op.subprocess,'Popen',return_value=child) as popen:
   result,timed=op.run_cutover_child(['node','fixed-reviewed-bundle'],input='PRIVATE_STDIN',env={})
   self.assertTrue(timed);self.assertEqual(result.returncode,-9);child.kill.assert_called_once();self.assertEqual(child.communicate.call_count,2);self.assertEqual(child.communicate.call_args_list[0].kwargs['timeout'],6);popen.assert_called_once()
 def test_nonzero_or_missing_child_receipt_is_unknown_even_with_success_shaped_stdout(self):
  with tempfile.TemporaryDirectory() as d:
   _,pre,_,r=self.setup_call(d)
   for result in [subprocess.CompletedProcess([],1,json.dumps(r),'PRIVATE_FATAL'),subprocess.CompletedProcess([],0,'','PRIVATE_FATAL')]:
    with self.assertRaises(op.Refusal) as c:op.receipt_acceptance(result,'C1',pre['operationSha256'],r['bundleSha256'],pre['intentSha256'])
    self.assertEqual(c.exception.code,'child_unknown')
 def test_no_unknown_receipt_fields_or_false_billing_coverage_claims(self):
  with tempfile.TemporaryDirectory() as d:
   _,pre,_,r=self.setup_call(d)
   for extra in [{'billingProven':True},{'currentCoverageProven':True},{'activationReplayAuthorized':True},{'privateRaw':'PRIVATE_WORDS'},{'mode':'C1_reconcile'}]:
    with self.assertRaises(op.Refusal):op.receipt_acceptance(subprocess.CompletedProcess([],0,json.dumps({**r,**extra}),''),'C1',pre['operationSha256'],r['bundleSha256'],pre['intentSha256'])
if __name__=='__main__':unittest.main()
