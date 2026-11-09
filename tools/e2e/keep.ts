/** Capture through the current dock, shared by browser journey checks. */
import type { Page } from "playwright";

export async function openTheNotepad(page: Page, { touch = false }: { touch?: boolean } = {}): Promise<void> {
  const press = async (target: ReturnType<Page["locator"]>) => {
    if (touch) await target.tap(); else await target.click();
  };
  // A page over home leaves by its header's "<" (the shared SurfaceHeader:
  // Back on a note, Close on a list); step out until home's bar is back.
  for (let turn = 0; turn < 3 && await page.locator('.waka-over').count(); turn += 1) {
    await press(page.locator('.waka-surface-back').last());
    await page.waitForTimeout(300);
  }
  // The home bar's pill: its field-like door "Keep a thought…". "Keep a
  // thought" also names the notepad's own field, so the bar is named too.
  await press(page.locator('.waka-home-bar-pill .waka-home-bar-field'));
  await page.locator('.jar-composer-text').waitFor({ state: 'visible', timeout: 8_000 });
}

export async function saveAnInspiration(
  page: Page,
  text: string,
  options: { touch?: boolean } = {},
): Promise<void> {
  await openTheNotepad(page, options);
  await page.fill('.jar-composer-text', text);
  // "Keep" is also the home bar's quiet verb and the home composer's send;
  // the notepad's own Keep is the dock tool.
  const save = page.locator('.waka-dock-tool--keep');
  if (options.touch) await save.tap(); else await save.click();
  await page.waitForTimeout(4_500);
}
