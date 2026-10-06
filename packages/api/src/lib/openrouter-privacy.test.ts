/** WHAT THIS MOCKS, AND WHY: `fetch` returns synthetic provider envelopes.
 * Real privacy configuration and request construction run, with no live call. */
import {afterEach,expect,it,vi} from 'vitest';
import {callOpenRouter,openRouterPrivacyPreferences} from './openrouter-http.js';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('unset or disabled overrides never weaken account-level restrictions',()=>{
  vi.stubEnv('WAKA_OPENROUTER_DATA_COLLECTION','');vi.stubEnv('WAKA_OPENROUTER_REQUIRE_ZDR','');expect(openRouterPrivacyPreferences()).toEqual({});
  vi.stubEnv('WAKA_OPENROUTER_REQUIRE_ZDR','0');expect(openRouterPrivacyPreferences()).toEqual({});
});
it('adds restrictive preferences without changing the caller or invoking a fallback',async()=>{
  vi.stubEnv('OPENROUTER_API_KEY','synthetic');vi.stubEnv('WAKA_OPENROUTER_DATA_COLLECTION','deny');vi.stubEnv('WAKA_OPENROUTER_REQUIRE_ZDR','1');
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({error:{message:'No eligible endpoint'}})));vi.stubGlobal('fetch',fetch);
  const input={model:'deepseek/deepseek-v4.1-flash',messages:[{role:'user' as const,content:'Synthetic'}]};
  expect(await callOpenRouter(input,'conversation reply')).toBeNull();expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({provider:{data_collection:'deny',zdr:true},model:input.model});
  expect(input).not.toHaveProperty('provider');
});
it.each([{collection:'allow',zdr:'0'},{collection:'deny',zdr:'yes'}])('refuses invalid policy before any dispatch %#',async({collection,zdr})=>{
  vi.stubEnv('OPENROUTER_API_KEY','synthetic');vi.stubEnv('WAKA_OPENROUTER_DATA_COLLECTION',collection);vi.stubEnv('WAKA_OPENROUTER_REQUIRE_ZDR',zdr);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(callOpenRouter({model:'deepseek/deepseek-v4.1-flash',messages:[]},'conversation reply')).rejects.toThrow('policy');
  expect(fetch).not.toHaveBeenCalled();
});
