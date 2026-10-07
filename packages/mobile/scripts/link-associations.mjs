import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkAssociations } from '../lib/link-associations.mjs';
const associations = linkAssociations(process.argv[2], process.env.WAKA_APPLE_TEAM_ID,
  (process.env.WAKA_ANDROID_CERT_SHA256 ?? '').split(',').map(value => value.trim()).filter(Boolean));
// Stage-specific outputs for explicit deployment; never silently copy dev
// associations into production's shared public directory.
const output = fileURLToPath(new URL(`../.build/links-${process.argv[2]}/.well-known/`, import.meta.url));
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'apple-app-site-association'), JSON.stringify(associations.apple, null, 2));
writeFileSync(resolve(output, 'assetlinks.json'), JSON.stringify(associations.android, null, 2));
console.log(`Generated association documents for ${process.argv[2]}. Publish with application/json and no SPA fallback.`);
