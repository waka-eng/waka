// @vitest-environment jsdom
/**
 * SPEAKING INTO A NOTE, AND NOT LOSING WHAT IS ALREADY IN IT.
 *
 * Founder: "is it not possible to do speech to text easily, or is audio the
 * only easy way to record?" It is, and `use-dictation.ts` carries the
 * argument for why it is the better default. What that file has to get
 * right is narrower than the argument, and it is all about not losing
 * words:
 *
 *   AN ENGINE EMITS A GROWING GUESS and then a final for each utterance.
 *   Appending every event produces "I I think I think we" — the stutter
 *   every naive integration ships with.
 *
 *   WORDS ALREADY TYPED SURVIVE. Somebody may press the microphone
 *   mid-sentence; the spoken text joins what is there rather than
 *   replacing it, with exactly one space and never inside a word.
 *
 *   TWO ENGINE "ERRORS" ARE NOT ERRORS. `no-speech` fires when somebody
 *   opens the microphone and thinks for a moment; `aborted` fires when
 *   they stop it themselves. Reporting either would put a failure under a
 *   note for doing nothing wrong.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `window.SpeechRecognition` — the
 * browser API itself, which jsdom does not implement and which cannot be
 * driven from a test even where it exists, since it needs a microphone and
 * a person. The fake is a hand-held engine: the test plays the role of the
 * speech service and emits the events a real one emits. Nothing of this
 * product is mocked; the hook under test is the whole subject.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dictationAvailable, useDictation } from "../src/lib/use-dictation";

type Listener = ((event: unknown) => void) | null;

/** The engine a browser would supply, with the wires brought out. */
class FakeEngine {
  static live: FakeEngine | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  started = false;
  aborted = false;
  onresult: Listener = null;
  onerror: Listener = null;
  onend: (() => void) | null = null;
  constructor() { FakeEngine.live = this; }
  start() { this.started = true; }
  stop() { this.started = false; this.onend?.(); }
  abort() { this.aborted = true; this.started = false; }

  /**
   * Emit one utterance's worth of results, the way a real engine does.
   *
   * `results` IS CUMULATIVE AND `resultIndex` IS WHERE THE NEW ONES START —
   * that is the part of this API that is easy to fake wrongly, and faking
   * it wrongly produces a test that fails against correct code. A second
   * utterance arrives as a TWO-entry list with `resultIndex: 1`, not as a
   * one-entry list; the earlier entries are padded here so the hook's
   * `for (at = resultIndex; at < results.length)` has something to walk.
   */
  say(parts: Array<{ text: string; final: boolean }>, resultIndex = 0) {
    const earlier = Array.from({ length: resultIndex }, () =>
      Object.assign([{ transcript: "" }], { isFinal: true }),
    );
    const fresh = parts.map((part) =>
      Object.assign([{ transcript: part.text }], { isFinal: part.final }),
    );
    this.onresult?.({ resultIndex, results: [...earlier, ...fresh] });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  FakeEngine.live = null;
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeEngine;
});
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.restoreAllMocks();
});

/* A HOOK HARNESS IN SIX LINES, rather than a dependency. This package
   mounts components with `react-dom/client` everywhere else and has no
   testing-library in it; adding one for a hook with no DOM of its own
   would be a new dependency to buy a `renderHook`. */
const mounted: Root[] = [];
function dictate(before = "") {
  let text = before;
  let latest!: ReturnType<typeof useDictation>;
  const onText = vi.fn((next: string) => { text = next; });
  function Probe(): ReactNode {
    latest = useDictation(() => text, onText, "en-US");
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push(root);
  act(() => root.render(createElement(Probe)));
  return {
    onText,
    read: () => text,
    /** Read fresh each time: the hook's value is replaced on every render. */
    get now() { return latest; },
    unmount: () => act(() => root.unmount()),
  };
}

describe("speaking into a note", () => {
  it("is absent where the browser cannot transcribe, rather than broken", () => {
    expect(dictationAvailable()).toBe(true);
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    expect(dictationAvailable()).toBe(false);
  });

  it("asks for a continuous session with interim results, in the reader's language", () => {
    const d = dictate();
    act(() => d.now.start());
    expect(FakeEngine.live!.started).toBe(true);
    expect(FakeEngine.live!.continuous).toBe(true);
    expect(FakeEngine.live!.interimResults).toBe(true);
    expect(FakeEngine.live!.lang).toBe("en-US");
    expect(d.now.listening).toBe(true);
  });

  /* THE STUTTER CASE. A real engine emits the same utterance several times,
     growing, before marking it final. */
  it("replaces the growing guess instead of appending every version of it", () => {
    const d = dictate();
    act(() => d.now.start());
    act(() => FakeEngine.live!.say([{ text: "I think", final: false }]));
    expect(d.read()).toBe("I think");
    act(() => FakeEngine.live!.say([{ text: "I think we", final: false }]));
    expect(d.read()).toBe("I think we");
    act(() => FakeEngine.live!.say([{ text: "I think we should go", final: true }]));
    expect(d.read()).toBe("I think we should go");
    /* And the NEXT utterance builds on the settled one rather than wiping
       it — the second half of the same bug. */
    act(() => FakeEngine.live!.say([{ text: " tomorrow", final: false }], 1));
    expect(d.read()).toBe("I think we should go tomorrow");
  });

  it("joins what was already typed with exactly one space, and never mid-word", () => {
    const typed = dictate("dusk on the hill");
    act(() => typed.now.start());
    act(() => FakeEngine.live!.say([{ text: "and the light went", final: true }]));
    expect(typed.read()).toBe("dusk on the hill and the light went");

    /* Already ends in a space: no second one. */
    const spaced = dictate("dusk on the hill ");
    act(() => spaced.now.start());
    act(() => FakeEngine.live!.say([{ text: "and the light went", final: true }]));
    expect(spaced.read()).toBe("dusk on the hill and the light went");

    /* Empty note: no leading space. */
    const blank = dictate("");
    act(() => blank.now.start());
    act(() => FakeEngine.live!.say([{ text: "the light went", final: true }]));
    expect(blank.read()).toBe("the light went");
  });

  it("says nothing when somebody opens the microphone and thinks, or stops it themselves", () => {
    const d = dictate();
    act(() => d.now.start());
    act(() => FakeEngine.live!.onerror?.({ error: "no-speech" }));
    expect(d.now.error).toBe("");
    act(() => FakeEngine.live!.onerror?.({ error: "aborted" }));
    expect(d.now.error).toBe("");
  });

  it("separates a blocked microphone from a failure, because the fix is different", () => {
    const denied = dictate();
    act(() => denied.now.start());
    act(() => FakeEngine.live!.onerror?.({ error: "not-allowed" }));
    expect(denied.now.error).toBe("dictation-denied");
    expect(denied.now.listening).toBe(false);

    const broken = dictate();
    act(() => broken.now.start());
    act(() => FakeEngine.live!.onerror?.({ error: "network" }));
    expect(broken.now.error).toBe("dictation-failed");
  });

  /* THE ENGINE ENDS ON ITS OWN after a long silence, even in continuous
     mode. The words stay; the button goes back to offering. Restarting
     automatically would be a microphone that will not switch off. */
  it("stops listening when the engine ends by itself, and keeps every word", () => {
    const d = dictate();
    act(() => d.now.start());
    act(() => FakeEngine.live!.say([{ text: "a whole thought", final: true }]));
    act(() => FakeEngine.live!.onend?.());
    expect(d.now.listening).toBe(false);
    expect(d.read()).toBe("a whole thought");
  });

  /* THE CLOUD LINE IS SAID ONCE. Chrome sends speech to its own servers;
     saying so every time would be a notice nobody reads, and saying it
     never would be hiding it. The caller shows it only while `listening`,
     so a session fact that stays true is a one-time line on screen — what
     must not happen is it resetting and firing again. */
  it("flags the first dictation of the session and never a second time", () => {
    const d = dictate();
    act(() => d.now.start());
    expect(d.now.firstTime).toBe(true);
    act(() => d.now.stop());
    act(() => d.now.start());
    expect(d.now.firstTime).toBe(true);
  });

  /* ABORT, NOT STOP, ON UNMOUNT: stopping asks for one more final result,
     which would arrive after the component is gone. */
  it("releases the microphone on unmount without asking for a last result", () => {
    const d = dictate();
    act(() => d.now.start());
    const live = FakeEngine.live!;
    d.unmount();
    expect(live.aborted).toBe(true);
  });
});
