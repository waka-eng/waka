import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {targetFor} from '../lib/targets.mjs';
const app=resolve(process.env.SRCROOT,'App');
const metadata=JSON.parse(readFileSync(resolve(app,'public/mobile-build.json'),'utf8'));
if(metadata.fixturePlatform && metadata.fixturePlatform !== 'ios') throw new Error('Fixture platform differs.');
const target=targetFor(process.env.CONFIGURATION==='Release'?'production':'development',metadata.fixturePlatform ?? null);
const config=JSON.parse(readFileSync(resolve(app,'capacitor.config.json'),'utf8'));
if(process.env.PRODUCT_BUNDLE_IDENTIFIER!==target.appId||metadata.appId!==target.appId||metadata.apiOrigin!==target.apiOrigin||metadata.environment!==target.environment||config.appId!==target.appId||config.server?.url||config.loggingBehavior!=='none'||config.ios?.webContentsDebuggingEnabled!==target.diagnostics){
  throw new Error('iOS configuration and bundled WAKA target differ. Run the matching sync:dev or sync:prod command.');
}
console.log(`WAKA ${target.environment} bundle and native identity verified.`);
