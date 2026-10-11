// @vitest-environment jsdom
/**
 * THE ANTECHAMBER, PINNED.
 *
 * goal: the-legible-loop, Phase 5. The dim place must render every refusal
 * with its anchor REACHABLE: while the anchor still refuses, "Put it back"
 * stands beside it — the restore verb, permanently housed; an anchor that
 * was since put back says so; an anchor truly deleted leaves its words as a
 * departed mark and offers nothing. The candidates render through the dim
 * class — light is the channel, and these are the sentences that did not
 * come to be.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The `rows` prop is a fixture in the
 * exact shape `/api/weather` serves (`the-weather.db.test.ts` pins that
 * truth against real rows); `onRestoreAnchor` is a vi.fn spy because the
 * write is the page's. Nothing else is replaced — real component, real
 * React, real (jsdom) document.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AntechamberPanel } from "../src/components/AntechamberPanel";
import type { ApiAntechamberRow } from "../src/lib/api";

let root: Root | null = null;
let host: HTMLElement | null = null;

function renderPanel(
  rows: ApiAntechamberRow[] | null,
  opts: {
    onRestoreAnchor?: (id: string) => void;
    restoredAnchorIds?: ReadonlySet<string>;
  } = {},
): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(
      <AntechamberPanel
        rows={rows}
        onClose={vi.fn()}
        onRestoreAnchor={opts.onRestoreAnchor ?? vi.fn()}
        restoredAnchorIds={opts.restoredAnchorIds ?? new Set()}
      />,
    );
  });
  return host;
}

const refusal = (over: Partial<ApiAntechamberRow> = {}): ApiAntechamberRow => ({
  id: "sup-1",
  candidateStatement: "Mornings are your best hours.",
  anchorSignalId: "sig-anchor",
  anchorStatement: "You are a morning person.",
  anchorStillRefusing: true,
  suppressedAt: "2026-08-23T09:00:00.000Z",
  ...over,
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("the antechamber", () => {
  it("stands each refused candidate in the dim class, its anchor named and reachable", () => {
    const onRestore = vi.fn();
    const el = renderPanel([refusal()], { onRestoreAnchor: onRestore });

    const candidate = el.querySelector(".jar-ante-candidate");
    expect(candidate?.textContent).toBe("Mornings are your best hours.");
    expect(el.textContent).toContain("Too close to: You are a morning person.");

    /* the anchor is reachable: the restore verb stands beside it */
    const restore = [...el.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Put it back",
    );
    expect(restore, "a still-refusing anchor must carry its way back").toBeTruthy();
    act(() => restore!.click());
    expect(onRestore).toHaveBeenCalledWith("sig-anchor");
  });

  it("tells a restored anchor and a departed one honestly, with no verb to nowhere", () => {
    const el = renderPanel(
      [
        refusal({ id: "sup-2", anchorSignalId: "sig-restored", anchorStillRefusing: false }),
        refusal({ id: "sup-3", anchorSignalId: null, anchorStillRefusing: false }),
      ],
      { restoredAnchorIds: new Set() },
    );

    expect(el.textContent).toContain("stands again");
    expect(el.textContent).toContain("since removed");
    const restores = [...el.querySelectorAll("button")].filter(
      (b) => (b.textContent ?? "").trim() === "Put it back",
    );
    expect(restores, "neither a restored nor a departed anchor offers restore").toHaveLength(0);
  });

  it("answers a put-back in the same beat through the session's own set", () => {
    const el = renderPanel([refusal()], {
      restoredAnchorIds: new Set(["sig-anchor"]),
    });
    expect(el.textContent).toContain("stands again");
    expect(
      [...el.querySelectorAll("button")].some(
        (b) => (b.textContent ?? "").trim() === "Put it back",
      ),
    ).toBe(false);
  });

  it("says the empty state and the pending state in words", () => {
    expect(renderPanel([]).textContent).toContain(
      "Nothing stands here — the ground has refused nothing",
    );
    act(() => root?.unmount());
    host?.remove();
    expect(renderPanel(null).textContent).toContain("Still fetching the refusals…");
  });
});
