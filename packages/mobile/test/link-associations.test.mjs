import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkAssociations } from '../lib/link-associations.mjs';
const certificate = Array(32).fill('AB').join(':');
test('association identities remain stage-specific and exclude API routes', () => {
  const dev = linkAssociations('development', 'TESTTEAM01', [certificate]);
  const prod = linkAssociations('production', 'TESTTEAM01', [certificate]);
  assert.equal(dev.apple.applinks.details[0].appIDs[0], 'TESTTEAM01.im.waka.app.dev');
  assert.equal(prod.android[0].target.package_name, 'im.waka.app');
  assert.ok(!dev.apple.applinks.details[0].components.some(component => component['/'].startsWith('/api')));
});
test('missing/invalid signing inputs never produce fake associations', () => {
  assert.throws(() => linkAssociations('development', undefined, [certificate]));
  assert.throws(() => linkAssociations('development', 'TESTTEAM01', ['not-a-certificate']));
  assert.throws(() => linkAssociations('staging', 'TESTTEAM01', [certificate]));
});
