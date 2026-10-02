import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../scripts/check-deployment-databases.mjs', import.meta.url));
const run = (development: string, production: string) => spawnSync(process.execPath, [script], {
  env: { ...process.env, DB_CONNECTION_URL: development, PRODUCTION_DB_CONNECTION_URL: production }, encoding: 'utf8',
});

it('accepts separate configured targets without logging either credential', () => {
  const result = run('postgres://owner:DEV_CREDENTIAL@ep-dev.neon.tech/neondb', 'postgres://owner:PROD_CREDENTIAL@ep-prod.neon.tech/neondb');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('endpoints differ');
  expect(result.stdout + result.stderr).not.toMatch(/DEV_CREDENTIAL|PROD_CREDENTIAL|ep-dev|ep-prod/);
});
it('refuses credentials-only differences and pooled/direct aliases of one target', () => {
  const result = run('postgres://alice:ONE@ep-same-pooler.neon.tech/neondb?sslmode=require', 'postgresql://bob:TWO@ep-same.neon.tech:5432/neondb');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('must be different');
  expect(result.stdout + result.stderr).not.toMatch(/alice|bob|ONE|TWO|ep-same/);
});
it.each(['', 'not-a-url', 'https://example.test/db', 'postgres://owner:SECRET@example.test/', 'postgres://owner:SECRET@example.test/db?host=other'])('fails closed on an invalid development target', (url) => {
  const result = run(url, 'postgres://owner:PROD_SECRET@ep-prod.neon.tech/neondb');
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).not.toMatch(/SECRET|PROD_SECRET/);
});
it('requires both stage configurations and permits different database names on one server', () => {
  expect(run('postgres://owner:pw@db.test/dev', '').status).toBe(1);
  expect(run('postgres://owner:pw@db.test/dev', 'postgres://owner:pw@db.test/prod').status).toBe(0);
});
