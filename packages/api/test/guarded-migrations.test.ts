import {expect,it} from 'vitest';
import {resolve} from 'node:path';

it.each(['wrong',undefined])('refuses an unreviewed migration fingerprint (%s) before touching any SQL client',async fingerprint=>{
  const {runGuardedMigrations}=await import(/* @vite-ignore */ resolve(__dirname,'../../../tools/ops/guarded-migrations.mjs'));
  let touches=0;
  const client=new Proxy(()=>{touches++;throw Error('Unexpected SQL');},{get(){touches++;throw Error('Unexpected client initialization');}});
  await expect(runGuardedMigrations(client,{migrationFilesFingerprint:fingerprint})).rejects.toThrow('Migration files changed since reviewed rehearsal');
  expect(touches).toBe(0);
});
