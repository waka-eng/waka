import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicBuildEnvironment, targetFor } from '../lib/targets.mjs';

const mobile = fileURLToPath(new URL('../', import.meta.url));
const root = resolve(mobile, '../..');
const target = targetFor(process.argv[2]);
const result = spawnSync('pnpm', ['--filter', '@waka/web', 'build', '--mode', `mobile-${target.environment}`], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ...publicBuildEnvironment(target) },
});
if (result.error || result.status !== 0) process.exit(result.status ?? 1);

const dist = resolve(root, 'packages/web/dist');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
// Compare values without printing them. .env files are disabled for this build;
// the check also covers sensitive values inherited in the caller's environment.
for (const path of files(dist)) {
  if (!/\.(html|js|css|json)$/.test(path)) continue;
  const source = readFileSync(path, 'utf8');
  for (const key of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'DB_CONNECTION_URL', 'JWT_SECRET', 'AUTH_SECRET']) {
    const value = process.env[key];
    if (value && value.length >= 12 && source.includes(value)) throw new Error(`Sensitive ${key} entered the mobile bundle.`);
  }
  if (target.environment === 'production' && source.includes('WAKA_M1_DIAGNOSTICS')) {
    throw new Error('Development diagnostics entered the production bundle.');
  }
}

mkdirSync(resolve(mobile, '.build'), { recursive: true });
const staging = resolve(mobile, `.build/staging-${Date.now()}-${process.pid}`);
cpSync(dist, staging, { recursive: true });
const licenses = [
  ['@capacitor/core', 'mobile'], ['@capacitor/ios', 'mobile'], ['@capacitor/android', 'mobile'],
  ['@capacitor/app', 'mobile'], ['@capacitor/browser', 'mobile'], ['@capacitor/filesystem', 'mobile'],
  ['@fontsource-variable/inter-tight', 'web'], ['@fontsource-variable/jost', 'web'],
  ['@fontsource-variable/caveat', 'web'], ['@fontsource-variable/fraunces', 'web'],
  ['@fontsource-variable/jetbrains-mono', 'web'], ['@fontsource/instrument-serif', 'web'], ['pretendard', 'web'],
];
mkdirSync(resolve(staging, 'licenses'), { recursive: true });
for (const [name, workspace] of licenses) {
  const directory = resolve(root, `packages/${workspace}/node_modules`, name);
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'OFL.txt', 'dist/LICENSE.txt'].map(file => resolve(directory, file)).find(existsSync);
  if (!license) throw new Error(`License text missing for ${name}.`);
  cpSync(license, resolve(staging, 'licenses', name.replace(/[@/]/g, '-') + '.txt'));
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const receipt = { ...target, commit: revision.stdout.trim(), builtAt: new Date().toISOString() };
writeFileSync(resolve(staging, 'mobile-build.json'), JSON.stringify(receipt, null, 2) + '\n');
if (existsSync(resolve(mobile, 'www'))) renameSync(resolve(mobile, 'www'), resolve(mobile, `.build/previous-${Date.now()}-${process.pid}`));
renameSync(staging, resolve(mobile, 'www'));
writeFileSync(resolve(mobile, '.build/target.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`Built ${target.appName}: ${target.apiOrigin}; packaged shared React assets.`);
