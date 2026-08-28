/**
 * WHERE THE BROWSER IS, ASKED ONCE.
 *
 * Every gate in this directory needs a Chromium, and nine of them said so by
 * writing `executablePath: "/opt/pw-browsers/chromium"` — the path inside the
 * container they were written in. That is not a configuration, it is a
 * machine's name embedded in a test. On any other machine the launch throws
 * before a single assertion runs.
 *
 * It went unnoticed for exactly as long as CI did not work. The moment the
 * browser job actually executed (2026-08-27, after a workflow parse error and
 * an address-family mismatch were fixed), the gates that hardcoded the path
 * died on `Failed to launch chromium because executable doesn't exist at
 * /opt/pw-browsers/chromium` while the two that did not — `journeys` and
 * `first-paint` — ran fine. Same repo, same runner, same command; the only
 * difference was whether the file named its own machine.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER.
 *
 *   1. `WAKA_CHROMIUM_PATH`, then `PLAYWRIGHT_CHROMIUM` — an explicit answer
 *      always wins, because the person who set it knows something this file
 *      does not.
 *   2. Playwright's own resolution — which honours `PLAYWRIGHT_BROWSERS_PATH`
 *      and is how it finds the browser on a runner, in a devcontainer, and on
 *      a laptop. This is the answer that is right almost everywhere, which is
 *      why nothing needs to be set for it to work.
 *   3. `/opt/pw-browsers/chromium`, and ONLY IF IT IS ACTUALLY THERE. Some
 *      images lay the binary out flat like that, and Playwright will not find
 *      it on its own. `existsSync` is the whole difference between a fallback
 *      and a machine's name: it is used when it is true and skipped when it
 *      is not, rather than asserted and then failed on.
 */
import { existsSync } from "node:fs";

import { chromium, type Browser, type LaunchOptions } from "playwright";

/** A flat layout some images use; consulted only if the file is really there. */
const FLAT = "/opt/pw-browsers/chromium";

/** Which binary to launch, or `undefined` to let Playwright decide. */
export function chromiumPath(): string | undefined {
  const told = process.env.WAKA_CHROMIUM_PATH?.trim() || process.env.PLAYWRIGHT_CHROMIUM?.trim();
  if (told) return told;
  return undefined;
}

/**
 * Launch the browser these gates run in.
 *
 * @param opts anything the caller needs on top — headless, args, slowMo
 */
export async function launchChromium(opts: LaunchOptions = {}): Promise<Browser> {
  const told = chromiumPath();
  if (told) return chromium.launch({ ...opts, executablePath: told });
  try {
    return await chromium.launch(opts);
  } catch (err) {
    /* Playwright could not find one. If the flat layout is on this disk, that
       is the answer; otherwise the original error is the honest thing to
       raise — it names the install that is missing. */
    if (existsSync(FLAT)) return chromium.launch({ ...opts, executablePath: FLAT });
    throw err;
  }
}
