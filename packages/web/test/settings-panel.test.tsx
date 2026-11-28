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
 * WHAT THIS MOCKS, AND WHY (gate G6): the export test replaces `fetch`
 * and the browser's object URL methods to verify a local download; other
 * cases use the real panel and catalogue without network access.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
/* Name, language, password, devices and Delete account sit behind the one
   Account row now (founder, 2026-11-27: "use more progressive disclosure"). */
async function renderAccount(props: Partial<SettingsPanelProps>): Promise<void> {
  await render(props);
  const row = host.querySelector<HTMLButtonElement>('button[data-settings-target="account"]');
  if (!row) throw new Error("Settings has no Account row");
  await act(async () => row.click());
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
  await renderAccount({ nameBusy: true });
  expect(nameField().disabled).toBe(false);
  expect(nameField().getAttribute("aria-busy")).toBe("true");
  expect(languageField().disabled, "a name write does not lock the language").toBe(false);
});

it("locks only the language while the language is being written", async () => {
  await renderAccount({ localeBusy: true });
  expect(languageField().disabled).toBe(true);
  expect(nameField().disabled).toBe(false);
});

it("explains permanent deletion and requires a separate confirmation in both languages", async () => {
  for (const locale of ["en-US", "ko-KR"] as const) {
    let deletes = 0;
    await renderAccount({ locale, onDeleteAccount: async () => { deletes += 1; } });
    const danger = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      /Delete account|계정 삭제/.test(b.textContent ?? ""),
    );
    if (!danger) throw new Error(`no delete disclosure in ${locale}`);
    await act(async () => danger.click());
    const hint = host.querySelector(".waka-settings-note")?.textContent ?? "";
    expect(hint, `${locale} still asks for a typed word`).not.toMatch(/DELETE|입력/);
    expect(hint).toMatch(locale === "en-US" ? /can’t be undone/ : /되돌릴 수 없어요/);
    const erase = host.querySelector<HTMLButtonElement>('.waka-settings-body button')!;
    await act(async () => erase.click());
    expect(deletes).toBe(0);
    expect(erase.textContent).toMatch(locale === 'en-US' ? /^Delete$/ : /^삭제$/);
    await act(async () => erase.click());
    expect(deletes).toBe(1);
    /* a fresh panel per language: the disclosure is a toggle, and pressing
       it again on a re-render would close it */
    await act(async () => root.unmount());
    root = createRoot(host);
  }
});

it("offers an owned JSON export and releases the temporary file URL on close", async () => {
  const download = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-profile-export");
  const release = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ export: { profile: { name: "Synthetic" } } })));
  vi.stubGlobal("fetch", fetchMock);
  try {
    await render({});
    /* One press downloads (founder, 2026-11-27: "it's just like stuck here
       ... I don't get the purpose of this"). */
    const started = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const prepare = [...host.querySelectorAll("button")].find(button => button.textContent === "Download my data");
    expect(prepare).toBeDefined();
    await act(async () => prepare?.click());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/export");
    expect(download).toHaveBeenCalledOnce();
    expect(started, "the download did not start on the one press").toHaveBeenCalledOnce();
    started.mockRestore();
    expect(host.querySelector('a[download="waka-profile.json"]')?.getAttribute("href")).toBe("blob:test-profile-export");
    await act(async () => root.render(null));
    expect(release).toHaveBeenCalledWith("blob:test-profile-export");
  } finally {
    vi.unstubAllGlobals();
    download.mockRestore();
    release.mockRestore();
  }
});

it("clears both fields when a password change is confirmed", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
  try {
    await renderAccount({});
    const open = host.querySelector<HTMLButtonElement>('button[data-settings-target="password"]');
    expect(open?.textContent).toContain("Change password");
    await act(async () => open?.click());
    const current = host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!;
    const replacement = host.querySelector<HTMLInputElement>('input[autocomplete="new-password"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      for (const [field, value] of [[current, "synthetic-current"], [replacement, "synthetic-replacement"]] as const) {
        setValue.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => current.form!.requestSubmit());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/me/password");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      currentPassword: "synthetic-current", newPassword: "synthetic-replacement",
    });
    expect(host.textContent).toContain("Password changed. Other sessions were signed out.");
    expect(current.value).toBe("");
    expect(replacement.value).toBe("");
  } finally {
    vi.unstubAllGlobals();
  }
});

/* "How WAKA works" is a Settings page (founder, 2026-11-27: "there's no way
   to go back. We can only close it and then open it again"): Back returns
   to Settings, never closes the card. */
it("opens How WAKA works as a Settings page, and Back returns to Settings", async () => {
  const onClose = vi.fn();
  await render({ onClose });
  const row = [...document.querySelectorAll<HTMLButtonElement>(".waka-settings-row")].find(button => button.textContent?.includes("How WAKA works"));
  expect(row, "Settings has no How WAKA works row").toBeTruthy();
  await act(async () => row!.click());
  expect(document.querySelector(".waka-surface-title")?.textContent).toBe("How WAKA works");
  expect(document.querySelector(".waka-about-steps"), "the steps did not open in Settings").not.toBeNull();
  const back = document.querySelector<HTMLButtonElement>(".waka-surface-back")!;
  expect(back.getAttribute("aria-label")).toBe("Back");
  await act(async () => back.click());
  expect(document.querySelector(".waka-surface-title")?.textContent).toBe("Settings");
  expect(onClose, "Back closed Settings instead of going back").not.toHaveBeenCalled();
});
