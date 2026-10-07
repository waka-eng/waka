import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function androidEnvironment() {
  const sdk = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME, '/opt/homebrew/share/android-commandlinetools', resolve(homedir(), 'Library/Android/sdk')].find(path => path && existsSync(resolve(path, 'platforms/android-36/android.jar')));
  const java = [process.env.JAVA_HOME, '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'].find(path => path && existsSync(resolve(path, 'bin/java')));
  if (!sdk || !java) throw new Error('Android SDK 36 and a Gradle-compatible JDK (21 recommended) are required. Set ANDROID_SDK_ROOT and JAVA_HOME.');
  return { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, JAVA_HOME: java };
}
export function simctlPath() {
  const installed = '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl';
  if (!existsSync(installed)) throw new Error('CoreSimulator is not installed. Complete Xcode setup.');
  return installed;
}
