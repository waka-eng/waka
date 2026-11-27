// @vitest-environment jsdom
/**
 * THE INTRO CAN BE SKIPPED, AND SWIPED (founder, 2026-11-26, from the iOS
 * audit: "do all 6"). A quiet Skip top right goes straight on, the way
 * finishing the intro does; a horizontal swipe steps between its beats.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. `OnboardingIntro` is rendered
 * alone with fake timers, the way `Onboarding` mounts it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingIntro } from "../src/components/onboarding/OnboardingIntro";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

const beat = () => host.querySelector("main")?.getAttribute("data-beat");
const pointer = (type: string, clientX: number) => {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 300 });
  host.querySelector("main")!.dispatchEvent(event);
};

it("skips straight on from the first beat, and has no Skip on the last", async () => {
  const done = vi.fn();
  await act(async () => root.render(<OnboardingIntro locale="en-US" onDone={done} />));
  const skip = host.querySelector<HTMLButtonElement>(".onb-skip");
  expect(skip?.textContent).toBe("Skip");
  await act(async () => skip!.click());
  await act(async () => { vi.advanceTimersByTime(300); });
  expect(done, "Skip did not go on").toHaveBeenCalledTimes(1);
});

it("steps forward on a swipe left and back on a swipe right", async () => {
  await act(async () => root.render(<OnboardingIntro locale="en-US" onDone={() => undefined} />));
  expect(beat()).toBe("0");
  await act(async () => { pointer("pointerdown", 300); pointer("pointerup", 200); });
  expect(beat(), "a swipe left did not step on").toBe("1");
  await act(async () => { pointer("pointerdown", 100); pointer("pointerup", 120); });
  expect(beat(), "a small move stepped").toBe("1");
  await act(async () => { pointer("pointerdown", 100); pointer("pointerup", 220); });
  expect(beat(), "a swipe right did not step back").toBe("0");
  for (let i = 0; i < 3; i += 1) await act(async () => host.querySelector<HTMLButtonElement>(".onb-go")!.click());
  expect(host.querySelector(".onb-skip"), "Skip stood beside Start").toBeNull();
});
