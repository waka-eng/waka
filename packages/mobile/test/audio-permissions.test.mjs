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
