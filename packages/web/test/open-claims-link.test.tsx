// @vitest-environment jsdom

/**
 * AN OLD `?open=claims` LINK THAT ARRIVES OFFLINE IS DROPPED.
 *
 * The three online cases are walked through the whole page in
 * `claim-correction.test.tsx`. Offline cannot be: `mountWorld` refuses a
 * world the offline fixture produced, on purpose. So this case drives the
 * hook `pages/Home` hands the decision to.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. The hook takes plain values
 * and two callbacks (spies here) and reads no module beneath it, so there
 * is no layer to replace.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useOpenClaimsLink } from "../src/lib/open-claims-link";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = { asked: boolean; offline: boolean; queueLoaded: boolean; toReview: number; consume: () => void; openReview: () => void };
function Probe(props: Props) { useOpenClaimsLink({ ready: true, ...props }); return null; }

let root: Root | null = null;
let container: HTMLDivElement | null = null;
function render(props: Props) {
  if (!container) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  act(() => root!.render(createElement(Probe, props)));
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

describe("an old claims link", () => {
  it("is dropped when it arrives offline, and a queue that loads after reconnecting does not open review", () => {
    const consume = vi.fn(); const openReview = vi.fn();
    render({ asked: true, offline: true, queueLoaded: false, toReview: 0, consume, openReview });
    expect(consume, "the address kept open=claims").toHaveBeenCalledTimes(1);
    render({ asked: false, offline: true, queueLoaded: false, toReview: 0, consume, openReview });
    render({ asked: false, offline: false, queueLoaded: true, toReview: 2, consume, openReview });
    expect(openReview, "review popped open on reconnect, long after the link").not.toHaveBeenCalled();
  });

  it("is dropped when the page goes offline while it waits for the queue", () => {
    const consume = vi.fn(); const openReview = vi.fn();
    render({ asked: true, offline: false, queueLoaded: false, toReview: 0, consume, openReview });
    render({ asked: false, offline: true, queueLoaded: false, toReview: 0, consume, openReview });
    render({ asked: false, offline: false, queueLoaded: true, toReview: 1, consume, openReview });
    expect(openReview).not.toHaveBeenCalled();
  });

  it("still waits for the queue's own load when online", () => {
    const consume = vi.fn(); const openReview = vi.fn();
    render({ asked: true, offline: false, queueLoaded: false, toReview: 0, consume, openReview });
    render({ asked: false, offline: false, queueLoaded: true, toReview: 1, consume, openReview });
    expect(openReview).toHaveBeenCalledTimes(1);
  });
});
