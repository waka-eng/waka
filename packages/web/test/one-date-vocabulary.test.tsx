// @vitest-environment jsdom
/**
 * ═══ ONE DATE VOCABULARY, AND NOBODY SPEAKING AROUND IT ═════════════════════
 *
 * `lib/words.ts` exists so that a fact becomes a phrase in exactly one place.
 * Its header states the law it was written to keep: *"This world says 'four
 * days ago' and 'you and your agent', never '4d' or '2 members' … Korean
 * counts use the native numerals a person says out loud (두 달, 사흘, 스무 날),
 * which is this module's own law — 'counts are prose here, never digits' —
 * kept in the other language."*
 *
 * NINE COMPONENTS WENT AROUND IT, each with its own `Intl` option bag, and two
 * of them printed the same fact the module prints, differently, in both
 * languages. Measured on 2026-10-11 against `ms = Date.UTC(2026, 9, 11, 14, 5)`:
 *
 *   | the fact                      | `lib/words.ts`              | the copy        |
 *   | month a thing is dated to, en | `October twenty twenty-six` | `October 2026`  |
 *   | the same, ko                  | `이천이십육년 시월`         | `2026년 10월`   |
 *   | a short date, en              | `Oct 11, 2026` (`dateStamp`)| `Oct 11`        |
 *   | a medium date, ko             | `2026년 10월 11일`          | `2026. 10. 11.` |
 *   | a bare clock, both            | `timeOf`                    | identical TODAY |
 *
 * The English broke the module's year rule. The Korean broke its own stated
 * law, on the proof line under a principle card — the one surface whose entire
 * value is that a stranger can read it and believe it.
 *
 * ── WHY THIS FILE EXISTS, WHICH IS THE WHOLE POINT ─────────────────────────
 *
 * THIS IS THE SECOND TIME. `Home.tsx:4356-4360` records the first:
 *
 *   "THE WORDS ARE `words.ts`'S, NOT THIS FILE'S. It carried a
 *   `toLocaleDateString('en-US')` and its own year rule, which was correct
 *   while the product spoke one language and silently wrong the moment it
 *   spoke two — a Korean wall labelling its rows in English."
 *
 * It was found by reading, fixed by hand, and nothing was left behind that
 * could find the next one — so nine more arrived. Every existing gate is
 * structurally blind here: `i18n.test.ts` asks for catalogue parity and
 * `copy.test.ts` asks whether every catalogue key is rendered, and NONE of
 * these strings ever enters the catalogue. `korean-reaches-the-screen.test.tsx`
 * is the right shape — mount it in Korean and fail on a Latin word — and would
 * still pass `2026년 10월`, because the defect is digits rather than English.
 *
 * ── SO THERE ARE TWO GATES HERE, AND THEY CATCH DIFFERENT MISTAKES ─────────
 *
 * THE SOURCE SCAN is the cheap one and it bites first, at the moment somebody
 * types `toLocaleDateString` in a component. It is the shape
 * `type-scale.test.ts` uses for `text-transform: uppercase` — the closest
 * working precedent in the tree — including its comment-blanking, because
 * three of the files corrected here now QUOTE the call they used to make, and
 * a gate that reads its own documentation as evidence reports work nobody did.
 *
 * It is a BAN WITH ONE NAMED HOLDER rather than a ratchet, which is the
 * opposite choice from `type-scale.test.ts`, and the difference is the size of
 * the honest allowlist. That file had ninety-five legitimate sites and said so:
 * "an allowlist that large is not a gate — it is a list of things the gate has
 * agreed not to look at." Here the legitimate count is ONE, by construction:
 * the module is the vocabulary. Nothing needs forgiving, so nothing is.
 *
 * THE RENDER GATE is the expensive one and catches what the scan cannot: a
 * component that formats a date by hand out of `getMonth()` and a template
 * literal, or one that calls the WRONG words function. It mounts the
 * date-bearing surfaces in BOTH locales and asserts the exact phrase
 * `lib/words.ts` would say — so a surface drifts only by changing this file,
 * and changing this file is a decision somebody has to defend.
 *
 * It also refuses a BARE FOUR-DIGIT YEAR on a month label specifically,
 * because that is the defect that shipped: `October 2026` and `2026년 10월`.
 * Note what this does NOT refuse — digits in a DATE. `dateWords` argues that
 * case at length and the founder's law does not reach it: "A DATE IS READ, NOT
 * COUNTED … that law is about STATES — a count of members, a score, a tally …
 * A calendar date is none of those." `dateStamp` says `2026년 10월 11일` and
 * that is correct. A gate that banned `\d{4}` everywhere would be enforcing a
 * rule this product deliberately does not hold.
 *
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
import { InspirationProcessingNotice } from "../src/components/InspirationProcessingNotice";
import { PrincipleEvidence } from "../src/components/PrincipleEvidence";
import { PrinciplesOverlay } from "../src/components/PrinciplesOverlay";
import { ReviewEvidence } from "../src/components/ReviewEvidence";
import { dateWords, momentTag, monthTag, timeOf } from "../src/lib/words";
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

/**
 * A FOUR-DIGIT YEAR STANDING BESIDE A MONTH, which is the exact shape that
 * shipped twice: `October 2026`, `2026년 10월`.
 *
 * It is deliberately narrow. A bare `\d{4}` would fire on `dateStamp`'s
 * `2026년 10월 11일` and on `Oct 11, 2026`, both of which are right — see this
 * file's header, and `dateWords`'s own argument that a date is read rather than
 * counted. What is forbidden is a year wearing a month and NO DAY, because that
 * is the register `monthTag` exists to speak and the only form it takes is
 * spelled out.
 */
const MONTH_WITH_DIGIT_YEAR = [
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/,
  /\b\d{4}년\s*\d{1,2}월(?!\s*\d)/,
];

describe("every surface that prints a date says it in the world's words", () => {
  it("dates a principle to a month the world speaks aloud, in both languages", async () => {
    for (const locale of ["en-US", "ko-KR"] as const) {
      await act(async () => root.render(
        <PrinciplesOverlay locale={locale} profileId="me" name="You"
          title="Your principles" onClose={vi.fn()} onOpen={vi.fn()} />,
      ));
      await settle();

      /* THE MEASURED EXPECTATION. `October twenty twenty-six` and
         `이천이십육년 시월` — not "contains a month name", which `October 2026`
         would also satisfy. */
      expect(said()).toContain(monthTag(HELD, locale));
      for (const shape of MONTH_WITH_DIGIT_YEAR) expect(said()).not.toMatch(shape);
      /* THE CARD CARRIES NOTHING ELSE DATED, and that is this surface's own
         ruling rather than an omission here — "one line each, and nothing
         else on the card … every number beside a sentence is something to
         read instead of the sentence". The evidence footers under a principle
         live on the page you press through to, and they have their own case
         below. */
    }
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
      for (const shape of MONTH_WITH_DIGIT_YEAR) expect(said()).not.toMatch(shape);
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

  it("names a scheduled reading's moment with the module's day and clock", async () => {
    for (const locale of ["en-US", "ko-KR"] as const) {
      await act(async () => root.render(
        <InspirationProcessingNotice locale={locale} onView={vi.fn()}
          processing={{
            active: true, phase: "waiting", busy: false,
            status: { phase: "waiting", stage: "reading", runAfter: ISO },
            check: vi.fn(), retry: vi.fn(), clear: vi.fn(),
          } as never} />,
      ));
      /* `Oct 11 at 7:05 AM` / `10월 11일 오전 7:05` — the day from `dateWords`
         and the minute from `timeOf`, so this notice cannot disagree with the
         clock an attachment two inches away is printing. */
      expect(said()).toContain(momentTag(HELD, HELD, locale));
      expect(said()).toContain(timeOf(HELD, locale));
    }
  });
});
