/**
 * THE OFFLINE FIXTURE — A WHOLE WORLD, AND NOT ONE TRUE THING IN IT.
 *
 * Twenty-four memories, four statements and one sentence at headquarters. No
 * person wrote any of them. They were typed into this file so that the entire
 * surface — every space, the field's whole colour range, the sky, the poster
 * and the peek row — can be LOOKED AT without a session, which is otherwise
 * impossible: a signed-out visitor sees a door, and a signed-in one sees only
 * their own archive.
 *
 * IF YOU CAME HERE BY ACCIDENT, YOU ARE ONE FILE OFF. The product's data
 * layer is `lib/data.ts` and its rows come from `lib/api.ts`. Nothing below
 * describes what the product does, holds or returns. It describes what the
 * screen falls back to when the product could not answer at all.
 *
 * IF YOU ARE A TEST AND YOU ARE READING THIS, YOU ARE ALREADY WRONG.
 *
 * G6 in `docs/goals/a-codebase-you-can-navigate.md` exists because of this
 * file. A suite once passed while describing it: it mocked `lib/api` instead
 * of `lib/data`, so the loader threw on the first shape it did not recognise,
 * the page caught that and did what it is built to do — replaced the world
 * with everything below — and every assertion then held, about a world no
 * product code had produced. It was caught only because the mock agent wall
 * is called "Course marketing" and the audit reported memories belonging to
 * nobody. So `offlineHome()` now says so out loud on its way past; see the
 * warning inside it, which is the alarm that was missing that day.
 *
 * THE FOUR RULES ARE IN `Home.tsx`, at the call site, because they are rules
 * about when this may be USED and only one of them can be enforced from here:
 * dev only, only on failure, never merged with real rows, and visibly marked
 * on screen. The one this file owns is the first — `offlineHome()` returns
 * null outside dev, and everything below is built INSIDE its body, so a build
 * whose API answers never allocates a single invented memory.
 *
 * WHY IT SITS BESIDE `agent-walls.ts` RATHER THAN INSIDE IT. They are two
 * different questions a reader arrives with. "Why do I see two agents I never
 * made?" is that file. "Why does a signed-out dev page show a year of
 * somebody's life?" is this one. They share nothing but a clock, and joining
 * them was what made one 854-line file that answered neither question until
 * you had read most of it.
 *
 * It needs `Adopted` and `Provenance` from the board, which is why it could
 * not have been extracted before those types left the page: reaching them
 * would have meant a `lib/ -> pages/` import, the exact edge this codebase
 * spent a refactor removing. Types first, then the thing that needs them.
 */
import type { Adopted, Provenance } from "../../space/top-of-mind/board";
import type { Inspiration, Signal, Evidence, Entry } from "../data";
import { DAY_MS } from "../num";
import { inventedDataAllowed } from "../dev-build";
import { daysAgo } from "./clock";

/** Everything the world is built from, when it is built from nothing. */
export interface OfflineHome {
  /** The ground: the field is made of these, and of nothing else. */
  inspirations: Inspiration[];
  /** The sky: signals still forming, each citing memories that exist. */
  signals: Signal[];
  /** Which signals rest on which memory — the field reads its meaning here. */
  citations: Map<string, Evidence[]>;
  /** The board headquarters stands on. */
  notes: Entry[];
  /** The poster. */
  adopted: Adopted;
  /** What the poster rests on — the peek row is elected out of this. */
  provenance: Provenance;
  /**
   * WHICH INVENTED PERSON THE VIEWER IS.
   *
   * Signed out there is no profile, so `viewerIdRef` was null and every
   * derivation that asks "is this one mine?" answered no about all of them.
   * That is not cosmetic on this surface: a room's ground is the members whose
   * id matches the viewer's (`onThisWall`), so all four fixture rooms stood
   * empty until you picked somebody out of the corner — the layout this file
   * exists to let a person LOOK AT was the one thing it could not show.
   *
   * The fixture already invents the member it calls "You". Naming it here is
   * what lets the page treat it as the viewer, so whose-is-whose works
   * offline exactly as it does with a session behind it.
   */
  viewerProfileId: string;
}

/** The quote a fixture signal took from a fixture memory, kept out of band
    so the two producers below can be written independently of each other. */
const OFFLINE_QUOTES = new Map<string, string>();

/** One capture, exactly as `GET /inspirations` hands one over. */
function offlineSignal(
  n: number,
  day: number,
  text: string,
  extra: {
    /** The words a signal carried out of it. Verbatim inside `text`, or the
        panel simply does not mark them — see markPassages. */
    quote?: string;
    /** The signals this memory fed. Real statements, and its light reads them. */
    fed?: string[];
    reflections?: number;
    /** Returned to since: an old memory that is honestly warm again. */
    touched?: number;
  } = {},
): Inspiration {
  /**
   * NEVER AT THE VERY INSTANT OF LOADING.
   *
   * The dial's present is fixed when the page mounts, which is a moment
   * BEFORE this world is built — so a memory dated `now` is dated after the
   * end of its own rail, does not exist at T, and is left out of the field
   * and out of the count. Six hours back is the nearest a memory is allowed
   * to be, and `agoWords` still says "Today" about it.
   */
  const back = (d: number) => daysAgo(Math.max(d, 0.25));
  const capturedAt = back(day);
  const id = `offline-m${n}`;
  if (extra.quote) OFFLINE_QUOTES.set(id, extra.quote);
  if (extra.fed?.length) OFFLINE_FED.set(id, extra.fed);
  return {
    id,
    preview: text,
    /* The fixture reads nothing, so it places nothing — which is also what
       the archive page should look like before a reading has happened. */
    category: null,
    /* the dev fixture keeps everything to itself */
    isPublic: false,
    kind: "note",
    source: "app",
    capturedMs: Date.parse(capturedAt),
    updatedMs: Date.parse(extra.touched === undefined ? capturedAt : back(extra.touched)),
    attachments: [],
    reflectionCount: extra.reflections ?? 0,
  };
}

/**
 * WRITTEN, AND NEVER READ.
 *
 * A memory's `fed` list is the fixture DECLARING which statements it fed.
 * That was the first way the citations further down were built, and it was
 * the wrong way: it let a memory claim a statement that did not cite it back,
 * a relationship the real sky cannot produce and therefore one no fixture
 * should be able to draw. Citations are now derived from the readings' own
 * evidence instead — see the loop inside `offlineHome()` — and this map is
 * what is left of the rejected approach.
 *
 * It is kept for the moment only because removing it means editing fifteen of
 * the rows below, and editing fixture rows in the same change that moves them
 * is how a mistake gets in without anyone seeing it. Nothing reads this. It
 * can be deleted, with the `fed` option, in a change of its own.
 */
const OFFLINE_FED = new Map<string, string[]>();

/**
 * One provisional reading — a candidate up in the sky, with the memories it
 * was drawn from named by id. Those ids are resolved against the archive the
 * same way a real one's are, so every satellite in orbit stands for a memory
 * that genuinely exists down in the field.
 */
function offlineReading(
  n: number,
  day: number,
  title: string,
  evidence: Array<[number, string | null]>,
): { signal: Signal; evidence: Evidence[] } {
  const at = Date.parse(daysAgo(day));
  return {
    signal: {
      id: `offline-p${n}`,
      statement: title,
      /* still overhead: a fixture has adopted nothing */
      status: "emerging",
      /* NOT SCORED, SO NOT CLAIMING A SCORE. Confidence is the server's
         reading of a signal; a fixture has no server, and inventing a
         plausible number would put a made-up value into the one channel this
         page reserves for meaning. Zero is "not scored", and the sky's layout
         then keeps the order the fixture declares. */
      confidence: 0,
      evidenceCount: evidence.length,
      lastEvidenceMs: at,
      createdMs: at,
      locked: false,
      unsupported: false,
      sharedGroupIds: [],
    },
    evidence: evidence.map(([m, quote]) => ({
      signalId: `offline-p${n}`,
      inspirationId: `offline-m${m}`,
      preview: "",
      quote,
      quoteSource: quote ? ("own" as const) : null,
      reason: null,
      createdMs: at,
    })),
  };
}

/**
 * THE WORLD, BUILT ONCE AND ONLY WHEN THERE IS NOTHING ELSE.
 *
 * Twenty-four memories across about three months, so the aliveness ramp has
 * its whole range to run: warm and close at the top, a middle band, and a
 * genuinely cold floor where the oldest draw together into sediment. A mix of
 * lengths, and Hangul throughout, because the archive this is standing in for
 * is majority Korean and Korean text is what has found the layout bugs.
 *
 * Returns null outside a dev build — and then the page's own failure line
 * stands, as it did before any of this existed.
 *
 * This used to ask `showsDebug()`, which also honours VITE_SHOW_INTERNAL, so a
 * production build made with that flag showed these invented memories to real
 * signed-out visitors. `inventedDataAllowed()` is `DEV` alone and exists so the
 * two rules cannot be confused again.
 */
export function offlineHome(): OfflineHome | null {
  if (!inventedDataAllowed()) return null;

  /**
   * THE LINE THAT WOULD HAVE CAUGHT IT.
   *
   * Everything below this point is invented, and until now the only way to
   * find that out was to notice it. A suite did not notice: it mocked the
   * wrong layer, the loader threw, the page fell down this path exactly as
   * designed, and the suite went green describing a world that no product
   * code had built. The test output said nothing at all.
   *
   * A warning rather than a throw, because this path is legitimate — it is
   * the whole reason the file exists — and ungated, because the guard above
   * has already established that this is a dev build or a test run. In a
   * normal run of the suite it never prints, since a correctly mocked test
   * never reaches here. If it prints, that is the finding.
   */
  console.warn(
    "[waka] THE DEV FIXTURE IS ON SCREEN. Every memory, statement and " +
      "sentence being drawn was typed into src/lib/fixture/, not loaded " +
      "from a server, and nothing here is written back to one. If you are " +
      "seeing this in a test run, that test is asserting against invented " +
      "data — mock lib/data, not lib/api.",
  );

  const R1 = "I am becoming someone who shows the thing instead of describing it.";
  const R2 = "The work I keep returning to is the work nobody asked me for.";
  const R3 = "I trust a surface more once I have watched it fail.";
  const R4 = "What I call taste is mostly a list of things I refuse to ship.";

  const inspirations: Inspiration[] = [
    offlineSignal(
      1,
      0,
      "빛이 유일한 의미 채널이라면 크기는 아무 말도 하면 안 된다. 오늘 화면에서 큰 공이 중요해 보였는데, 그건 내가 만든 거짓말이었다.",
    ),
    offlineSignal(
      2,
      1,
      "Showed it to J with no explanation at all and she had the depth of it in about four seconds. Every word I had prepared was a word I did not need.",
      {
        quote: "Every word I had prepared was a word I did not need.",
        fed: [R1],
        reflections: 1,
      },
    ),
    offlineSignal(
      3,
      2,
      "설명을 잘하는 사람이 되려고 십 년을 썼는데, 정작 필요한 건 설명이 필요 없는 화면이었다. 말로 이기는 습관이 제품을 망친다는 걸 오늘 아침에 처음으로 몸으로 이해했다.",
      { quote: "설명이 필요 없는 화면이었다", fed: [R1] },
    ),
    offlineSignal(4, 3, "Motion should explain the mechanism, or it is decoration."),
    offlineSignal(
      5,
      5,
      "Spent the afternoon defending a feature nobody had attacked. The honest version of that meeting is that I wanted to be told it was good, and I dressed the wanting up as a design review.",
      { quote: "I wanted to be told it was good", reflections: 2 },
    ),
    offlineSignal(
      6,
      7,
      "오래된 기억은 사라지는 게 아니라 차가워지는 것 — 이 한 문장 차이가 제품 전체를 결정한다.",
    ),
    offlineSignal(
      7,
      9,
      "A number on the screen is a claim I have to defend. Prose is a claim I can be wrong about gracefully.",
    ),
    offlineSignal(
      8,
      12,
      "Watched someone use it on a short phone and the bottom quarter of the field was simply empty. It passed on my machine and on the big monitor, which is exactly how a fixed reserve hides.",
      { fed: [R3] },
    ),
    offlineSignal(9, 15, "내가 확인하지 않은 것을 먼저 말하는 게 신뢰의 시작이다."),
    offlineSignal(
      10,
      18,
      "Deleted the six pastel tints today. Six hues that meant nothing were louder than one hue that meant something.",
      {
        quote: "Six hues that meant nothing were louder than one hue that meant something.",
        fed: [R4],
      },
    ),
    offlineSignal(
      11,
      22,
      "사람들이 저장하는 건 정보가 아니라 그때의 자기 자신이다. 그래서 목록으로 보여주면 아무 감흥이 없고, 쌓인 걸로 보여주면 갑자기 자기 얘기가 된다. 이걸 반년 걸려서 알았다.",
    ),
    offlineSignal(12, 26, "Stop asking what it does. Ask what it makes a person willing to say."),
    offlineSignal(
      13,
      30,
      "The thing I return to every week is not the roadmap. It is the one screen I built for myself over a weekend and never told anybody about.",
      { fed: [R2] },
    ),
    offlineSignal(
      14,
      34,
      "아무도 시키지 않은 일을 자꾸 하고 있으면 그게 방향이고, 시킨 일만 하고 있으면 그건 직업이다.",
      { fed: [R2] },
    ),
    offlineSignal(
      15,
      39,
      "Tried to write the pitch again and it came out as a list of features, again. The version that actually landed was me showing the screen and shutting up for ninety seconds.",
      {
        quote: "me showing the screen and shutting up for ninety seconds",
        fed: [R1],
        touched: 9,
      },
    ),
    offlineSignal(16, 44, "A tool I have never seen break is a tool I do not trust yet.", {
      fed: [R3],
    }),
    offlineSignal(17, 49, "취향이라고 부르는 것의 대부분은 안 하기로 한 것들의 목록이다.", {
      fed: [R4],
    }),
    offlineSignal(
      18,
      55,
      "Turned down the collaboration. It would have been good for the number and wrong for the thing.",
      { fed: [R4] },
    ),
    offlineSignal(
      19,
      61,
      "First honest session with someone who had never seen it. She scrolled to the bottom, sat there for a while, and said “this is a year of me”. I had built it as an archive and she read it as a portrait, and she was right.",
      { quote: "I had built it as an archive and she read it as a portrait" },
    ),
    offlineSignal(20, 67, "고장 나는 걸 한 번도 못 본 도구는 아직 믿을 수 없다.", { fed: [R3] }),
    offlineSignal(
      21,
      73,
      "Every product I have loved had one gesture I could do without looking. Everything else in them was menus.",
      { touched: 11 },
    ),
    offlineSignal(22, 79, "Kept the ugly version that ran.", { fed: [R4] }),
    offlineSignal(
      23,
      85,
      "설명서를 써야 이해되는 화면은 화면이 아니라 설명서다. 오늘에서야 그걸 인정했다.",
      { quote: "설명서를 써야 이해되는 화면은 화면이 아니라 설명서다" },
    ),
    offlineSignal(
      24,
      91,
      "Started this because I have four years of saved things and no idea who they say I am. That is the whole product, and I keep forgetting it and building something else instead.",
      { fed: [R2] },
    ),
  ];

  const readings = [
    offlineReading(1, 5, R1, [
      [2, "Every word I had prepared was a word I did not need."],
      [3, "설명이 필요 없는 화면이었다"],
      [15, "me showing the screen and shutting up for ninety seconds"],
      [23, null],
    ]),
    offlineReading(2, 12, R2, [
      [13, null],
      [14, null],
      [24, null],
    ]),
    offlineReading(3, 21, R3, [
      [8, null],
      [16, null],
      [20, null],
    ]),
    offlineReading(4, 30, R4, [
      [10, "Six hues that meant nothing were louder than one hue that meant something."],
      [17, null],
      [18, null],
      [22, null],
    ]),
  ];

  /* WHICH PATTERNS REST ON WHICH MEMORY, built the same way the real sky
     builds it: from the signals' own evidence, never declared per memory. */
  const citations = new Map<string, Evidence[]>();
  for (const r of readings) {
    for (const e of r.evidence) {
      const q = e.quote ?? OFFLINE_QUOTES.get(e.inspirationId) ?? null;
      const row = { ...e, quote: q };
      const got = citations.get(e.inspirationId);
      if (got) got.push(row);
      else citations.set(e.inspirationId, [row]);
    }
  }

  /* The board headquarters stands on: one artifact, and its entries cite the
     signals beneath them — layer 3 pointing at layer 2, never at memories. */
  const boardMs = Date.now() - 9 * DAY_MS;
  const notes: Entry[] = readings.map((r, i) => ({
    id: `offline-e${i + 1}`,
    type: "pattern" as const,
    body: r.signal.statement,
    belief: null,
    prompt: null,
    locked: false,
    pinned: i === 0,
    dismissed: false,
    sortOrder: i,
    /* unanswered, honestly: the offline visitor has said nothing yet, and
       dim grounds are the state that invites the answering */
    citedSignals: [{ id: r.signal.id, statement: r.signal.statement, answered: false, locked: false, contested: false }],
    createdMs: boardMs,
  }));

  /* What the poster rests on: the signals under it, in their own words. This
     is the peek row — not the newest few, but what led to what you are
     reading. It points at layer 2 because that is what an entry cites. */
  const provenance: Provenance = new Map(
    readings.map((r) => [r.signal.id, r.signal.statement] as const),
  );

  return {
    inspirations,
    signals: readings.map((r) => r.signal),
    citations,
    notes,
    /* the same id `Home`'s fixture rooms give their "You" member */
    viewerProfileId: "fx-you",
    adopted: {
      ambition: "I am making the surface that shows what I meant, so I stop having to explain it.",
      /* your own board, so there is no room to name */
      groupName: null,
      createdMs: boardMs,
    },
    provenance,
  };
}
