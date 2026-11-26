import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Capacitor's WebChromeClient requests both permissions for AUDIO_CAPTURE;
// an undeclared permission is denied before Android can present its prompt.
test('Android can request audio capture without requiring microphone hardware to install', () => {
  const manifest=readFileSync(new URL('../android/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
  for(const permission of ['RECORD_AUDIO','MODIFY_AUDIO_SETTINGS']) assert.match(manifest,new RegExp(`<uses-permission android:name="android.permission.${permission}"`));
  assert.match(manifest,/<uses-feature android:name="android.hardware.microphone" android:required="false"/);
});

test('iOS bundles Korean permission explanations and keeps the English fallback', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const project = read('../ios/App/App.xcodeproj/project.pbxproj');
  const korean = read('../ios/App/App/ko.lproj/InfoPlist.strings');
  const english = read('../ios/App/App/Info.plist');
  assert.match(project, /developmentRegion = en;/);
  assert.match(project, /knownRegions = \(\s*en,\s*Base,\s*ko,/);
  assert.match(project, /path = ko\.lproj\/InfoPlist\.strings;/);
  assert.match(project, /isa = PBXResourcesBuildPhase;[\s\S]*?files = \(\s*[\w]+ \/\* LaunchScreen\.storyboard in Resources \*\/,[\s\S]*?InfoPlist\.strings in Resources/);
  for (const key of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']) {
    assert.match(english, new RegExp(`<key>${key}</key>\\s*<string>[A-Za-z]`));
    assert.match(korean, new RegExp(`"${key}" = "[가-힣]`));
  }
});
