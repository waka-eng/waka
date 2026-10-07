import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetFor } from '../lib/targets.mjs';
import { androidEnvironment } from './toolchain.mjs';

const platform = process.argv[2], target = targetFor(process.argv[3]);
if (!['ios', 'android'].includes(platform)) throw new Error('Choose ios or android.');
const mobile = fileURLToPath(new URL('../', import.meta.url));
const sync = spawnSync(process.execPath, ['scripts/sync.mjs', target.environment], { cwd: mobile, stdio: 'inherit' });
if (sync.error || sync.status !== 0) process.exit(sync.status ?? 1);
const metadata = JSON.parse(readFileSync(resolve(mobile, 'www/mobile-build.json'), 'utf8'));
if (metadata.appId !== target.appId || metadata.apiOrigin !== target.apiOrigin) throw new Error('Build target differs.');
let result, artifact;
if (platform === 'ios') {
  const output = resolve(mobile, `.build/ios-${target.environment}`);
  result = spawnSync('xcodebuild', ['-quiet', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App',
    '-configuration', target.environment === 'production' ? 'Release' : 'Debug', '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator', `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
    'ONLY_ACTIVE_ARCH=YES', '-derivedDataPath', output, 'CODE_SIGNING_ALLOWED=NO', 'build'], { cwd: mobile, stdio: 'inherit' });
  artifact = resolve(output, 'Build/Products', `${target.environment === 'production' ? 'Release' : 'Debug'}-iphonesimulator/App.app`);
} else {
  result = spawnSync('./gradlew', ['--no-daemon', target.environment === 'production' ? 'assembleRelease' : 'assembleDebug'], {
    cwd: resolve(mobile, 'android'), stdio: 'inherit', env: androidEnvironment(),
  });
  artifact = resolve(mobile, 'android/app/build/outputs/apk', target.environment === 'production' ? 'release/app-release-unsigned.apk' : 'debug/app-debug.apk');
}
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(resolve(mobile, '.build'), { recursive: true });
writeFileSync(resolve(mobile, `.build/${platform}-${target.environment}.json`), JSON.stringify({ platform, ...metadata, artifact }, null, 2) + '\n');
console.log(JSON.stringify({ platform, environment: target.environment, appId: target.appId, artifact }));
