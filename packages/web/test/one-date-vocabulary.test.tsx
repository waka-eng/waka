// @vitest-environment jsdom
/** Shared formatting keeps month, date and clock labels consistent across surfaces.
 * WHAT THIS MOCKS, AND WHY (gate G6). Two network readers, at the seam where
 * rows enter the surface under test: `lib/api/principles` for the principle
 * cards and `lib/api/conversations` for the chat list. Nothing else — the real
 * components, the real `lib/words.ts`, the real catalogue and the real
 * `formatMessage` all run, because what is under test is the string a person
 * ends up reading. The source scan mocks nothing at all; it reads the tree off
 * disk the way `type-scale.test.ts` and `earned-not-declared.test.ts` do.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationsOverlay } from "../src/components/ConversationsOverlay";
import { PrincipleEvidence } from "../src/components/PrincipleEvidence";
import { PrinciplesOverlay } from "../src/components/PrinciplesOverlay";
import { ReviewEvidence } from "../src/components/ReviewEvidence";
import { agoWords, dateWords, momentTag, monthTag, timeOf } from "../src/lib/words";
import { fetchPrinciples } from "../src/lib/api/principles";
import { listConversations } from "../src/lib/api/conversations";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

/* ═══ GATE ONE: NOBODY FORMATS A DATE BUT THE VOCABULARY ══════════════════ */

/** The platform calls that turn a timestamp into words a person reads. */
const PLATFORM_DATE_CALLS = [
  "toLocaleDateString",
  "toLocaleTimeString",
  "Intl.DateTimeFormat",
  "Intl.RelativeTimeFormat",
] as const;

/**
 * The one file allowed to make them, relative to `src/`.
 *
 * IF THIS LIST EVER GROWS, THE RULE HAS BEEN ABANDONED rather than amended —
 * `lib/words.ts` says of itself that it is the one place the product's language
 * is decided, and a second holder makes that sentence false. The correct answer
 * to "my component needs a form that is not in there" is to put the form in
 * there, which is what `momentTag` is: `InspirationProcessingNotice` wanted a
 * short day-and-minute, so the module learned to say one.
 */
const VOCABULARY = ["lib/words.ts"];

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) everyFile(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The file with its prose removed.
 *
 * The same blanking `type-scale.test.ts` does to stylesheets, and needed for
 * the same reason, more sharply: the fix for this very defect left a comment in
 * `PrinciplesOverlay`, `ReviewEvidence`, `ConversationsOverlay`,
 * `AttachmentPreview` and `InspirationProcessingNotice` naming the call each
 * one used to make. A scan that counted those would read the tombstones as
 * bodies and fail on correct code — which is the kind of false alarm that gets
 * a gate deleted rather than obeyed.
 */
function body(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("one date vocabulary", () => {
  it("is the only place in the product that formats a date", () => {
    const offenders = everyFile(SRC)
      .map((full) => ({ name: relative(SRC, full), text: body(readFileSync(full, "utf8")) }))
      .filter(({ name }) => !VOCABULARY.includes(name))
      .flatMap(({ name, text }) =>
        PLATFORM_DATE_CALLS.filter((call) => text.includes(call)).map((call) => `${name} → ${call}`),
      );

    /* SPELLED OUT IN THE FAILURE, not counted. The nine that existed were
       found by a human reading the tree; the next one should arrive with its
       own file name attached, because the fix is "call the module" and the
       person who typed it needs to know which module and which line. */
    expect(offenders).toEqual([]);
  });

  it("still holds the forms every corrected surface needs", () => {
    /* THE OTHER HALF OF A BAN. A gate that only forbids pushes people to
       hand-roll `getMonth()` and a template literal, which it cannot see. So
       it is stated here that the module answers all four questions those nine
       components were asking — month, date, clock, and day-with-minute — and
       any fifth question is answered by adding a fifth function. */
    const ms = Date.UTC(2026, 9, 11, 14, 5);
    for (const locale of ["en-US", "ko-KR"] as const) {
      expect(monthTag(ms, locale)).toBeTruthy();
      expect(dateWords(ms, ms, locale)).toBeTruthy();
      expect(timeOf(ms, locale)).toBeTruthy();
      expect(momentTag(ms, ms, locale)).toBeTruthy();
    }
  });
});

/* ═══ GATE TWO: WHAT THE SURFACES ACTUALLY SAY, IN BOTH LANGUAGES ═════════ */

vi.mock("../src/lib/api/principles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api/principles")>()),
  fetchPrinciples: vi.fn(),
}));
vi.mock("../src/lib/api/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api/conversations")>()),
  listConversations: vi.fn(),
}));

/** The moment every expectation below is measured against. */
const HELD = Date.UTC(2026, 9, 11, 14, 5);
const ISO = new Date(HELD).toISOString();

const PRINCIPLE = {
  id: "p1",
  statement: "I would rather ship something ugly than wait for perfect.",
  type: "value" as const,
  state: "held" as const,
  origin: "minted" as const,
  rank: 1,
  locked: false,
  heldSince: ISO,
  conflictsWithId: null,
  citedSignals: [
    { id: "s1", statement: "You ship early.", examples: [{ text: "put it out tonight", createdAt: ISO }] },
  ],
  createdAt: ISO,
};

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.mocked(fetchPrinciples).mockResolvedValue([PRINCIPLE]);
  vi.mocked(listConversations).mockResolvedValue({
    profileId: "me",
    generationEnabled: true,
    conversations: [{ id: "c1", profileId: "me", revision: 1, updatedAt: ISO, preview: "about the hill" }],
  });
  /* THE CLOCK IS HELD AT THE SAME MOMENT THE ROWS CARRY, so "three days ago"
     cannot make a heading say `Today` on one run and a date on the next. Every
     words.ts function takes its `now` explicitly for exactly this reason; the
     surfaces reach for `Date.now()`, so the surfaces need it pinned. */
  vi.useFakeTimers({ now: HELD, toFake: ["Date"] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Everything on screen, with the whitespace React leaves between nodes gone. */
function said(): string {
  return (host.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn += 1) await act(async () => { await Promise.resolve(); });
}

const ENGLISH_MONTH_WITH_DIGIT_YEAR =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/;

describe("every surface that prints a date says it in the world's words", () => {
  it("uses written Korean dates and everyday expressions for elapsed days", () => {
    const now = new Date(2026, 10, 25, 12).getTime();
    const day = 86_400_000;
    expect(monthTag(now, "ko-KR")).toBe("2026년 11월");
    expect(agoWords(now - 3 * day, now, "ko-KR")).toBe("사흘 전");
    expect(agoWords(now - 21 * day, now, "ko-KR")).toBe("21일 전");
  });

  it.each(["en-US", "ko-KR"] as const)("shows only the personal Principle statement in %s", async (locale) => {
    const open = vi.fn();
    await act(async () => root.render(
      <PrinciplesOverlay locale={locale} profileId="me" name="Fixture Owner"
        title="Your principles" onClose={vi.fn()} onOpen={open} onShare={vi.fn()} />,
    ));
    await settle();

    const card = host.querySelector(".waka-held-card")!;
    expect(card.textContent).toBe(PRINCIPLE.statement);
    const buttons = card.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click());
    expect(open).toHaveBeenCalledWith(PRINCIPLE.id);
  });

  it("stamps a chat row's minute and its day heading from the module", async () => {
    for (const locale of ["en-US", "ko-KR"] as const) {
      await act(async () => root.render(
        <ConversationsOverlay locale={locale} profileId="me" title="Your chats"
          onClose={vi.fn()} onOpen={vi.fn()} />,
      ));
      await settle();
      /* The row's clock. `timeOf` hand-builds the Korean; the list used to
         hand-build it a second time out of `Intl` and the two agreed by
         accident. */
      expect(said()).toContain(timeOf(HELD, locale));
      if (locale === "en-US") expect(said()).not.toMatch(ENGLISH_MONTH_WITH_DIGIT_YEAR);
    }
  });

  it("dates both evidence footers under a principle alike", async () => {
    for (const locale of ["en-US", "ko-KR"] as const) {
      await act(async () => root.render(
        <>
          <PrincipleEvidence locale={locale} signals={PRINCIPLE.citedSignals} />
          <ReviewEvidence locale={locale} rows={[
            { answerId: "a1", preview: "what I actually wrote", createdAt: ISO,
              sessionId: "r1", questionId: "q1" } as never,
          ]} />
        </>,
      ));
      /* ONE STRING, TWICE. The two footers carried two hand-written option
         bags; if either drifts, one of these two occurrences disappears. */
      const wanted = dateWords(HELD, HELD, locale);
      expect(said().split(wanted)).toHaveLength(3);
    }
  });

});
