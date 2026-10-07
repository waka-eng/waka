import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { targetFor } from '../lib/targets.mjs';
const target = targetFor(process.argv[2]);
const mobile = fileURLToPath(new URL('../', import.meta.url));
const build = spawnSync(process.execPath, ['scripts/build.mjs', target.environment], { cwd: mobile, stdio: 'inherit' });
if (build.error || build.status !== 0) process.exit(build.status ?? 1);
const sync = spawnSync('pnpm', ['exec', 'cap', 'sync'], {
  cwd: mobile, stdio: 'inherit', env: { ...process.env, WAKA_MOBILE_ENV: target.environment },
});
if (sync.error || sync.status !== 0) process.exit(sync.status ?? 1);
