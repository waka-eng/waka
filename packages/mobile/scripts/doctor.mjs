import { spawnSync } from 'node:child_process';
import { androidEnvironment, simctlPath } from './toolchain.mjs';
const report = { node: process.version, android: {}, ios: {} };
try {
  const env = androidEnvironment();
  const java = spawnSync(`${env.JAVA_HOME}/bin/java`, ['-version'], { encoding: 'utf8' });
  const avds = spawnSync(`${env.ANDROID_SDK_ROOT}/emulator/emulator`, ['-list-avds'], { encoding: 'utf8', timeout: 15000 });
  report.android = { sdk: env.ANDROID_SDK_ROOT, jdk: env.JAVA_HOME, java: java.stderr.trim(), avds: avds.stdout.trim().split('\n').filter(Boolean), available: java.status === 0 && avds.status === 0 };
} catch (error) { report.android = { available: false, reason: error.message }; }
try {
  const runtimes = spawnSync(simctlPath(), ['list', 'runtimes', '-j'], { encoding: 'utf8', timeout: 15000 });
  const xcode = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8', timeout: 15000 });
  const setup = spawnSync('xcodebuild', ['-checkFirstLaunchStatus'], { encoding: 'utf8', timeout: 15000 });
  report.ios = { xcode: xcode.stdout.trim(), firstLaunchComplete: setup.status === 0,
    runtimes: JSON.parse(runtimes.stdout).runtimes.map(({ name, identifier, isAvailable }) => ({ name, identifier, isAvailable })),
    available: runtimes.status === 0 && xcode.status === 0 && setup.status === 0,
    ...(setup.status !== 0 ? {reason:'Complete Xcode first-launch component installation. An existing runtime alone does not prove SDK compatibility.'} : {}) };
} catch (error) { report.ios = { available: false, reason: error.message }; }
console.log(JSON.stringify(report, null, 2));
if (!report.android.available || !report.ios.available) process.exitCode = 1;
