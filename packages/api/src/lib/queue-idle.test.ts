/** WHAT THIS MOCKS, AND WHY (gate G6)
 * `./db.js` supplies queue reads only; fake timers prove that an idle local
 * worker stops. SQL eligibility is covered in queue-idle.db.test.ts.
 * Local scripts and SST are inspected to prevent recurring idle DB checks.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => {
  const limit = vi.fn();
  const query = { from() { return this; }, where() { return this; }, orderBy() { return this; }, limit };
  return { limit, select: vi.fn(() => query), execute: vi.fn() };
});
vi.mock('./db.js', () => ({ getDb: () => db }));
import { drainBackgroundJobs } from './queue.js';
beforeEach(() => {
  vi.useFakeTimers(); vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '1');
  db.select.mockClear(); db.limit.mockReset().mockResolvedValue([]); db.execute.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
it('does not query or schedule anything on import and stops after an empty queue read', async () => {
  expect(db.select).not.toHaveBeenCalled(); expect(db.execute).not.toHaveBeenCalled();
  await drainBackgroundJobs({ limit: 0 });
  expect(db.select).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(db.select).toHaveBeenCalledOnce(); expect(db.execute).not.toHaveBeenCalled();
});
it('sets one wake for actual pending work and stops once that work is gone', async () => {
  db.limit.mockResolvedValueOnce([{ runAfter: new Date(Date.now() + 5000) }]).mockResolvedValue([]);
  await drainBackgroundJobs({ limit: 0 });
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(5025);
  expect(db.execute).toHaveBeenCalledOnce(); expect(db.select).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(db.execute).toHaveBeenCalledOnce(); expect(db.select).toHaveBeenCalledTimes(2);
});
it('keeps local maintenance one-shot and infrastructure limited to the existing daily clocks', () => {
  const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
  const local = read('scripts/dev-local.sh');
  expect(local).not.toMatch(/nightly\s+--watch/);
  for (const path of ['tools/dev-stack/drain.ts', 'packages/api/src/nightly-local.ts']) {
    expect(read(path)).not.toMatch(/setInterval\s*\(|setTimeout\s*\(|WAKA_DRAIN_INTERVAL_MS/);
  }
  const schedules = [...read('sst.config.ts').matchAll(/new sst\.aws\.Cron\("([^"]+)",\s*\{\s*schedule:\s*"([^"]+)"/g)]
    .map(([, name, schedule]) => ({ name, schedule }));
  expect(schedules).toEqual([
    { name: 'PrincipleRefresh', schedule: 'cron(0 8 * * ? *)' },
    { name: 'BackgroundJobDrain', schedule: 'rate(1 day)' },
  ]);
});
it.each(['tools/dev-stack/drain.ts', 'packages/api/src/nightly-local.ts'])('refuses %s watch mode before opening a database', path => {
  const result = spawnSync(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), '--watch'], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DB_CONNECTION_URL: 'postgresql://unused@127.0.0.1:1/forbidden' },
    timeout: 5000, encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain('Periodic database checks are disabled');
});
