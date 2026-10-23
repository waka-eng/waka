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
  await press(page.locator('.waka-dock-item').filter({ hasText: /^New inspiration$/ }));
  await page.locator('.jar-composer-text').waitFor({ state: 'visible', timeout: 8_000 });
}

export async function saveAnInspiration(
  page: Page,
  text: string,
  options: { touch?: boolean } = {},
): Promise<void> {
  await openTheNotepad(page, options);
  await page.fill('.jar-composer-text', text);
  const save = page.getByRole('button', { name: 'Save inspiration', exact: true });
  if (options.touch) await save.tap(); else await save.click();
  await page.waitForTimeout(4_500);
}
