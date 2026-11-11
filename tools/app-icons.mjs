// Regenerate native launcher icons and the web touch icon from one vector mark.
// Run from any directory: node tools/app-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('packages/web/public/waka-icon.svg', root), 'utf8');
// The committed Playwright lockfile supplies this PNG codec (no global tool).
// Recheck regeneration when upgrading Playwright; iOS must have no alpha.
const require = createRequire(import.meta.resolve('playwright'));
const { PNG } = require('playwright-core/lib/utilsBundle');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  async function render(path, size, { foreground = false, round = false, opaque = false } = {}) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${source}`);
    await page.evaluate(({ foreground, round }) => {
      const svg = document.querySelector('svg');
      if (round) svg.style.borderRadius = '50%';
      if (foreground) {
        document.querySelector('#background').remove();
        document.querySelector('#mark').setAttribute('transform', 'translate(512 512) scale(.94) translate(-512 -512)');
      }
    }, { foreground, round });
    let data = await page.screenshot({ omitBackground: true });
    await page.close();
    const png = PNG.sync.read(data);
    let visible = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 128) visible++;
    if (visible < size * size * .1) throw new Error(`Icon did not render: ${path}`);
    if (opaque) data = PNG.sync.write(png, { colorType: 2 });
    await writeFile(new URL(path, root), data);
    console.log(`${size} × ${size}: ${path}`);
  }
  await render('packages/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024, { opaque: true });
  await render('packages/web/public/apple-touch-icon.png', 180, { opaque: true });
  for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    const directory = `packages/mobile/android/app/src/main/res/mipmap-${density}`;
    await render(`${directory}/ic_launcher.png`, size, { opaque: true });
    await render(`${directory}/ic_launcher_round.png`, size, { round: true });
    await render(`${directory}/ic_launcher_foreground.png`, size * 108 / 48, { foreground: true });
  }
} finally {
  await browser.close();
}
