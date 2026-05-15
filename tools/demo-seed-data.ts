export type DemoCluster =
  | "outlier"
  | "bridge"
  | "morph"
  | "convergence"
  | "tension"
  | "loop";

export type DemoWowKind =
  | "recurrence"
  | "bridge"
  | "surprise_bridge"
  | "tension"
  | "outlier";

export interface DemoInspirationSeed {
  slug: string;
  text: string;
  kind: string;
  category: number;
  cluster: DemoCluster;
  importanceScore: number;
  wowScore: number;
}

export interface DemoWowMomentSeed {
  slug: string;
  title: string;
  kind: DemoWowKind;
  why: string;
  reflectionQuestion: string;
  wowScore: number;
  related: Array<{
    inspirationSlug: string;
    role: string;
    reason: string;
  }>;
}

export const DEMO_SEED_KIND = "demo-seed";

// These scores are hand-curated demo baselines, not outputs from the live
// scoring model. Keep them varied and below the old overconfident 70-90 band
// so newly processed inspirations and generated WOW moments have room to compete.
export const DEMO_INSPIRATIONS: DemoInspirationSeed[] = [
  {
    slug: "notion-first-run-template-gallery",
    kind: DEMO_SEED_KIND,
    category: 1,
    cluster: "convergence",
    importanceScore: 60,
    wowScore: 55,
    text: "Saved example: Notion's first-run screen lets you pick templates like Class Notes, Project Plan, or Reading List so the blank page already has a useful shape.",
  },
  {
    slug: "figma-community-remix-button",
    kind: DEMO_SEED_KIND,
    category: 2,
    cluster: "bridge",
    importanceScore: 50,
    wowScore: 48,
    text: "Product idea: Figma Community makes every file feel reusable because the Remix button is visible before you even understand the whole design system.",
  },
  {
    slug: "spotify-wrapped-share-card",
    kind: DEMO_SEED_KIND,
    category: 3,
    cluster: "loop",
    importanceScore: 66,
    wowScore: 68,
    text: "Observation: Spotify Wrapped turns private listening data into colorful cards people actually want to share because each stat says something personal in one glance.",
  },
  {
    slug: "airbnb-wishlist-map-pins",
    kind: DEMO_SEED_KIND,
    category: 4,
    cluster: "bridge",
    importanceScore: 45,
    wowScore: 43,
    text: "Screenshot note: Airbnb wishlists are easier to understand when the saved homes appear as map pins beside the list instead of staying as separate bookmarks.",
  },
  {
    slug: "duolingo-streak-freeze",
    kind: DEMO_SEED_KIND,
    category: 5,
    cluster: "tension",
    importanceScore: 42,
    wowScore: 46,
    text: "UX note: Duolingo's streak freeze is clever because it protects momentum after a missed day, but it also shows how easily care can become pressure.",
  },
  {
    slug: "linear-command-menu-speed",
    kind: DEMO_SEED_KIND,
    category: 6,
    cluster: "convergence",
    importanceScore: 57,
    wowScore: 53,
    text: "Saved interaction: Linear's command menu makes create, assign, and move feel like one fast action, which is why power users talk about flow instead of forms.",
  },
  {
    slug: "slack-save-for-later-tray",
    kind: DEMO_SEED_KIND,
    category: 7,
    cluster: "loop",
    importanceScore: 36,
    wowScore: 38,
    text: "Work habit: Slack's Save for Later tray works because it turns scattered messages into a visible inbox of things I promised myself I would revisit.",
  },
  {
    slug: "pinterest-related-pins-rabbit-hole",
    kind: DEMO_SEED_KIND,
    category: 8,
    cluster: "loop",
    importanceScore: 44,
    wowScore: 51,
    text: "Inspiration: Pinterest keeps momentum by showing related pins that are close enough to feel relevant but different enough to make the next click feel like discovery.",
  },
  {
    slug: "github-good-first-issue-label",
    kind: DEMO_SEED_KIND,
    category: 9,
    cluster: "outlier",
    importanceScore: 40,
    wowScore: 37,
    text: "Community example: GitHub's good first issue label lowers the fear of contributing because it marks where a newcomer can safely start helping.",
  },
  {
    slug: "apple-photos-memory-movie",
    kind: DEMO_SEED_KIND,
    category: 10,
    cluster: "tension",
    importanceScore: 58,
    wowScore: 62,
    text: "Observation: Apple Photos Memory movies feel magical when they surface a forgotten weekend, and risky when the algorithm chooses a memory you were not ready to see.",
  },
  {
    slug: "google-docs-suggesting-mode",
    kind: DEMO_SEED_KIND,
    category: 11,
    cluster: "morph",
    importanceScore: 48,
    wowScore: 44,
    text: "Collaboration pattern: Google Docs suggesting mode keeps edits visible as proposals, so feedback feels reversible instead of like someone overwrote your sentence.",
  },
  {
    slug: "tiktok-recipe-comments-improvements",
    kind: DEMO_SEED_KIND,
    category: 12,
    cluster: "loop",
    importanceScore: 34,
    wowScore: 36,
    text: "Saved quote: The best part of a TikTok recipe is often the comments where people report substitutions, oven times, and what actually worked at home.",
  },
  {
    slug: "goodreads-shelves-as-identity",
    kind: DEMO_SEED_KIND,
    category: 13,
    cluster: "loop",
    importanceScore: 33,
    wowScore: 35,
    text: "Product note: Goodreads shelves are more than organization; labels like want-to-read, abandoned, and comfort reads let readers describe themselves through piles.",
  },
  {
    slug: "strava-segment-leaderboard",
    kind: DEMO_SEED_KIND,
    category: 14,
    cluster: "tension",
    importanceScore: 43,
    wowScore: 49,
    text: "Behavior note: Strava segments make the same hill feel like a shared challenge, but the leaderboard can turn a quiet ride into a public performance.",
  },
  {
    slug: "canva-magic-resize",
    kind: DEMO_SEED_KIND,
    category: 15,
    cluster: "morph",
    importanceScore: 54,
    wowScore: 56,
    text: "Demo idea: Canva Magic Resize is instantly understandable because one finished design becomes an Instagram post, flyer, and slide without starting over.",
  },
  {
    slug: "loom-comment-on-timestamp",
    kind: DEMO_SEED_KIND,
    category: 16,
    cluster: "bridge",
    importanceScore: 59,
    wowScore: 58,
    text: "Workflow example: Loom timestamp comments make video feedback usable because the comment is attached to the exact second instead of a vague note like 'near the end.'",
  },
  {
    slug: "miro-sticky-note-clustering",
    kind: DEMO_SEED_KIND,
    category: 17,
    cluster: "convergence",
    importanceScore: 62,
    wowScore: 61,
    text: "Workshop note: Miro becomes useful when loose sticky notes snap into clusters, because a messy brainstorm suddenly shows themes the room can discuss.",
  },
  {
    slug: "superhuman-inbox-zero-celebration",
    kind: DEMO_SEED_KIND,
    category: 18,
    cluster: "tension",
    importanceScore: 28,
    wowScore: 31,
    text: "UX detail: Superhuman's inbox zero celebration gives a tiny reward for clearing mail, which makes completion visible but can also overvalue speed.",
  },
  {
    slug: "instagram-save-collections",
    kind: DEMO_SEED_KIND,
    category: 19,
    cluster: "loop",
    importanceScore: 35,
    wowScore: 39,
    text: "Saved pattern: Instagram collections let people turn random saved posts into named folders like apartment ideas, tattoos, or places to eat in Tokyo.",
  },
  {
    slug: "amazon-customers-also-bought",
    kind: DEMO_SEED_KIND,
    category: 20,
    cluster: "bridge",
    importanceScore: 30,
    wowScore: 32,
    text: "Commerce pattern: Amazon's customers also bought module is blunt but effective because it explains a recommendation through other people's adjacent choices.",
  },
  {
    slug: "readwise-daily-highlight-review",
    kind: DEMO_SEED_KIND,
    category: 21,
    cluster: "loop",
    importanceScore: 64,
    wowScore: 65,
    text: "Personal knowledge habit: Readwise daily review resurfaces old highlights just often enough that a quote saved months ago can become useful today.",
  },
  {
    slug: "youtube-chapter-markers",
    kind: DEMO_SEED_KIND,
    category: 22,
    cluster: "morph",
    importanceScore: 37,
    wowScore: 34,
    text: "Media note: YouTube chapter markers turn a long video into a browsable table of contents, so viewers can jump to the idea they came for.",
  },
  {
    slug: "calendly-availability-grid",
    kind: DEMO_SEED_KIND,
    category: 23,
    cluster: "convergence",
    importanceScore: 41,
    wowScore: 40,
    text: "Scheduling example: Calendly's availability grid removes the back-and-forth by showing the open slots first, making coordination feel like choosing instead of negotiating.",
  },
  {
    slug: "shopify-app-store-proof",
    kind: DEMO_SEED_KIND,
    category: 24,
    cluster: "outlier",
    importanceScore: 29,
    wowScore: 33,
    text: "Marketplace note: Shopify app listings use reviews, screenshots, and install counts together so a merchant can trust an unfamiliar tool quickly.",
  },
  {
    slug: "dropbox-shared-folder-activity",
    kind: DEMO_SEED_KIND,
    category: 25,
    cluster: "bridge",
    importanceScore: 39,
    wowScore: 42,
    text: "Team workflow: Dropbox shared folder activity is helpful because it answers 'what changed?' without forcing everyone to send a status update.",
  },
  {
    slug: "notebook-margin-star-system",
    kind: DEMO_SEED_KIND,
    category: 26,
    cluster: "outlier",
    importanceScore: 31,
    wowScore: 38,
    text: "Analog inspiration: A founder marks notebook margins with one star for ideas, two stars for customer quotes, and three stars for things to prototype this week.",
  },
  {
    slug: "customer-support-macro-library",
    kind: DEMO_SEED_KIND,
    category: 27,
    cluster: "convergence",
    importanceScore: 46,
    wowScore: 45,
    text: "Support ops note: A macro library saves the best answer to a repeated customer question, but agents still edit the last line so the reply feels human.",
  },
  {
    slug: "museum-audio-guide-detours",
    kind: DEMO_SEED_KIND,
    category: 28,
    cluster: "morph",
    importanceScore: 27,
    wowScore: 34,
    text: "Experience idea: A museum audio guide that offers 'two-minute detours' makes exploration less linear while keeping visitors from feeling lost.",
  },
  {
    slug: "product-hunt-launch-comments",
    kind: DEMO_SEED_KIND,
    category: 29,
    cluster: "tension",
    importanceScore: 42,
    wowScore: 41,
    text: "Launch research: Product Hunt comments are useful because early users often ask the positioning questions the landing page forgot to answer.",
  },
  {
    slug: "trello-card-aging-power-up",
    kind: DEMO_SEED_KIND,
    category: 30,
    cluster: "loop",
    importanceScore: 26,
    wowScore: 30,
    text: "Visual cue: Trello's card aging power-up fades neglected cards, making stale work visible without adding another report or meeting.",
  },
];

export const DEMO_WOW_MOMENTS: DemoWowMomentSeed[] = [
  {
    slug: "blank-pages-need-starter-shapes",
    title: "Blank pages feel better with starter shapes",
    kind: "recurrence",
    wowScore: 78,
    why: "Notion templates, Canva resize, and YouTube chapters all reduce fear by giving unfinished work a clear structure before the user has to decide everything.",
    reflectionQuestion: "Where could WAKA turn an empty state into an obvious next step?",
    related: [
      { inspirationSlug: "notion-first-run-template-gallery", role: "template clue", reason: "Templates make a blank page immediately useful." },
      { inspirationSlug: "canva-magic-resize", role: "reuse clue", reason: "One finished design becomes many formats." },
      { inspirationSlug: "youtube-chapter-markers", role: "navigation clue", reason: "Chapters turn long content into visible structure." },
    ],
  },
  {
    slug: "saved-things-become-a-map",
    title: "Saved things become useful when they turn into a map",
    kind: "bridge",
    wowScore: 74,
    why: "Airbnb pins, Instagram collections, and Goodreads shelves show that saves become more valuable when people can see groups, places, and intent.",
    reflectionQuestion: "How should WAKA show the shape of what someone has saved?",
    related: [
      { inspirationSlug: "airbnb-wishlist-map-pins", role: "place clue", reason: "Pins connect saved homes to a visible map." },
      { inspirationSlug: "instagram-save-collections", role: "folder clue", reason: "Collections turn random saves into named intent." },
      { inspirationSlug: "goodreads-shelves-as-identity", role: "identity clue", reason: "Shelves make personal categories visible." },
    ],
  },
  {
    slug: "community-context-builds-trust-fast",
    title: "Community context explains why something matters",
    kind: "surprise_bridge",
    wowScore: 72,
    why: "Figma remixes, GitHub starter labels, and Shopify proof all help a stranger trust an object because other people have already shown how it can be used.",
    reflectionQuestion: "What social proof would make an inspiration easier to trust?",
    related: [
      { inspirationSlug: "figma-community-remix-button", role: "reuse proof", reason: "Remix makes community examples immediately actionable." },
      { inspirationSlug: "github-good-first-issue-label", role: "entry proof", reason: "The label tells newcomers where to begin." },
      { inspirationSlug: "shopify-app-store-proof", role: "trust proof", reason: "Reviews and screenshots reduce unfamiliarity." },
    ],
  },
  {
    slug: "timed-comments-beat-vague-feedback",
    title: "Feedback lands when it points to the exact moment",
    kind: "bridge",
    wowScore: 70,
    why: "Loom timestamps, Google Docs suggestions, and support macros keep feedback useful by attaching it to the specific sentence, second, or customer question.",
    reflectionQuestion: "Where should feedback attach directly to evidence instead of becoming a note?",
    related: [
      { inspirationSlug: "loom-comment-on-timestamp", role: "video proof", reason: "Timestamp comments point to the exact second." },
      { inspirationSlug: "google-docs-suggesting-mode", role: "text proof", reason: "Suggestions keep sentence-level edits reversible." },
      { inspirationSlug: "customer-support-macro-library", role: "service proof", reason: "Macros preserve repeated answers for reuse." },
    ],
  },
  {
    slug: "resurfacing-makes-old-saves-new-again",
    title: "Old saves feel new when resurfaced at the right time",
    kind: "recurrence",
    wowScore: 69,
    why: "Readwise reviews, Slack Save for Later, and Pinterest related pins all make saved material useful again by bringing it back in a timely context.",
    reflectionQuestion: "When should WAKA bring an old inspiration back into view?",
    related: [
      { inspirationSlug: "readwise-daily-highlight-review", role: "review loop", reason: "Old highlights return when they might help." },
      { inspirationSlug: "slack-save-for-later-tray", role: "promise loop", reason: "Saved messages become a revisit inbox." },
      { inspirationSlug: "pinterest-related-pins-rabbit-hole", role: "discovery loop", reason: "Related pins keep exploration moving." },
    ],
  },
  {
    slug: "personal-data-needs-emotional-controls",
    title: "Personal data needs emotional controls",
    kind: "tension",
    wowScore: 68,
    why: "Wrapped, Apple Memories, and Strava all show that personal data can delight or pressure people depending on timing, audience, and control.",
    reflectionQuestion: "Which personal insight should WAKA make easy to pause, hide, or share?",
    related: [
      { inspirationSlug: "spotify-wrapped-share-card", role: "delight clue", reason: "Private listening becomes shareable identity." },
      { inspirationSlug: "apple-photos-memory-movie", role: "sensitivity clue", reason: "Automatic memories can arrive at the wrong time." },
      { inspirationSlug: "strava-segment-leaderboard", role: "pressure clue", reason: "Shared metrics can turn activity into performance." },
    ],
  },
  {
    slug: "messy-inputs-need-visible-clusters",
    title: "Messy inputs become clear when clusters appear",
    kind: "recurrence",
    wowScore: 66,
    why: "Miro sticky clusters, notebook margin stars, and Trello aging all make a pile of work readable by adding simple visual grouping or priority cues.",
    reflectionQuestion: "What is the smallest visual cue that would make a cluster obvious?",
    related: [
      { inspirationSlug: "miro-sticky-note-clustering", role: "cluster clue", reason: "Sticky notes become themes the room can discuss." },
      { inspirationSlug: "notebook-margin-star-system", role: "priority clue", reason: "Margin stars separate ideas, quotes, and prototypes." },
      { inspirationSlug: "trello-card-aging-power-up", role: "staleness clue", reason: "Faded cards reveal neglected work." },
    ],
  },
  {
    slug: "recommendations-work-when-the-link-is-obvious",
    title: "Recommendations work when the link is obvious",
    kind: "bridge",
    wowScore: 62,
    why: "Amazon adjacent buys, Dropbox activity, and Calendly slots all succeed because the next action is explained by visible context, not mystery.",
    reflectionQuestion: "How can WAKA show why two inspirations belong together?",
    related: [
      { inspirationSlug: "amazon-customers-also-bought", role: "adjacency clue", reason: "Recommendations are explained by adjacent choices." },
      { inspirationSlug: "dropbox-shared-folder-activity", role: "change clue", reason: "Activity answers what changed without a meeting." },
      { inspirationSlug: "calendly-availability-grid", role: "choice clue", reason: "Open slots make coordination visible." },
    ],
  },
  {
    slug: "small-rewards-can-help-or-hurt",
    title: "Small rewards can support momentum or create pressure",
    kind: "tension",
    wowScore: 59,
    why: "Duolingo freezes, Superhuman celebrations, and Product Hunt comments show that motivation features need care because public feedback and streaks can distort behavior.",
    reflectionQuestion: "Where should WAKA encourage momentum without turning it into a scoreboard?",
    related: [
      { inspirationSlug: "duolingo-streak-freeze", role: "streak clue", reason: "A freeze protects momentum but adds pressure." },
      { inspirationSlug: "superhuman-inbox-zero-celebration", role: "completion clue", reason: "A reward makes clearing work feel valuable." },
      { inspirationSlug: "product-hunt-launch-comments", role: "public clue", reason: "Launch comments expose missing positioning." },
    ],
  },
  {
    slug: "short-paths-keep-exploration-light",
    title: "Short paths keep exploration from feeling heavy",
    kind: "outlier",
    wowScore: 56,
    why: "TikTok recipe comments, museum audio detours, and Linear's command menu all show that users explore more when the side path is short, clear, and easy to leave.",
    reflectionQuestion: "What shortcut or detour would add context without overwhelming the card?",
    related: [
      { inspirationSlug: "tiktok-recipe-comments-improvements", role: "practical detour", reason: "Comments add tested substitutions and fixes." },
      { inspirationSlug: "museum-audio-guide-detours", role: "experience detour", reason: "Short detours offer choice without getting lost." },
      { inspirationSlug: "linear-command-menu-speed", role: "shortcut clue", reason: "The command menu makes many actions feel close." },
    ],
  },
];

export function getDemoSeedSummary(): { inspirationCount: number; wowMomentCount: number; linkedInspirationCount: number } {
  const linked = new Set<string>();
  for (const moment of DEMO_WOW_MOMENTS) {
    for (const related of moment.related) linked.add(related.inspirationSlug);
  }
  return {
    inspirationCount: DEMO_INSPIRATIONS.length,
    wowMomentCount: DEMO_WOW_MOMENTS.length,
    linkedInspirationCount: linked.size,
  };
}
