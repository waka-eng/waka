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
 *   GET /api/agents/:id/captures      → ApiAgentSignal[]    (origin, producedBy)
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
  captures: ApiAgentSignal[];
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
    captures: [
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
    captures: [
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