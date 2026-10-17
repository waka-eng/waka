// @vitest-environment jsdom
/**
 * THE SETTINGS PANEL'S TWO WRITES LOCK ONLY THEMSELVES, AND ITS DELETE SAYS
 * HOW IT IS CONFIRMED.
 *
 * One `busy` flag covered the name write and the language write, and it
 * disabled the name field — so the field went inert the moment its own
 * autosave fired, while the person was still typing. And the delete's hint
 * told people to "Type DELETE" into a box that does not exist: the
 * confirmation is a second press.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The panel only reaches the
 * network when its agents group is opened, and no case here opens it; the
 * catalogue is the real one, so the hint is read in the words people see.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { SettingsPanel, type SettingsPanelProps } from "../src/components/SettingsPanel";

let host: HTMLDivElement;
let root: Root;

const base: SettingsPanelProps = {
  locale: "en-US",
  email: "someone@example.test",
  name: "Someone",
  onName: () => undefined,
  onLocale: () => undefined,
  nameBusy: false,
  localeBusy: false,
  failed: false,
  onSignOut: () => undefined,
  onDeleteAccount: async () => undefined,
  onClose: () => undefined,
};

async function render(props: Partial<SettingsPanelProps>): Promise<void> {
  await act(async () => root.render(<SettingsPanel {...base} {...props} />));
}

const nameField = () => host.querySelector<HTMLInputElement>("input[autocomplete='name']")!;
const languageField = () => host.querySelector<HTMLSelectElement>("select")!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("keeps the name field typeable while its own write is in flight", async () => {
  await render({ nameBusy: true });
  expect(nameField().disabled).toBe(false);
  expect(nameField().getAttribute("aria-busy")).toBe("true");
  expect(languageField().disabled, "a name write does not lock the language").toBe(false);
});

it("locks only the language while the language is being written", async () => {
  await render({ localeBusy: true });
  expect(languageField().disabled).toBe(true);
  expect(nameField().disabled).toBe(false);
});

it("describes the two-press delete it actually has, in both languages", async () => {
  for (const locale of ["en-US", "ko-KR"] as const) {
    await render({ locale });
    const danger = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /Delete account|계정 삭제/.test(b.textContent ?? ""),
    );
    if (!danger) throw new Error(`no delete disclosure in ${locale}`);
    await act(async () => danger.click());
    const hint = host.querySelector(".waka-settings-note")?.textContent ?? "";
    expect(hint, `${locale} still asks for a typed word`).not.toMatch(/DELETE|입력/);
    expect(hint).toMatch(locale === "en-US" ? /Delete it anyway/ : /그래도 지우기/);
    /* a fresh panel per language: the disclosure is a toggle, and pressing
       it again on a re-render would close it */
    await act(async () => root.unmount());
    root = createRoot(host);
  }
});
