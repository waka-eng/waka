/**
 * The demo dataset, as data.
 *
 * Everything here is hand-written so a fresh database can show the three
 * layers standing on each other: captures a person plausibly made, the
 * patterns those captures support, and one artifact synthesised from the
 * patterns. Nothing in this file is model output, and nothing in it pretends
 * to be — the seeder writes it as-is so a demo is reproducible and a diff to
 * it is readable.
 *
 * Slugs are the join keys. They exist only inside this file and the seeder;
 * the database gets UUIDs.
 */

export type DemoInspirationKind = "note" | "link" | "image" | "mixed";
export type DemoInspirationSource = "app" | "agent";
export type DemoSignalStatus = "emerging" | "active" | "retired";
export type DemoEntryType = "pattern" | "tension" | "question" | "hypothesis" | "action";

export interface DemoInspirationSeed {
  slug: string;
  text: string;
  kind: DemoInspirationKind;
  /** Whose initiative the content was. A couple of these are the agent's. */
  source: DemoInspirationSource;
  /** A reflection or two, where a person plausibly wrote one. */
  reflections?: Array<{ question: string; answer?: string; skipped?: boolean }>;
}

export interface DemoSignalSeed {
  slug: string;
  statement: string;
  status: DemoSignalStatus;
  confidence: number;
  /** Which profile owns it — the person's stack, or the agent's own. */
  profile: "human" | "agent";
  evidence: Array<{ inspirationSlug: string; reason: string; quote?: string }>;
}

export interface DemoEntrySeed {
  type: DemoEntryType;
  body: string;
  belief?: string;
  prompt?: string;
  pinned?: boolean;
  citedSignalSlugs: string[];
}

/**
 * Marks every row this script wrote, so a reseed replaces its own demo rows
 * and leaves anything the person actually captured alone. Stored as the first
 * line of the capture text because inspirations carry no tag column — the
 * seeder matches on this prefix and nothing else.
 */
export const DEMO_SEED_MARKER = "[waka-demo-seed]";

export const DEMO_HUMAN_PROFILE_NAME = "WAKA Demo";
export const DEMO_AGENT_PROFILE_NAME = "Demo Agent";

export const DEMO_INSPIRATIONS: DemoInspirationSeed[] = [
  {
    slug: "notion-first-run-templates",
    kind: "link",
    source: "app",
    text: "Notion's first-run screen lets you pick Class Notes, Project Plan or Reading List, so the blank page already has a shape before you type anything.",
    reflections: [
      {
        question: "Why did this catch you?",
        answer: "A blank page is a demand. Handing me a shape is the product doing the first move.",
      },
    ],
  },
  {
    slug: "figma-community-remix",
    kind: "note",
    source: "app",
    text: "Figma Community makes every file feel reusable because Remix is visible before you understand the design system underneath it.",
  },
  {
    slug: "spotify-wrapped-cards",
    kind: "note",
    source: "app",
    text: "Spotify Wrapped turns private listening into cards people want to share, because each stat says something personal in one glance.",
    reflections: [
      {
        question: "What is the uncomfortable half of this?",
        answer: "The same card would feel like surveillance if it arrived on a bad week.",
      },
    ],
  },
  {
    slug: "airbnb-wishlist-map",
    kind: "image",
    source: "app",
    text: "Airbnb wishlists get easier to read when the saved homes appear as pins on a map beside the list instead of staying separate bookmarks.",
  },
  {
    slug: "linear-command-menu",
    kind: "note",
    source: "app",
    text: "Linear's command menu makes fifty actions feel close, because the shortcut is the same regardless of which one you wanted.",
  },
  {
    slug: "duolingo-streak-freeze",
    kind: "note",
    source: "app",
    text: "A Duolingo streak freeze protects momentum and adds pressure in the same move — the streak only matters because losing it costs something.",
    reflections: [
      { question: "Would you want this in your own work?", skipped: true },
    ],
  },
  {
    slug: "museum-audio-detours",
    kind: "note",
    source: "app",
    text: "The museum audio guide offers a two-minute detour beside each room. Short enough that taking one never feels like leaving the tour.",
  },
  {
    slug: "trello-card-aging",
    kind: "note",
    source: "app",
    text: "Trello's card aging power-up fades cards nobody has touched, so a neglected board tells you it is neglected without a report.",
  },
  {
    slug: "agent-observed-capture-bursts",
    kind: "note",
    source: "agent",
    text: "Captures cluster in the twenty minutes after a long reading session, then stop entirely for days. The bursts look like processing, not collecting.",
  },
  {
    slug: "agent-observed-editing-habit",
    kind: "note",
    source: "agent",
    text: "When a generated statement is edited it is almost always shortened, and the removed half is the explanation rather than the claim.",
  },
];

export const DEMO_SIGNALS: DemoSignalSeed[] = [
  {
    slug: "products-that-make-the-first-move",
    profile: "human",
    status: "active",
    confidence: 82,
    statement:
      "You keep saving products that make the first move for you, so nothing you open starts empty.",
    evidence: [
      {
        inspirationSlug: "notion-first-run-templates",
        reason: "Names the blank page as the thing being removed.",
        quote: "the blank page already has a shape",
      },
      {
        inspirationSlug: "figma-community-remix",
        reason: "Remix is the first move, offered before understanding is required.",
      },
      {
        inspirationSlug: "linear-command-menu",
        reason: "One shortcut stands in for deciding which action you wanted.",
      },
    ],
  },
  {
    slug: "personal-data-needs-a-volume-knob",
    profile: "human",
    status: "active",
    confidence: 64,
    statement:
      "You are drawn to personal data made shareable, and suspicious of it the moment the person cannot turn it down.",
    evidence: [
      {
        inspirationSlug: "spotify-wrapped-cards",
        reason: "The delight case: private listening becomes something to show.",
        quote: "says something personal in one glance",
      },
      {
        inspirationSlug: "duolingo-streak-freeze",
        reason: "The pressure case: the same mechanism, with a cost attached.",
      },
    ],
  },
  {
    slug: "a-pile-reads-once-it-is-arranged",
    profile: "human",
    status: "emerging",
    confidence: 41,
    statement:
      "A pile becomes legible when something arranges it in space or time, not when something summarises it.",
    evidence: [
      {
        inspirationSlug: "airbnb-wishlist-map",
        reason: "Pins on a map do the arranging that a list could not.",
      },
      {
        inspirationSlug: "trello-card-aging",
        reason: "Fading is time made visible without a written report.",
      },
      {
        inspirationSlug: "museum-audio-detours",
        reason: "A bounded detour keeps the shape of the tour intact.",
      },
    ],
  },
  {
    slug: "agent-capture-arrives-in-bursts",
    profile: "agent",
    status: "emerging",
    confidence: 55,
    statement:
      "This person captures in bursts after reading, so a prompt to capture is better timed than a prompt to review.",
    evidence: [
      {
        inspirationSlug: "agent-observed-capture-bursts",
        reason: "The observation this was distilled from.",
      },
      {
        inspirationSlug: "agent-observed-editing-habit",
        reason: "Edits shorten rather than redirect, which reads as processing too.",
      },
    ],
  },
];

export const DEMO_TOP_OF_MIND_ENTRIES: DemoEntrySeed[] = [
  {
    type: "pattern",
    body: "You want the first move made for you — in tools, and possibly in more than tools.",
    prompt: "Where else are you waiting to be handed a shape?",
    pinned: true,
    citedSignalSlugs: ["products-that-make-the-first-move"],
  },
  {
    type: "tension",
    body: "You want personal data to be expressive and you do not trust it to be quiet. Both, at once.",
    belief: "Anything that can flatter can also pressure.",
    citedSignalSlugs: ["personal-data-needs-a-volume-knob"],
  },
  {
    type: "question",
    body: "Is arrangement doing the work you have been crediting to summary?",
    prompt: "Take the last pile you sorted. What actually made it readable?",
    citedSignalSlugs: [
      "a-pile-reads-once-it-is-arranged",
      "products-that-make-the-first-move",
    ],
  },
];

export function getDemoSeedSummary(): {
  inspirationCount: number;
  agentSourcedCount: number;
  signalCount: number;
  evidenceCount: number;
  entryCount: number;
} {
  return {
    inspirationCount: DEMO_INSPIRATIONS.length,
    agentSourcedCount: DEMO_INSPIRATIONS.filter((seed) => seed.source === "agent").length,
    signalCount: DEMO_SIGNALS.length,
    evidenceCount: DEMO_SIGNALS.reduce((total, signal) => total + signal.evidence.length, 0),
    entryCount: DEMO_TOP_OF_MIND_ENTRIES.length,
  };
}
