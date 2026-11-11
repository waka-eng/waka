import {execFileSync} from 'node:child_process';
import {assertCheckoutSha,assertProductionRelease} from './release-policy.mjs';
try {
  const expectedSha=process.env.EXPECTED_RELEASE_SHA;
  const actualSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if(process.argv.includes('--checkout-only')) assertCheckoutSha(expectedSha,actualSha);
  else assertProductionRelease({checkResult:process.env.RELEASE_CHECK_RESULT,expectedSha,actualSha});
  console.log('Immutable checked commit verified.');
} catch { console.error('Release commit/CI verification failed; production operations refused.');process.exitCode=1; }
