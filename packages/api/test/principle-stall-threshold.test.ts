/**
 * THE PAGE AND THE QUEUE AGREE ON WHAT "STALLED" MEANS.
 *
 * `PrincipleRead` (web) stops polling and offers Try again once a read has
 * waited past its stall time; the retry then asks the API to re-enqueue the
 * job, which it does only for a job unchanged for `PRINCIPLES_STALL_SECONDS`.
 * If the page stalled sooner than the server, Try again would land on a job
 * the server still calls running and reset nothing. The web constant cannot
 * be imported across packages, so its source is read and the numbers held
 * together here: the page's mirror equals the server's threshold, and the
 * page waits at least that long (plus a margin) before calling it stalled.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PRINCIPLES_STALL_SECONDS } from "../src/lib/queue.js";

const page = readFileSync(resolve(__dirname, "../../web/src/components/PrincipleRead.tsx"), "utf8");
function msConstant(name: string): number {
  const match = page.match(new RegExp(`const ${name} = ([\\d_ *]+);`));
  if (!match) throw new Error(`${name} is not a plain numeric constant in PrincipleRead.tsx`);
  return match[1]!.replace(/_/g, "").split("*").map((part) => Number(part.trim())).reduce((a, b) => a * b, 1);
}

describe("the principles stall threshold", () => {
  it("is the same number on the page and in the queue, and the page waits past it", () => {
    const mirrored = msConstant("PRINCIPLES_SERVER_STALL_MS");
    const margin = msConstant("PRINCIPLES_STALL_MARGIN_MS");
    expect(mirrored, "the page's mirror drifted from PRINCIPLES_STALL_SECONDS").toBe(PRINCIPLES_STALL_SECONDS * 1000);
    expect(margin).toBeGreaterThan(0);
  });
});
