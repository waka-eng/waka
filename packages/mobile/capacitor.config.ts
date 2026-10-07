import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error This small build configuration is shared with the Node scripts.
import { targetFor, capacitorConfiguration } from './lib/targets.mjs';

const environment = process.env.WAKA_MOBILE_ENV ?? 'production';
const target = targetFor(environment);
if (process.env.WAKA_MOBILE_INITIALIZE !== '1') {
  const built = JSON.parse(readFileSync(resolve('www/mobile-build.json'), 'utf8'));
  if (built.environment !== environment || built.appId !== target.appId || built.apiOrigin !== target.apiOrigin) {
    throw new Error('The web bundle and native app target differ. Run the matching sync:dev or sync:prod command.');
  }
}
export default capacitorConfiguration(target) satisfies CapacitorConfig;
