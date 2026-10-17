// @vitest-environment jsdom
/**
 * THE SETTINGS PANEL'S NAME AND LANGUAGE WRITES, IN THE ORDER THEY WERE MEANT.
 *
 * The name field stays typeable while its autosave is out, which means a
 * second pause can send a second rename, and a language change can happen
 * between them. Each case below is one way that used to end wrong: the older
 * name left on the account, "busy" cleared by the wrong write, a failure lost
 * or reported by a write that no longer mattered, the old language put back
 * by a rename that carried it, and a name typed back to the original never
 * being written.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing but the two write functions
 * the hook is handed, which are `vi.fn`s holding their promises open so a
 * case decides when and in what order each one settles. `setTimeout` is
 * faked so the name's settle delay is an exact step rather than a sleep. The
 * hook itself runs unmocked in a real React root.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SupportedLocale } from "../src/lib/locales";
import { useSettingsWrites, type SettingsWritesInput } from "../src/lib/use-settings-writes";

interface Held { args: unknown[]; resolve: () => void; reject: () => void }
let names: Held[], locales: Held[];
let hook: ReturnType<typeof useSettingsWrites>;
let input: SettingsWritesInput;
let host: HTMLDivElement, root: Root;

const holding = (into: () => Held[]) => (...args: unknown[]) =>
  new Promise<void>((resolve, reject) => { into().push({ args, resolve, reject: () => reject(new Error("refused")) }); });

function Harness() { hook = useSettingsWrites(input); return null; }
const render = () => act(async () => root.render(<Harness />));
const type = async (value: string) => { await act(async () => hook.onName(value)); await act(async () => { vi.advanceTimersByTime(800); }); };
const flush = () => act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  names = []; locales = [];
  input = {
    accountName: "Alice",
    locale: "en-US",
    updateName: vi.fn(holding(() => names)),
    updateLocale: vi.fn(holding(() => locales)),
    settleMs: 700,
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("sends renames one at a time, so the newest name is the last to land", async () => {
  await type("Bo");
  await type("Bob");
  await flush();
  expect(names.map(row => row.args[0]), "the second rename left before the first answered").toEqual(["Bo"]);
  names[0]!.resolve(); await flush();
  expect(names.map(row => row.args[0])).toEqual(["Bo", "Bob"]);
});

it("keeps busy until the newest rename settles, and only it reports", async () => {
  await type("Bo");
  await type("Bob");
  await flush();
  expect(hook.nameBusy).toBe(true);
  names[0]!.reject(); await flush();
  expect(hook.nameBusy, "the first write cleared busy while the second was out").toBe(true);
  expect(hook.failed, "a superseded write reported a failure").toBe(false);
  names[1]!.reject(); await flush();
  expect(hook.nameBusy).toBe(false);
  expect(hook.failed, "the newest write's failure was lost").toBe(true);
});

it("sends the language wanted at the moment of sending, not when the name was typed", async () => {
  /* A language change queued ahead of a rename: the rename must carry the
     NEW language, or it puts the old one back when it lands. */
  await act(async () => hook.onLocale("ko-KR" as SupportedLocale));
  await type("Bob");
  locales[0]!.resolve(); await flush();
  expect(names[0]!.args).toEqual(["Bob", "ko-KR"]);
});

it("writes the old name back when it is typed back while a rename is out", async () => {
  await type("Bob");
  await type("Alice");
  names[0]!.resolve(); await flush();
  expect(names.map(row => row.args[0]), "typing the original back was skipped as no change").toEqual(["Bob", "Alice"]);
});
