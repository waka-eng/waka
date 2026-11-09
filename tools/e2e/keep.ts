/** Capture through the current dock, shared by browser journey checks. */
import type { Page } from "playwright";

export async function openTheNotepad(page: Page, { touch = false }: { touch?: boolean } = {}): Promise<void> {
  const press = async (target: ReturnType<Page["locator"]>) => {
    if (touch) await target.tap(); else await target.click();
  };
  // Lists own the dock until Close returns to the selected profile.
  if (await page.locator('.waka-over').count()) {
    await press(page.getByRole('button', { name: 'Close', exact: true }));
  }
  // The home bar's first door. "Keep a thought" also names the notepad's
  // own field and the principles page's add button, so the bar is named too.
  await press(page.locator('.waka-home-bar-door').filter({ hasText: /^a thought$/ }));
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
