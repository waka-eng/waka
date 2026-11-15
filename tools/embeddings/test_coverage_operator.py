"""Offline wrapper faults. AWS, native tool and child seams are fake.
The success seam mocks URI hashing for one explicit synthetic URI only; it is
not target attestation. Actual unchanged hashes are used for all files. CLI
negative/source-input graph tests separately execute the real built Node entry.
"""
from contextlib import redirect_stdout
from datetime import datetime,timedelta,timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('coverage_wrapper',Path(__file__).with_name('coverage_operator.py'))
op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)
URI='postgres://synthetic:PRIVATE_FAKE@ep-synthetic-pooler.us-east-1.aws.neon.tech/fixture?sslmode=require'

class Tests(unittest.TestCase):
 def setup_call(self,d):
  m={'version':'embedding-coverage-v1','accountId':'10000000-0000-4000-8000-000000000001','profiles':[{'id':'30000000-0000-4000-8000-000000000001','epoch':'0','activeSpace':'gemini-embedding-001','activePolicy':'gemini-embedding-001.thresholds.v1','buildingSpace':None,'buildingPolicy':None}],'targetSpace':'waka.embedding.gemini-2.text-retrieval.v1.768.raw','approvedDbSha256':op.EXPECTED_DB_SHA,'expiresAt':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(timespec='milliseconds').replace('+00:00','Z'),'maxCells':10,'maxBytes':8388608,'maxStatements':100,'maxDurationMs':60000,'maxLedgerAttempts':100}
  manifest=Path(d)/'manifest.json';manifest.write_text(json.dumps(m,separators=(',',':')));manifest.chmod(0o600)
  bundle=Path(d)/'bundle.mjs';bundle.write_text('OFFLINE_C0_CHILD');bundleSha=op.digest(bundle.read_bytes());manifestSha=op.digest(manifest.read_bytes())
  args=['coverage_operator.py','--execute-reviewed','--bundle',str(bundle),'--manifest',str(manifest),'--invocation','20000000-0000-4000-8000-000000000001','--approved-bundle-sha',bundleSha,'--approved-manifest-sha',manifestSha,'--approved-operator-sha',op.digest(Path(op.__file__).read_bytes())]
  zero={'profiles':1,'domainCells':0,'eligibleCells':0,'ineligibleCells':0,'currentCells':0,'missingWork':0,'pendingWork':0,'invalidWork':0,'missingVector':0,'wrongHash':0,'invalidGeometry':0,'unexpectedVector':0,'missingGeneration':0}
  report={'snapshotAt':'2026-11-15 12:00:00+00','complete':True,'counts':zero,'unresolvedAttempts':{'reserved':0,'received':0,'unknown':0,'total':0,'resolutionRequired':False},'reconciliation':None,'measurements':{'applicationStatements':3,'reservedControlStatements':4,'statementBudgetUnits':7,'fieldPayloadBytes':1000,'rowsRead':2,'elapsedMs':1},'providerCalls':0,'memoryMutations':0,'providerOutcomeProven':False,'invoiceProven':False,'activationAuthorized':False}
  receipt={'passed':True,'mode':'C0','executionRegion':'us-east-1','runtimeConfigurationRegion':'us-west-2','bundleSha256':bundleSha,'manifestSha256':manifestSha,'report':report,'privateMetadataSha256':'a'*64,'privateMetadataBytes':200,'privateMetadataMode':'0600','automaticRetryAuthorized':False}
  runtime={'arn':op.ARN,'stage':'development','app':'{"name":"waka","stage":"development"}','db':URI}
  return args,runtime,receipt
 def test_bad_source_guard_before_any_tool_or_aws(self):
  with tempfile.TemporaryDirectory() as d:
   args,_,_=self.setup_call(d);args[-1]='0'*64
   with patch.object(op.sys,'argv',args),patch.object(op.subprocess,'check_output') as tool,patch.object(op,'aws') as aws:
    with self.assertRaises(op.Refusal) as c:op.main()
    self.assertEqual(c.exception.code,'source_guard');tool.assert_not_called();aws.assert_not_called()
 def test_fresh_target_mismatch_refuses_before_child(self):
  with tempfile.TemporaryDirectory() as d:
   args,runtime,_=self.setup_call(d)
   with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-east-1','AWS_DEFAULT_REGION':'us-east-1'}),patch.object(op.subprocess,'check_output',return_value='v20.20.2'),patch.object(op,'aws',side_effect=[{'account':op.ACCOUNT},runtime]),patch.object(op.subprocess,'run') as child:
    with self.assertRaises(op.Refusal) as c:op.main()
    self.assertEqual(c.exception.code,'independent_fingerprint');child.assert_not_called()
 def test_success_mock_has_no_provider_projection_no_child_credentials_and_no_wake(self):
  with tempfile.TemporaryDirectory() as d:
   args,runtime,receipt=self.setup_call(d);real=op.digest
   def digest(data):return op.EXPECTED_DB_SHA if data==URI.encode() else real(data)
   def child(argv,**kw):
    self.assertEqual(argv[0],'node');self.assertEqual(kw['env']['WAKA_BACKGROUND_JOB_AUTODRAIN'],'0');self.assertFalse(any('KEY' in k or (k.startswith('AWS_') and k not in ['AWS_REGION','AWS_DEFAULT_REGION']) for k in kw['env']));self.assertNotIn('apiKey',json.loads(kw['input']));self.assertEqual(kw['env']['AWS_REGION'],'us-east-1');self.assertEqual(json.loads(kw['input'])['attestation']['runtimeConfigurationRegion'],'us-west-2');return subprocess.CompletedProcess(argv,0,json.dumps(receipt),'PRIVATE_UNUSED_STDERR')
   with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-east-1','AWS_DEFAULT_REGION':'us-east-1','OPENROUTER_API_KEY':'PRIVATE_FAKE'}),patch.object(op.subprocess,'check_output',return_value='v20.20.2'),patch.object(op,'aws',side_effect=[{'account':op.ACCOUNT},runtime]) as aws,patch.object(op,'digest',side_effect=digest),patch.object(op.subprocess,'run',side_effect=child) as run:
    out=io.StringIO()
    with redirect_stdout(out):self.assertEqual(op.main(),0)
    self.assertNotIn('PRIVATE',out.getvalue());self.assertNotIn(URI,out.getvalue());self.assertEqual(aws.call_count,2);self.assertEqual(run.call_count,1)
    self.assertEqual(['us-west-2' in c.args[0] for c in aws.call_args_list],[True,True]);self.assertNotIn('KEY',' '.join(aws.call_args_list[1].args[0]));self.assertNotIn('invoke',' '.join(aws.call_args_list[1].args[0]))
 def test_rejects_unexpected_child_counts_and_does_not_print_raw_child(self):
  with tempfile.TemporaryDirectory() as d:
   args,runtime,receipt=self.setup_call(d);receipt['report']['counts']['sourceId']='PRIVATE_SOURCE';real=op.digest
   with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-east-1','AWS_DEFAULT_REGION':'us-east-1'}),patch.object(op.subprocess,'check_output',return_value='v20.20.2'),patch.object(op,'aws',side_effect=[{'account':op.ACCOUNT},runtime]),patch.object(op,'digest',side_effect=lambda b:op.EXPECTED_DB_SHA if b==URI.encode() else real(b)),patch.object(op.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(receipt),'')):
    out=io.StringIO()
    with redirect_stdout(out),self.assertRaises(op.Refusal):op.main()
    self.assertEqual(out.getvalue(),'')
 def test_wrong_native_region_refuses_before_any_tools(self):
  with tempfile.TemporaryDirectory() as d:
   args,_,_=self.setup_call(d)
   with patch.object(op.sys,'argv',args),patch.dict(os.environ,{'AWS_REGION':'us-west-2','AWS_DEFAULT_REGION':'us-west-2'}),patch.object(op.subprocess,'check_output') as tool:
    with self.assertRaises(op.Refusal) as c:op.main()
    self.assertEqual(c.exception.code,'native_region');tool.assert_not_called()
 def test_closed_aws_diagnostic_never_returns_unknown_stderr(self):
  with patch.object(op.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','PRIVATE_UNKNOWN_SECRET')):
   with self.assertRaises(op.Refusal) as c:op.aws(['fake'])
   self.assertEqual(c.exception.code,'aws_read_refused')
if __name__=='__main__':unittest.main()
