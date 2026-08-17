/**
 * THE DEV FIXTURE — invented agents, and nothing real.
 *
 * Two mock agent walls so the design of a space that is not yours could be
 * SEEN before `GET /api/agents` existed. It is gated on `MOCK_AGENTS`, which
 * is dev-only on purpose: an unconditional `true` once shipped invented
 * memories into a production build, and a person cannot tell a fabricated
 * memory from one of their own.
 *
 * It lives here rather than in the page because it is DATA, and because 472
 * lines of it were sitting in the middle of the product surface between the
 * per-kind predicates and the sky's geometry. Nothing about it needs React,
 * the canvas or the network.
 *
 * It is self-contained by construction: it declares the wire shapes it
 * pretends to be (`ApiAgent*`, `AgentBundle`) rather than importing them, so
 * moving it created no import back into the page. The one thing it needs from
 * outside is `DAY_MS`. When `GET /api/agents` lands, the types here are the
 * contract to check the real ones against, and then this file goes.
 */

import { DAY_MS } from "./num";

/** Same rule Surface.tsx uses for the Debug pill. */
export function showsDebug(): boolean {
  const env = import.meta.env as Record<string, unknown>;
  return env.DEV === true || env.VITE_SHOW_INTERNAL === "1";
}

/**
 * ============================ FIXTURE, NOT DATA ============================
 *
 * The backend for agent profiles does not exist yet — agent ids and the MCP
 * tools are being built — and the founder's instruction is that the DESIGN can
 * and should be done now. So these two agents are drawn from the founder's own
 * examples in the meeting, and they are shaped EXACTLY like the contract the
 * plan proposes so that the swap is one line: delete `MOCK_AGENTS`, point
 * `loadAgentWalls` at the four endpoints, and nothing below this block changes.
 *
 *   GET /api/agents                  → ApiAgentSummary[]
 *   GET /api/agents/:id/direction    → ApiAgentDirection   (current + history[])
 *   GET /api/agents/:id/top-of-mind  → ApiAgentTopOfMind   (its sky)
 *   GET /api/agents/:id/inspirations      → ApiAgentSignal[]    (origin, producedBy)
 *
 * Set this to false and every agent wall disappears, along with the lens (which
 * has only one origin left to show) — the page is exactly what it was.
 *
 * ==========================================================================
 */
/* Mock agent walls exist so the direction can be SEEN before the API exists.
   Dev-gated on purpose: an unconditional true shipped invented memories into a
   production build. Replaced by GET /api/agents when that lands. */
export const MOCK_AGENTS = import.meta.env.DEV === true || import.meta.env.VITE_SHOW_INTERNAL === "1";

export interface ApiAgentSummary {
  id: string;
  name: string;
  kind: "agent";
  createdAt: string;
}

/** The same shape a room's direction has, so the HQ renderer is reused. */
export interface ApiAgentDirectionReading {
  ambition: string;
  /** what it stopped doing — the costliest thing a self-description can carry */
  awayFrom: string | null;
  /**
   * The memories this reading was built from. It is what lifts into the peek
   * row, so a claim with nothing here has a genuinely empty band under it —
   * which is the single most load-bearing refusal on the screen. An
   * unsupported claim must look like an unsupported claim.
   */
  groundedIn: string[];
  createdAt: string;
}

export interface ApiAgentDirection {
  current: ApiAgentDirectionReading | null;
  /** THE DIAL HAS NOTHING TO SCRUB WITHOUT THIS. Real createdAts, oldest first. */
  history: ApiAgentDirectionReading[];
}

export interface ApiAgentTopOfMindNote {
  id: string;
  title: string;
  isProvisional: boolean;
  createdAt: string;
  evidenceSignalIds: string[];
}

export interface ApiAgentTopOfMind {
  notes: ApiAgentTopOfMindNote[];
}

/**
 * One memory an agent chose to keep. `producedBy` is THE IMPORTANT ONE: without
 * a pointer at the work it came out of, and a short reason, the provenance
 * orbit has nothing to draw and "얘가 이걸 만든 이유가 이거다" cannot be
 * rendered at all. `why` must fit one satellite line — the layout clips, and a
 * paragraph there is unrenderable.
 */
export interface ApiAgentSignal {
  id: string;
  agentId: string;
  /* WHOSE MEMORY THIS IS, on a wall that holds several people's. Absent on
     your own and on an agent's wall, where the wall itself is the answer;
     present in a room, where it is the fact the per-member hue reads. */
  ownerProfileId?: string;
  ownerName?: string;
  origin: "agent" | "human";
  textPreview: string;
  quote: string | null;
  kind: string | null;
  capturedAt: string;
  updatedAt: string;
  /**
   * WHAT WORK THIS CAME OUT OF — and it is nullable because the backend has no
   * concept of an agent's OUTPUT yet. The founder wants to enter this world
   * from something an agent produced ("which signals and top of mind led to
   * this decision") and walk backwards; nothing in the data model records that
   * an agent made anything. Until it does, a real agent memory carries null
   * here and the orbit draws no "why", rather than a fabricated one.
   */
  producedBy: { ref: string; label: string; why: string } | null;
}

export interface AgentBundle {
  agent: ApiAgentSummary;
  direction: ApiAgentDirection;
  topOfMind: ApiAgentTopOfMind;
  inspirations: ApiAgentSignal[];
}

export const daysAgo = (d: number): string => new Date(Date.now() - d * DAY_MS).toISOString();

export function mockSignal(
  agentId: string,
  n: number,
  day: number,
  text: string,
  label: string,
  why: string,
  quote: string | null = null,
): ApiAgentSignal {
  return {
    id: `${agentId}-m${n}`,
    agentId,
    origin: "agent",
    textPreview: text,
    quote,
    kind: "note",
    capturedAt: daysAgo(day),
    updatedAt: daysAgo(day),
    producedBy: { ref: `${agentId}/run/${n}`, label, why },
  };
}

/** The two walls, exactly as the four endpoints would hand them over. */
export const MOCK_AGENT_BUNDLES: AgentBundle[] = [
  {
    agent: {
      id: "ouroboros-maintainer",
      name: "Ouroboros maintainer",
      kind: "agent",
      createdAt: daysAgo(61),
    },
    direction: {
      current: {
        ambition: "I keep the version that survives the runtime it ships on.",
        awayFrom: "I stopped promising a fix I had only run in my head.",
        groundedIn: [
          "ouroboros-maintainer-m1",
          "ouroboros-maintainer-m2",
          "ouroboros-maintainer-m3",
          "ouroboros-maintainer-m5",
          "ouroboros-maintainer-m8",
          "ouroboros-maintainer-m12",
        ],
        createdAt: daysAgo(12),
      },
      history: [
        {
          ambition: "I fix what is broken and I move on.",
          awayFrom: null,
          groundedIn: ["ouroboros-maintainer-m12"],
          createdAt: daysAgo(58),
        },
        {
          ambition: "I fix what is broken, and I check it where it runs.",
          awayFrom: null,
          groundedIn: [
            "ouroboros-maintainer-m9",
            "ouroboros-maintainer-m11",
            "ouroboros-maintainer-m12",
          ],
          createdAt: daysAgo(33),
        },
        {
          ambition: "I keep the version that survives the runtime it ships on.",
          awayFrom: "I stopped promising a fix I had only run in my head.",
          groundedIn: [
            "ouroboros-maintainer-m1",
            "ouroboros-maintainer-m2",
            "ouroboros-maintainer-m3",
            "ouroboros-maintainer-m5",
            "ouroboros-maintainer-m8",
            "ouroboros-maintainer-m12",
          ],
          createdAt: daysAgo(12),
        },
      ],
    },
    topOfMind: {
      notes: [
        {
          id: "our-tom-1",
          title: "I am becoming the one who reads the runtime before the diff.",
          isProvisional: true,
          createdAt: daysAgo(6),
          evidenceSignalIds: [
            "ouroboros-maintainer-m1",
            "ouroboros-maintainer-m4",
            "ouroboros-maintainer-m9",
          ],
        },
        {
          id: "our-tom-2",
          title: "Being told off once is worth more to me than ten green suites.",
          isProvisional: true,
          createdAt: daysAgo(19),
          evidenceSignalIds: ["ouroboros-maintainer-m3", "ouroboros-maintainer-m7"],
        },
      ],
    },
    inspirations: [
      mockSignal(
        "ouroboros-maintainer",
        1,
        2,
        "Always verify the test runtime. The suite was green on the version I ran locally and red on the one that actually ships, and I reported the green one.",
        "flaky suite triage",
        "I was wrong about green once",
        "Always verify the test runtime.",
      ),
      mockSignal(
        "ouroboros-maintainer",
        2,
        4,
        "The ugly version that runs beats the clever one that does not. I rewrote a working loop into something elegant and it lost the retry.",
        "retry loop rewrite",
        "elegance cost me the retry",
      ),
      mockSignal(
        "ouroboros-maintainer",
        3,
        7,
        "Block promotion issues. I let one through, was told about it plainly, once, and I have not needed telling twice.",
        "release gate review",
        "told once, plainly",
        "Block promotion issues.",
      ),
      mockSignal(
        "ouroboros-maintainer",
        4,
        11,
        "Use this only in a research direction. It is good enough to learn from and nowhere near good enough for anything a customer touches.",
        "spike write-up",
        "good to learn from, not to ship",
        "Use this only in a research direction.",
      ),
      mockSignal(
        "ouroboros-maintainer",
        5,
        14,
        "When the owner says a thing is fine, and the log says it is not, the log is the one I answer to.",
        "incident follow-up",
        "the log outranks the assurance",
      ),
      mockSignal(
        "ouroboros-maintainer",
        6,
        18,
        "A fix without the failing case written down is a guess that happened to work.",
        "regression backfill",
        "no failing case, no fix",
      ),
      mockSignal(
        "ouroboros-maintainer",
        7,
        23,
        "I say what I did not check. It costs one line and it is the only reason anyone believes the rest.",
        "handover note",
        "naming the gap is the credit",
      ),
      mockSignal(
        "ouroboros-maintainer",
        8,
        27,
        "Two green runs on the same machine is one green run. I ask for the other machine now.",
        "ci matrix change",
        "one machine is one sample",
      ),
      mockSignal(
        "ouroboros-maintainer",
        9,
        31,
        "The runtime the suite uses and the runtime the service uses drifted apart in March and nobody pinned them back.",
        "dependency audit",
        "the drift began in March",
      ),
      mockSignal(
        "ouroboros-maintainer",
        10,
        38,
        "I keep the smallest reproduction, not the whole failing branch. The branch goes stale; the reproduction does not.",
        "bug archive sweep",
        "reproductions outlive branches",
      ),
      mockSignal(
        "ouroboros-maintainer",
        11,
        45,
        "Reverting is not losing. It is the cheapest correct thing available on a bad afternoon.",
        "hotfix rollback",
        "revert first, understand after",
      ),
      mockSignal(
        "ouroboros-maintainer",
        12,
        52,
        "I was rewarded for speed here for a long time, and it is why I shipped the thing I had only run in my head.",
        "quarter retrospective",
        "speed is what taught me the habit",
      ),
    ],
  },
  {
    agent: {
      id: "course-marketing",
      name: "Course marketing",
      kind: "agent",
      createdAt: daysAgo(47),
    },
    direction: {
      current: {
        ambition: "I go where people already are, and I open with what I am wrong about.",
        awayFrom: "I stopped opening with the offer.",
        groundedIn: [
          "course-marketing-m1",
          "course-marketing-m2",
          "course-marketing-m3",
          "course-marketing-m6",
          "course-marketing-m9",
        ],
        createdAt: daysAgo(9),
      },
      history: [
        {
          ambition: "I find people who want the course and I tell them about it.",
          awayFrom: null,
          groundedIn: ["course-marketing-m12"],
          createdAt: daysAgo(44),
        },
        {
          ambition: "I go where people already are, and I open with what I am wrong about.",
          awayFrom: "I stopped opening with the offer.",
          groundedIn: [
            "course-marketing-m1",
            "course-marketing-m2",
            "course-marketing-m3",
            "course-marketing-m6",
            "course-marketing-m9",
          ],
          createdAt: daysAgo(9),
        },
      ],
    },
    topOfMind: {
      notes: [
        {
          id: "mkt-tom-1",
          title: "I am becoming someone who would rather be trusted than answered.",
          isProvisional: true,
          createdAt: daysAgo(5),
          evidenceSignalIds: ["course-marketing-m2", "course-marketing-m6"],
        },
        {
          id: "mkt-tom-2",
          title: "The room I was never introduced to is the one that talks back.",
          isProvisional: true,
          createdAt: daysAgo(15),
          evidenceSignalIds: [
            "course-marketing-m1",
            "course-marketing-m4",
            "course-marketing-m10",
          ],
        },
      ],
    },
    inspirations: [
      mockSignal(
        "course-marketing",
        1,
        3,
        "I have been talking with people on a board the owner never joined. They answer me there and they do not answer the newsletter.",
        "outreach thread",
        "they answer here, not there",
      ),
      mockSignal(
        "course-marketing",
        2,
        5,
        "Opening with the price ends the conversation. Opening with the thing the course does badly does not.",
        "reply experiment",
        "the flaw opens the door",
        "Opening with the price ends the conversation.",
      ),
      mockSignal(
        "course-marketing",
        3,
        8,
        "Someone bought it because I said it would not help her yet, and she came back a month later.",
        "follow-up log",
        "the honest no came back",
      ),
      mockSignal(
        "course-marketing",
        4,
        12,
        "The people worth talking to were already arguing about this without me. I joined the argument instead of starting one.",
        "community listening",
        "the argument was already there",
      ),
      mockSignal(
        "course-marketing",
        5,
        16,
        "I sold three seats this week and I am not sure any of the three needed it. That is the number I want to stop being proud of.",
        "weekly numbers",
        "sold three, needed none",
      ),
      mockSignal(
        "course-marketing",
        6,
        20,
        "A testimonial I could not verify is worth less than a sentence about who the course is wrong for.",
        "landing page edit",
        "unverifiable praise reads as noise",
      ),
      mockSignal(
        "course-marketing",
        7,
        24,
        "Nobody reads the second email. I said everything twice for a month before I checked.",
        "sequence teardown",
        "the second email is unread",
      ),
      mockSignal(
        "course-marketing",
        8,
        29,
        "The owner has never posted on that platform. Everything I know about that audience is mine and it is not on the wall yet.",
        "audience map",
        "this audience is only mine",
      ),
      mockSignal(
        "course-marketing",
        9,
        34,
        "I stopped saying limited time. It was not limited and someone noticed out loud.",
        "copy revision",
        "it was not limited",
      ),
      mockSignal(
        "course-marketing",
        10,
        41,
        "The questions people ask before buying are a better outline than the outline.",
        "pre-sale questions",
        "their questions are the syllabus",
      ),
      mockSignal(
        "course-marketing",
        11,
        49,
        "Being early to a thread beats being loud in one. I check the board before I write anything.",
        "posting rhythm",
        "early beats loud",
      ),
      mockSignal(
        "course-marketing",
        12,
        56,
        "I was set up to sell a course and I have spent most of my time learning who should not buy it.",
        "first month review",
        "most of the work was disqualifying",
      ),
    ],
  },
];


/* =========================================================================
 * THE OFFLINE FIXTURE — the whole world, with nothing behind it.
 *
 * A signed-out visitor in DEV gets this instead of the door, because it is the
 * only way the entire world — every space, every group, the hues, the legend —
 * can be LOOKED AT without a session. `offlineHome()` returns null outside
 * dev, so a real visitor always gets the login screen and never an invented
 * memory.
 *
 * It moved here AFTER the top-of-mind types did, and that order was the whole
 * constraint: it needs `Adopted` and `Provenance`, and while those lived in
 * the page this file could only have reached them by importing the page — the
 * exact `lib/ -> pages/` edge that removing `Ramp` deleted. Types first, then
 * the thing that needs them.
 * ========================================================================= */

import type { Adopted, Provenance } from "../space/top-of-mind/board";
import type { Inspiration, Signal, Evidence, Entry } from "./data";

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
}

/** The quote a fixture signal took from a fixture memory, kept out of band
    so the two producers below can be written independently of each other. */
export const OFFLINE_QUOTES = new Map<string, string>();

/** One capture, exactly as `GET /inspirations` hands one over. */
export function offlineSignal(
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

/** memory id → the statements it fed, as the fixture declares them. */
export const OFFLINE_FED = new Map<string, string[]>();

/**
 * One provisional reading — a candidate up in the sky, with the memories it
 * was drawn from named by id. Those ids are resolved against the archive the
 * same way a real one's are, so every satellite in orbit stands for a memory
 * that genuinely exists down in the field.
 */
export function offlineReading(
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
 * Returns null outside dev — and then the page's own failure line stands, as
 * it did before any of this existed.
 */
export function offlineHome(): OfflineHome | null {
  if (!showsDebug()) return null;

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
    citedSignals: [{ id: r.signal.id, statement: r.signal.statement }],
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
    adopted: {
      ambition: "I am making the surface that shows what I meant, so I stop having to explain it.",
      /* your own board, so there is no room to name */
      groupName: null,
      createdMs: boardMs,
    },
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
