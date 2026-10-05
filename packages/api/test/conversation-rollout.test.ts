/** WHAT THIS MOCKS, AND WHY: nothing. Read deployment sources to prevent
 * accidental production enablement or a split API/worker configuration. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const sst=readFileSync(new URL('../../../sst.config.ts',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../../../.github/workflows/deploy-dev.yml',import.meta.url),'utf8');
const ci=readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8');
it('gates enablement by the existing dev-stage predicate and an operator off switch',()=>{
  expect(sst).toContain('const isDevelopmentDomain = $app.stage === "development" || $app.stage === "dev"');
  expect(sst).toContain('WAKA_CONVERSATION_REPLIES: isDevelopmentDomain && process.env.WAKA_CONVERSATION_REPLIES !== "0" ? "1" : "0"');
  expect(sst).toContain('...(isDevelopmentDomain\n        ? {\n            WAKA_MODEL_CHAT: "deepseek/deepseek-v4.1-flash"');
});
it('pins the deployed and evaluated chat model to the same DeepSeek version',()=>{
  expect(workflow).toContain('.chatModel == "deepseek/deepseek-v4.1-flash"');
  expect(ci).toContain('WAKA_MODEL_CHAT: deepseek/deepseek-v4.1-flash');
  expect(ci).toContain('--expected-model=deepseek/deepseek-v4.1-flash');
  expect(sst).toContain('OPENROUTER_GENERATION_MODEL: "deepseek/deepseek-v4.1-flash"');
  expect(workflow).toContain('.generationModel == "deepseek/deepseek-v4.1-flash"');
  expect(workflow).not.toContain('google/gemini-3.8-flash');
});
it('uses the same environment for API and background worker',()=>{
  expect(sst.match(/WAKA_CONVERSATION_REPLIES:/g)).toHaveLength(1);
  for(const name of ['BackgroundWorker','Api'])expect(sst.slice(sst.indexOf(`new sst.aws.Function("${name}"`)).split('\n    });')[0]).toMatch(/environment:\s*\{\s*\.\.\.runtimeEnvironment/);
});
it('allows a manual off deployment while automatic dev pushes enable the verified feature',()=>{
  expect(workflow).toContain('enable_conversation_replies:');expect(workflow).toContain("inputs.enable_conversation_replies == false && '0' || '1'");
  expect(workflow).toContain('Verify separate configured database targets');
  expect(workflow).toContain('Verify deployed chat configuration');expect(sst).toContain('apiFunctionName: api.name');expect(sst).toContain('backgroundWorkerFunctionName: backgroundWorker.name');
});
it('does not redeploy cloud resources for release evidence alone',()=>{
  expect(workflow).toContain("- 'docs/craft/evidence/**'");expect(workflow).toContain("- 'docs/goals/**'");expect(workflow).toContain("- 'docs/plans/**'");
  expect(workflow).not.toContain("- 'packages/**'");expect(workflow).not.toContain("- 'sst.config.ts'");
});
