import { expect, it, vi } from 'vitest';
import * as database from '../src/lib/db.js';
import { app } from '../src/index.js';

it('full public liveness makes no DB or model/network call; only 5xx produces a fault',async()=>{
  const db=vi.spyOn(database,'getDb').mockImplementation(()=>{throw Error('DB must stay asleep');});
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No outbound provider call'));
  const write=vi.spyOn(process.stdout,'write').mockReturnValue(true);
  vi.stubEnv('WAKA_STAGE','production');
  app.get('/api/__monitoring_test_failure',c=>c.json({error:'synthetic'},503));
  try{
    const response=await app.request('/api/health');expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true});
    expect(db).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
    expect((await app.request('/api/__monitoring_test_failure')).status).toBe(503);
    const metric=JSON.parse(String(write.mock.calls[0][0]));expect(metric.code).toBe('api_5xx');expect(JSON.stringify(metric)).not.toContain('synthetic');
  }finally{vi.restoreAllMocks();vi.unstubAllEnvs();}
});
