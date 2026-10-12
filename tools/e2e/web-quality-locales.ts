/**
 * THE NARROW LAYOUT, IN THE LANGUAGE THE ACCOUNT ACTUALLY ASKED FOR.
 *
 * A manual check rather than a gate — it has no `pnpm` script and writes
 * screenshots and an `audit.json` for a person to read. What it is for: the
 * Korean copy at 320 and 390, on the two surfaces a person meets first, with
 * the locale set through the product's own control rather than through a
 * query string. A translation that overflows its button is invisible to every
 * assertion in this repo and obvious in one screenshot.
 *
 * ── EVERYTHING IT REACHED FOR HAD MOVED, AND IT SAID NOTHING ──────────────
 *
 * Re-measured 2026-10-12 against `packages/web/src` as it stands. Five of the
 * things this file named do not exist:
 *
 *   `/profile`                   not a route since 2026-10-11 — founder: "I
 *                                want all setting-related stuff to be only
 *                                accessible through the drop down and not be
 *                                its own thing". It does not 404 either:
 *                                `main.tsx`'s `/:handle` route matches, and
 *                                `PublicProfile.tsx` answers
 *                                `<Navigate to="/" replace />` for a handle
 *                                with no `@`. So the walk landed on the world
 *                                and then looked for a form on it.
 *   `[name=preferredLocale]`     no control in the tree carries that name.
 *                                The language picker is a bare `<select>` in
 *                                `SettingsPanel.tsx`, inside
 *                                `.waka-account-field`.
 *   `profileLanguageSaved`       not a message key any more. There is no
 *                                save-confirmation status: the picker's
 *                                `onChange` writes the preference and the UI
 *                                re-renders in the new language, which is its
 *                                own confirmation.
 *   `.jar-personal-navigation`   no renderer. The row of four it held —
 *                                home, inspirations, principles, find — is
 *                                the dock now.
 *   `worldPersonalHome`,         three of the four labels it asserted are
 *   `worldPersonalInspirations`, gone from `en-US.json` and `ko-KR.json`.
 *   `worldPersonalFind`          Only `worldPrinciplesShortcut` survives, and
 *                                not in a navigation row.
 *
 * And two more that the first draft of this rewrite KEPT and then measured in
 * a browser, which is the only reason they were caught:
 *
 *   `.jar-mouth-rest` AS A DOOR   It is the CLOSED composer slot, and
 *                                `tools/e2e/keep.ts` is explicit about it:
 *                                "`opacity: 0`, and now `inert`… It was never
 *                                a door; it was a thing a gate could reach and
 *                                a person could not." Playwright refuses the
 *                                click — "`<div class=\"jar\">` intercepts
 *                                pointer events" — but NOT the
 *                                `waitFor({state:'visible'})` above it, because
 *                                `opacity: 0` is still visible to a browser.
 *                                So the wait passed and the click hung for
 *                                thirty seconds. The notepad is opened from
 *                                the dock's plus, through `openTheNotepad`,
 *                                which is where that fact is written down once.
 *   `.jar-composer-actions`      Zero on this surface. The composer's own
 *                                button row renders only around a recording
 *                                choice; Save left the page for the bar —
 *                                founder: "let's just have a save icon" — and
 *                                is `.waka-dock-tool--keep`, a glyph whose
 *                                name is on its `aria-label`.
 *
 * NONE OF THAT FAILED LOUDLY, which is the part worth recording. The first
 * `selectOption` threw on a page that had quietly redirected, so the run died
 * inside its own setup with a locator error — and the `finally` block then
 * threw a second time trying to set the language back, hiding the first. A
 * reader saw a Playwright timeout about `[name=preferredLocale]`, not "this
 * script tests a screen that was deleted".
 *
 * ── WHAT IT DOES NOW ──────────────────────────────────────────────────────
 *
 * The same claim, by the doors the product has. Set the language in the cog's
 * card; read the BAR's labels, because the bar is what replaced the row this
 * file was asserting; check each row is a 44px target inside the glass; open
 * the composer and check there is exactly one Save. Then set it back.
 *
 * The locale is confirmed by watching the product speak Korean rather than by
 * waiting for a status line that no longer exists — which is a stronger
 * check, since it fails if the preference is written and not applied.
 */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launchChromium} from './browser';
import {openTheNotepad} from './keep';
const origin='http://127.0.0.1:3015',output=resolve('work/web-quality/locales');
const meta=await (await fetch(`${origin}/fixture`)).json();assert.equal(meta.origin,origin);assert.match(meta.schema,/^waka_test_[a-f0-9]+$/);
const messages=JSON.parse(await readFile('packages/web/src/lib/i18n/messages/ko-KR.json','utf8'));
const english=JSON.parse(await readFile('packages/web/src/lib/i18n/messages/en-US.json','utf8'));
await mkdir(output,{recursive:true});const browser=await launchChromium({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
const page=await context.newPage();page.setDefaultTimeout(10000);const results:unknown[]=[];

/**
 * Set the account's language through the cog's card and wait for the product
 * to answer in it.
 *
 * BY THE MODIFIER, NOT `.first()`: the right corner has held two buttons
 * since 2026-10-11 — an "i" for how the product works beside the cog — and
 * the left corner has worn `.waka-corner` since there was a corner.
 */
async function chooseLanguage(code:string,dockNow:string):Promise<void>{
  await page.goto(origin);
  await page.locator('button.waka-corner--settings').click();
  await page.locator('.waka-account-field select').selectOption(code);
  /* THE PRODUCT SPEAKING IT IS THE CONFIRMATION. There is no status line to
     wait for; the bar's first row is the shortest thing on screen that is
     written in the chosen language, so it is what says the write landed AND
     was applied. */
  await page.locator('.waka-dock-item',{hasText:new RegExp(`^${dockNow}$`)}).first().waitFor({state:'visible'});
  await page.keyboard.press('Escape');
}

try{
  await page.request.get(`${origin}/fixture?account=primary`);
  await chooseLanguage('ko-KR',messages.worldDockHome);
  for(const size of [{width:320,height:568},{width:390,height:844}]){
    await page.setViewportSize(size);await page.goto(origin);
    /* THE BAR IS WHAT SAYS THE WORLD HAS FINISHED ARRIVING, and it is also
       what this walk measures — one wait, not two. */
    await page.locator('.waka-dock-item').first().waitFor({state:'visible'});
    /* ── THE BAR, WHICH IS WHAT `.jar-personal-navigation` BECAME ──────────
       The four nouns and the verb between them, in the founder's own order
       ("home, inspirations, conversations, and principles"). The plus is a
       glyph with its name on `aria-label`, so it is read from there and the
       words are read from the text — which is exactly how a person and a
       screen reader each get it. */
    const dock=page.locator('.waka-dock-item');
    const labels=await dock.evaluateAll(nodes=>nodes.map(node=>(node.textContent||'').trim()||node.getAttribute('aria-label')||''));
    assert.deepEqual(labels,[messages.worldDockHome,messages.worldDockSaves,messages.worldDockNew,messages.worldDockTalk,messages.worldDockPrinciples]);
    const targets=await dock.evaluateAll(nodes=>nodes.map(node=>{const rect=node.getBoundingClientRect();return {width:rect.width,height:rect.height,left:rect.left,right:rect.right};}));
    assert.ok(targets.every(rect=>rect.width>=44&&rect.height>=44&&rect.left>=0&&rect.right<=size.width));
    await page.screenshot({path:resolve(output,`ko-${size.width}-home.png`)});
    await openTheNotepad(page);const composer=page.locator('.jar-inspiration-composer');
    assert.equal(await composer.count(),1);
    await page.fill('.jar-composer-text','작게 시작하고 원할 때 다시 돌아보고 싶어요.');
    /* EXACTLY ONE SAVE, AND IT IS IN THE BAR. The claim is unchanged — there
       is one way to keep this and no "save as draft" beside it — and the
       control is a glyph now, so its name is read off `aria-label` the way a
       screen reader reads it. That is also the only place the Korean for it
       can be checked. */
    const keep=page.locator('.waka-dock-tool--keep');
    assert.equal(await keep.count(),1);
    assert.equal(await keep.getAttribute('aria-label'),messages.worldSaveInspiration);
    await page.screenshot({path:resolve(output,`ko-${size.width}-capture.png`)});await page.keyboard.press('Escape');
    results.push({viewport:size,labels,targets,singleSave:true});
  }
  await writeFile(resolve(output,'audit.json'),JSON.stringify({locale:'ko-KR',providerNetworkCalls:0,results},null,2));
  console.log(JSON.stringify({output,viewports:results.length,locale:'ko-KR'}));
}finally{
  /* PUT IT BACK, AND DO NOT LET THAT HIDE THE REAL FAILURE. The previous
     version's `finally` reached for the same dead control as its setup, so a
     failure in the body was replaced by a second, less informative one from
     the cleanup. A restore that throws is worth knowing about and is not the
     finding. */
  try{
    await page.setViewportSize({width:390,height:844});
    await chooseLanguage('en-US',english.worldDockHome);
  }catch(err){
    console.error('[locales] could not set the language back:',err instanceof Error?err.message:err);
  }
  await browser.close();
}
