import {nextProbeState,probeStore,type ProbeStore} from './probe-state.js';
/** Only public liveness: no auth, memory DB, provider or arbitrary target input. */
async function check(url:'https://waka.im/'|'https://waka.im/api/health',kind:'web'|'api',fetcher:typeof fetch) {
  try {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'WAKA-Availability/1' } });
      if (response.status !== 200 || !response.body) return false;
      const reader = response.body.getReader(); let body = ''; let bytes = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 65536) return false; body += new TextDecoder().decode(part.value); } }
      finally { await reader.cancel(); }
      if (kind === 'api' ? JSON.parse(body).ok !== true : !body.includes('id="root"')) return false;
    return true;
  } catch { return false; }
}
export async function probe(fetcher: typeof fetch = fetch,store:ProbeStore=probeStore(process.env.MONITOR_TABLE??''),now=Date.now()):Promise<boolean> {
  if(!await check('https://waka.im/','web',fetcher))return false;
  const claim=await store.claim(now);
  if(!claim)return false; // A skipped/cooling API probe is degraded, never green.
  const healthy=await check('https://waka.im/api/health','api',fetcher);
  const state=nextProbeState(claim.prior,healthy,now);
  await store.settle(claim,state);
  return state.status==='healthy';
}
export async function handler() {
  let healthy:boolean;
  try { healthy=await probe(); } catch { throw Error('monitor_probe_state_unavailable'); }
  // Native Lambda Errors + Invocations cover failure and missing probes,
  // without creating another paid custom metric or retaining response bodies.
  if (!healthy) throw Error('monitor_public_liveness_failed');
  return { healthy };
}
