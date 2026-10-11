/** WHAT THIS MOCKS, AND WHY: nothing. Read actual workflow/build manifests.
 * This is a cheap structural guard, not a browser or deployed timing claim. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');
it('keeps browser/model gates manual and includes loader/cache/request regressions in normal web tests',()=>{
  const workflow=read('../../../.github/workflows/ci.yml');
  expect(workflow).toContain("github.event_name == 'workflow_dispatch' && inputs.run_browser_gates == true");
  expect(workflow).toContain("github.event_name == 'workflow_dispatch' && inputs.run_model_evaluations == true");
  expect(workflow).toContain('pnpm --filter @waka/web test');
  const config=read('../vitest.config.ts');expect(config).toContain('test/**/*.test.ts');
  /* `review-session.test.tsx` was the fourth name here and is deleted with the
     review flow (2026-10-10). `home-navigation.test.tsx` takes its place rather
     than the list shrinking to three: what this line guards is that the
     EXPENSIVE suites — the ones that mount the world or walk a protocol — say
     what layer they replace, and dropping a name quietly lowers the bar the
     seam gate is holding. Home's navigation suite is the heaviest one left. */
  for(const file of ['home-request-budget.test.tsx','first-page-readiness.test.tsx','inspiration-snapshots.test.ts','home-navigation.test.tsx'])
    expect(read('./'+file)).toContain('WHAT THIS MOCKS');
  const manifest=JSON.parse(read('../../../package.json'));expect(manifest.scripts['perf:local']).toContain('tools/performance/run.ts');
  expect(workflow).not.toContain('pnpm perf:local');
});
it('requires search migration verification before automatic dev API deployment',()=>{
  const workflow=read('../../../.github/workflows/deploy-dev.yml'),verification=read('../../../scripts/verify-memory-schema.mjs');
  expect(workflow.indexOf('Apply development database migrations')).toBeLessThan(workflow.indexOf('Deploy SST development stage'));
  expect(workflow.indexOf('Verify development memory schema')).toBeLessThan(workflow.indexOf('Deploy SST development stage'));
  expect(verification).toContain('0067_inspiration_text_search.sql');
  expect(verification).toContain('inspirations.text_search_vector');
  expect(verification).toContain('inspirations_text_search');
});
it('keeps the minimum editing size outside a phone-only media query',()=>{
  const world=read('../src/styles/home.css'),chrome=read('../src/styles/chrome.css'),system=read('../src/styles/system.css');
  expect(system).toContain('--t-input: max(16px, var(--t-body))');
  expect(world).toMatch(/\.jar-mouth-field,\s*\.jar-panel-edit,\s*\.jar-reflect-box\s*\{\s*font-size: var\(--t-input\);/);
  expect(chrome).toMatch(/body textarea\s*\{[^}]*font-size: var\(--t-input\);/);
  expect(chrome).toMatch(/\.jar-inspiration-composer \.jar-composer-text\s*\{[^}]*font-size: var\(--t-input\);/);
});
it('keeps dev search maintenance manual, dry by default and fenced by actual deployed bindings',()=>{
  const workflow=read('../../../.github/workflows/maintain-dev-search.yml');
  expect(workflow).toMatch(/on:\s+workflow_dispatch:/);
  expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule):/m);
  expect(workflow).toMatch(/apply:[\s\S]*?default: false/);
  expect(workflow).toContain('secrets.DB_CONNECTION_URL_DEV');
  expect(workflow).toContain("assert.equal(configured,process.env.DB_CONNECTION_URL");
  expect(workflow.indexOf('Verify deployed dev database binding')).toBeLessThan(workflow.indexOf('Report or backfill bounded search metadata'));
  expect(workflow.indexOf('Verify migrated search schema')).toBeLessThan(workflow.indexOf('Report or backfill bounded search metadata'));
  expect(workflow).toContain("'--apply','--stage','dev','--expected-host'");
});
