/** WHAT THIS MOCKS, AND WHY: nothing. Read deployment sources to prevent
 * unapproved stage enablement or a split API/worker configuration. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const sst=readFileSync(new URL('../../../sst.config.ts',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../../../.github/workflows/deploy-dev.yml',import.meta.url),'utf8');
const ci=readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8');
it('gates enablement to approved production/dev stages and retains an operator off switch',()=>{
  expect(sst).toContain('const isDevelopmentDomain = $app.stage === "development" || $app.stage === "dev"');
  expect(sst).toContain('WAKA_CONVERSATION_REPLIES: (isDevelopmentDomain || $app.stage === "production") && process.env.WAKA_CONVERSATION_REPLIES !== "0" ? "1" : "0"');
  expect(sst).toContain('WAKA_MODEL_CHAT: "deepseek/deepseek-v4.1-flash-1017"');
});
it('audits the new dev native chat pin while retaining the deliberate manual OR baseline',()=>{
  expect(workflow).toContain('.chatModel == "gpt-6.1-terra"');
  expect(workflow).toContain('node scripts/dev-gpt-config-audit.mjs');
  expect(ci).toContain('WAKA_MODEL_CHAT: deepseek/deepseek-v4.1-flash-1017');
  expect(ci).toContain('--expected-model=deepseek/deepseek-v4.1-flash-1017');
  expect(sst).toContain('OPENROUTER_GENERATION_MODEL: "deepseek/deepseek-v4.1-flash-1017"');
  expect(workflow).toContain('.generationModel == "deepseek/deepseek-v4.1-flash-1017"');
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
