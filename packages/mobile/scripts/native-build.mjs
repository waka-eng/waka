import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetFor } from '../lib/targets.mjs';
import { androidEnvironment } from './toolchain.mjs';

const platform = process.argv[2], target = targetFor(process.argv[3]);
if (!['ios', 'android'].includes(platform)) throw new Error('Choose ios or android.');
if (target.fixturePlatform && target.fixturePlatform !== platform) throw new Error('Fixture platform and build platform differ.');
const mobile = fileURLToPath(new URL('../', import.meta.url));
const sync = spawnSync(process.execPath, ['scripts/sync.mjs', target.environment], { cwd: mobile, stdio: 'inherit' });
if (sync.error || sync.status !== 0) process.exit(sync.status ?? 1);
const metadata = JSON.parse(readFileSync(resolve(mobile, 'www/mobile-build.json'), 'utf8'));
if (metadata.appId !== target.appId || metadata.apiOrigin !== target.apiOrigin) throw new Error('Build target differs.');
let result, artifact;
if (platform === 'ios') {
  const output = resolve(mobile, `.build/ios-${target.environment}`);
  mkdirSync(output, { recursive: true });
  const entitlements = resolve(output, 'simulator.entitlements');
  const fixturePlist = resolve(output, 'fixture-Info.plist');
  if (target.fixturePlatform) {
    const original = readFileSync(resolve(mobile, 'ios/App/App/Info.plist'), 'utf8');
    writeFileSync(fixturePlist, original.replace('</dict>\n</plist>', '<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>\n</dict>\n</plist>'));
  }
  // Xcode embeds simulated entitlements in the Mach-O simulator section; do
  // not manually codesign restricted iOS entitlements into a macOS signature.
  // Device/archive builds must use Apple's provisioned team identity instead.
  const associatedDomains = target.fixturePlatform ? '' : `<key>com.apple.developer.associated-domains</key><array><string>applinks:${new URL(target.webOrigin).hostname}</string></array>`;
  writeFileSync(entitlements, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>application-identifier</key><string>${target.appId}</string><key>keychain-access-groups</key><array><string>${target.appId}</string></array>${associatedDomains}</dict></plist>\n`);
  result = spawnSync('xcodebuild', ['-quiet', '-project', 'ios/App/App.xcodeproj', '-scheme', 'App',
    '-configuration', target.environment === 'production' ? 'Release' : 'Debug', '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator', `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`,
    'ONLY_ACTIVE_ARCH=YES', '-derivedDataPath', output, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', `CODE_SIGN_ENTITLEMENTS=${entitlements}`,
    ...(target.fixturePlatform ? [`PRODUCT_BUNDLE_IDENTIFIER=${target.appId}`, `WAKA_APP_NAME=${target.appName}`, `INFOPLIST_FILE=${fixturePlist}`] : []), 'build'], { cwd: mobile, stdio: 'inherit' });
  artifact = resolve(output, 'Build/Products', `${target.environment === 'production' ? 'Release' : 'Debug'}-iphonesimulator/App.app`);
} else {
  result = spawnSync('./gradlew', ['--no-daemon', ...(target.fixturePlatform ? ['-PwakaFixture=true'] : []), target.environment === 'production' ? 'assembleRelease' : 'assembleDebug'], {
    cwd: resolve(mobile, 'android'), stdio: 'inherit', env: androidEnvironment(),
  });
  artifact = resolve(mobile, 'android/app/build/outputs/apk', target.environment === 'production' ? 'release/app-release-unsigned.apk' : 'debug/app-debug.apk');
}
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(resolve(mobile, '.build'), { recursive: true });
writeFileSync(resolve(mobile, `.build/${platform}-${target.environment}.json`), JSON.stringify({ platform, ...metadata, artifact }, null, 2) + '\n');
console.log(JSON.stringify({ platform, environment: target.environment, appId: target.appId, artifact }));
