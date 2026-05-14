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

export const DEMO_INSPIRATIONS: DemoInspirationSeed[] = [
  {
    slug: "library-after-dark",
    kind: DEMO_SEED_KIND,
    category: 1,
    cluster: "outlier",
    importanceScore: 82,
    wowScore: 74,
    text: "A tiny neighborhood library stays open until midnight once a month, not for productivity, but so people can read beside strangers without being asked to buy anything.",
  },
  {
    slug: "train-platform-scores",
    kind: DEMO_SEED_KIND,
    category: 2,
    cluster: "bridge",
    importanceScore: 70,
    wowScore: 81,
    text: "Train-platform announcement chimes feel like accidental public music: infrastructure as a citywide instrument that no one officially calls a performance.",
  },
  {
    slug: "gardener-version-control",
    kind: DEMO_SEED_KIND,
    category: 3,
    cluster: "morph",
    importanceScore: 76,
    wowScore: 69,
    text: "The community gardener labels each bed with last season's mistake, turning version history into a physical interface for care.",
  },
  {
    slug: "ai-classroom-margin",
    kind: DEMO_SEED_KIND,
    category: 4,
    cluster: "convergence",
    importanceScore: 88,
    wowScore: 84,
    text: "In the AI classroom, the margin note may become more important than the essay: it shows where the learner argued with the machine instead of accepting it.",
  },
  {
    slug: "family-photo-archive",
    kind: DEMO_SEED_KIND,
    category: 5,
    cluster: "tension",
    importanceScore: 79,
    wowScore: 77,
    text: "A family photo archive that auto-tags smiles makes grief searchable, which is both a gift and a small act of violence.",
  },
  {
    slug: "same-question-thursday",
    kind: DEMO_SEED_KIND,
    category: 6,
    cluster: "loop",
    importanceScore: 73,
    wowScore: 67,
    text: "I keep asking the same Thursday question: is knowledge what I can recall, or what I can reliably return to with better questions?",
  },
  {
    slug: "museum-bench-protocol",
    kind: DEMO_SEED_KIND,
    category: 7,
    cluster: "bridge",
    importanceScore: 66,
    wowScore: 72,
    text: "Museum benches are an underrated protocol: they decide whether looking is a transaction or a duration.",
  },
  {
    slug: "recipe-as-memory-palace",
    kind: DEMO_SEED_KIND,
    category: 8,
    cluster: "loop",
    importanceScore: 64,
    wowScore: 71,
    text: "A recipe card with stains is a memory palace in miniature; the evidence of use becomes part of the instruction set.",
  },
  {
    slug: "soft-robot-compost",
    kind: DEMO_SEED_KIND,
    category: 9,
    cluster: "morph",
    importanceScore: 69,
    wowScore: 78,
    text: "Soft robots moving through compost make technology look less like control and more like negotiation with rot.",
  },
  {
    slug: "school-bell-redesign",
    kind: DEMO_SEED_KIND,
    category: 10,
    cluster: "convergence",
    importanceScore: 75,
    wowScore: 80,
    text: "A school replaces the bell with student-composed soundscapes, and suddenly timekeeping becomes curriculum instead of command.",
  },
  {
    slug: "elevator-as-threshold",
    kind: DEMO_SEED_KIND,
    category: 11,
    cluster: "bridge",
    importanceScore: 68,
    wowScore: 73,
    text: "The office elevator mirror quietly turns commute time into rehearsal time; everyone enters the next room already edited by the ride.",
  },
  {
    slug: "broken-umbrella-commons",
    kind: DEMO_SEED_KIND,
    category: 12,
    cluster: "outlier",
    importanceScore: 63,
    wowScore: 70,
    text: "A cafe keeps a jar of repaired umbrellas by the door, and the neighborhood starts treating bad weather as a shared inventory problem.",
  },
  {
    slug: "sleep-mode-museum",
    kind: DEMO_SEED_KIND,
    category: 13,
    cluster: "tension",
    importanceScore: 72,
    wowScore: 76,
    text: "A digital museum labels unavailable exhibits as sleeping instead of offline, making technical downtime feel like an ethics of rest.",
  },
  {
    slug: "grandmother-search-history",
    kind: DEMO_SEED_KIND,
    category: 14,
    cluster: "loop",
    importanceScore: 81,
    wowScore: 82,
    text: "My grandmother's recipe search history reads like a biography of adaptation: substitutions, allergies, guests, weather, and pride.",
  },
  {
    slug: "robot-pet-funeral",
    kind: DEMO_SEED_KIND,
    category: 15,
    cluster: "tension",
    importanceScore: 78,
    wowScore: 83,
    text: "Children holding a funeral for a broken robot pet reveal that attachment can outpace ontology; care arrives before certainty.",
  },
  {
    slug: "public-pool-calendar",
    kind: DEMO_SEED_KIND,
    category: 16,
    cluster: "convergence",
    importanceScore: 67,
    wowScore: 72,
    text: "The public pool calendar is a civic mood ring: lap swim, toddler splash, and night repair all competing for the same blue rectangle.",
  },
  {
    slug: "birdsong-passwords",
    kind: DEMO_SEED_KIND,
    category: 17,
    cluster: "morph",
    importanceScore: 71,
    wowScore: 75,
    text: "A designer proposes birdsong passwords for a park kiosk, turning authentication into attention to the place you are standing in.",
  },
  {
    slug: "archive-of-failed-maps",
    kind: DEMO_SEED_KIND,
    category: 18,
    cluster: "outlier",
    importanceScore: 74,
    wowScore: 79,
    text: "An archive of failed maps shows roads people wanted, paths officials erased, and shortcuts that only existed in rumor.",
  },
  {
    slug: "choir-of-air-conditioners",
    kind: DEMO_SEED_KIND,
    category: 19,
    cluster: "bridge",
    importanceScore: 62,
    wowScore: 71,
    text: "Apartment air conditioners form a summer choir at dusk; private machines accidentally compose the sound of collective survival.",
  },
  {
    slug: "teacher-red-pen-ai",
    kind: DEMO_SEED_KIND,
    category: 20,
    cluster: "convergence",
    importanceScore: 80,
    wowScore: 85,
    text: "A teacher uses AI to draft feedback, then writes the final sentence by hand so students know where judgment became care.",
  },
  {
    slug: "forgotten-tab-garden",
    kind: DEMO_SEED_KIND,
    category: 21,
    cluster: "loop",
    importanceScore: 65,
    wowScore: 69,
    text: "A browser window of forgotten tabs becomes a garden of almost-intentions, each title marking a door I meant to return through.",
  },
  {
    slug: "compostable-interface",
    kind: DEMO_SEED_KIND,
    category: 22,
    cluster: "morph",
    importanceScore: 77,
    wowScore: 80,
    text: "A prototype phone case sprouts herbs after burial, making product end-of-life legible enough to touch, smell, and water.",
  },
  {
    slug: "quiet-car-debate",
    kind: DEMO_SEED_KIND,
    category: 23,
    cluster: "tension",
    importanceScore: 69,
    wowScore: 74,
    text: "The train quiet car is less about silence than negotiated permission: strangers collectively defend a fragile kind of attention.",
  },
  {
    slug: "neighborhood-time-bank",
    kind: DEMO_SEED_KIND,
    category: 24,
    cluster: "convergence",
    importanceScore: 84,
    wowScore: 86,
    text: "A neighborhood time bank prices tutoring, dog walking, and translation in the same hour, exposing which forms of care money usually hides.",
  },
  {
    slug: "streetlight-story-mode",
    kind: DEMO_SEED_KIND,
    category: 25,
    cluster: "bridge",
    importanceScore: 70,
    wowScore: 78,
    text: "Streetlights that dim when no one passes and brighten near footsteps make infrastructure feel like it is listening for narrative.",
  },
  {
    slug: "handwritten-bug-report",
    kind: DEMO_SEED_KIND,
    category: 26,
    cluster: "outlier",
    importanceScore: 58,
    wowScore: 66,
    text: "A handwritten bug report taped beside a factory terminal solves what three dashboards missed: the machine only fails after lunch.",
  },
  {
    slug: "memory-palace-supermarket",
    kind: DEMO_SEED_KIND,
    category: 27,
    cluster: "loop",
    importanceScore: 73,
    wowScore: 77,
    text: "The supermarket aisle where my father taught me prices is still a memory palace; inflation changed the labels but not the route.",
  },
  {
    slug: "ai-lullaby-credits",
    kind: DEMO_SEED_KIND,
    category: 28,
    cluster: "tension",
    importanceScore: 76,
    wowScore: 81,
    text: "An AI-generated lullaby credits the dataset singers, and suddenly bedtime becomes a question about whose comfort is being borrowed.",
  },
  {
    slug: "repair-cafe-ritual",
    kind: DEMO_SEED_KIND,
    category: 29,
    cluster: "morph",
    importanceScore: 82,
    wowScore: 84,
    text: "At the repair cafe, the ritual is not fixing the toaster; it is making a private failure public enough to become teachable.",
  },
  {
    slug: "park-bench-api",
    kind: DEMO_SEED_KIND,
    category: 30,
    cluster: "convergence",
    importanceScore: 79,
    wowScore: 83,
    text: "A park bench with a QR code for local stories turns sitting down into an API call against the neighborhood's collective memory.",
  },
];

export const DEMO_WOW_MOMENTS: DemoWowMomentSeed[] = [
  {
    slug: "public-systems-as-instruments",
    title: "Public systems keep turning into instruments",
    kind: "surprise_bridge",
    wowScore: 92,
    why: "The train chime, museum bench, and school soundscape all reframe civic infrastructure as something people can listen with, rest in, or compose through—not just obey.",
    reflectionQuestion: "Where else could a rule-bound public system become expressive without becoming chaotic?",
    related: [
      {
        inspirationSlug: "train-platform-scores",
        role: "sonic clue",
        reason: "Turns transit operations into accidental music.",
      },
      {
        inspirationSlug: "museum-bench-protocol",
        role: "spatial clue",
        reason: "Shows how a simple object changes the tempo of attention.",
      },
      {
        inspirationSlug: "school-bell-redesign",
        role: "designed reversal",
        reason: "Makes command-time participatory and authored.",
      },
    ],
  },
  {
    slug: "memory-tools-have-teeth",
    title: "Memory tools have teeth",
    kind: "tension",
    wowScore: 89,
    why: "The recipe card, Thursday question, and auto-tagged archive all preserve memory while also changing what counts as remembering. The tool helps, but it also edits the relationship.",
    reflectionQuestion: "What should a memory system refuse to make too easy?",
    related: [
      {
        inspirationSlug: "family-photo-archive",
        role: "ethical edge",
        reason: "Searchability gives grief a handle and a hazard.",
      },
      {
        inspirationSlug: "same-question-thursday",
        role: "recurring question",
        reason: "Keeps testing whether return beats recall.",
      },
      {
        inspirationSlug: "recipe-as-memory-palace",
        role: "embodied counterpoint",
        reason: "Stores memory in use marks, not just metadata.",
      },
    ],
  },
  {
    slug: "care-becomes-interface",
    title: "Care becomes an interface when it is made public",
    kind: "recurrence",
    wowScore: 91,
    why: "The time bank, repair cafe, and teacher feedback note all turn care from private labor into visible structure people can learn from and trust.",
    reflectionQuestion: "What hidden care work would become more powerful if its interface were visible?",
    related: [
      {
        inspirationSlug: "neighborhood-time-bank",
        role: "economic reversal",
        reason: "Prices neglected care in equal hours instead of market value.",
      },
      {
        inspirationSlug: "repair-cafe-ritual",
        role: "teaching ritual",
        reason: "Makes private breakdown public enough to teach.",
      },
      {
        inspirationSlug: "teacher-red-pen-ai",
        role: "human signature",
        reason: "Marks the precise place automation becomes care.",
      },
      {
        inspirationSlug: "ai-classroom-margin",
        role: "learner friction",
        reason: "Shows the margin note as proof of arguing with the machine.",
      },
    ],
  },
  {
    slug: "place-based-computing",
    title: "The best computers ask you to notice where you are",
    kind: "bridge",
    wowScore: 88,
    why: "Birdsong passwords, park-bench stories, and streetlights that respond to footsteps suggest computation can deepen attention to place instead of abstracting it away.",
    reflectionQuestion: "How could the next interaction reward attention instead of speed?",
    related: [
      {
        inspirationSlug: "birdsong-passwords",
        role: "local authentication",
        reason: "Turns access into listening to the park.",
      },
      {
        inspirationSlug: "park-bench-api",
        role: "situated archive",
        reason: "Makes sitting down query collective memory.",
      },
      {
        inspirationSlug: "streetlight-story-mode",
        role: "responsive infrastructure",
        reason: "Lets public light behave like narrative pacing.",
      },
    ],
  },
  {
    slug: "failure-as-archive",
    title: "Failures are archives in disguise",
    kind: "outlier",
    wowScore: 86,
    why: "Failed maps, bug reports, and labeled garden mistakes show error as a preservation layer: the wrong turn often holds more instruction than the polished path.",
    reflectionQuestion: "Which failure is worth preserving before it gets cleaned up?",
    related: [
      {
        inspirationSlug: "archive-of-failed-maps",
        role: "counter-history",
        reason: "Shows desired roads and erased shortcuts.",
      },
      {
        inspirationSlug: "handwritten-bug-report",
        role: "situated diagnosis",
        reason: "Captures a lunch-time failure dashboards missed.",
      },
      {
        inspirationSlug: "gardener-version-control",
        role: "physical changelog",
        reason: "Labels mistakes as instructions for care.",
      },
    ],
  },
  {
    slug: "endings-that-teach",
    title: "Good endings teach people how to continue",
    kind: "outlier",
    wowScore: 85,
    why: "Compostable interfaces, soft robots in rot, and repaired umbrellas all make endings active: decay, weather, and repair become design materials.",
    reflectionQuestion: "What would change if the product ending were designed as carefully as onboarding?",
    related: [
      {
        inspirationSlug: "compostable-interface",
        role: "material afterlife",
        reason: "Makes end-of-life touchable and alive.",
      },
      {
        inspirationSlug: "soft-robot-compost",
        role: "negotiated decay",
        reason: "Recasts technology as cooperation with rot.",
      },
      {
        inspirationSlug: "broken-umbrella-commons",
        role: "shared repair",
        reason: "Turns bad weather into common inventory.",
      },
    ],
  },
  {
    slug: "attention-is-a-commons",
    title: "Attention is a commons before it is a productivity metric",
    kind: "tension",
    wowScore: 84,
    why: "The quiet car, midnight library, and forgotten tabs all defend fragile attention states that are easily monetized, rushed, or lost.",
    reflectionQuestion: "Where does the product need to protect attention rather than harvest it?",
    related: [
      {
        inspirationSlug: "quiet-car-debate",
        role: "social boundary",
        reason: "Shows attention as negotiated permission.",
      },
      {
        inspirationSlug: "library-after-dark",
        role: "noncommercial refuge",
        reason: "Creates presence without requiring purchase.",
      },
      {
        inspirationSlug: "forgotten-tab-garden",
        role: "almost-intention",
        reason: "Keeps unfinished curiosity visible.",
      },
    ],
  },
  {
    slug: "soundtracks-of-shared-life",
    title: "Shared life has accidental soundtracks",
    kind: "bridge",
    wowScore: 83,
    why: "Air conditioners, platform chimes, and student-composed bells reveal everyday systems as scores that choreograph public emotion.",
    reflectionQuestion: "What ambient system already has a score people understand?",
    related: [
      {
        inspirationSlug: "choir-of-air-conditioners",
        role: "ambient chorus",
        reason: "Private machines create collective summer sound.",
      },
      {
        inspirationSlug: "train-platform-scores",
        role: "transit motif",
        reason: "Turns announcements into public music.",
      },
      {
        inspirationSlug: "school-bell-redesign",
        role: "authored time",
        reason: "Lets students compose the day boundary.",
      },
    ],
  },
  {
    slug: "borrowed-comfort",
    title: "Borrowed comfort needs credits",
    kind: "tension",
    wowScore: 82,
    why: "AI lullabies, robot-pet funerals, and searchable grief each ask who or what carries the emotional cost when technology becomes intimate.",
    reflectionQuestion: "What comfort should be accompanied by attribution, consent, or friction?",
    related: [
      {
        inspirationSlug: "ai-lullaby-credits",
        role: "attribution question",
        reason: "Makes bedtime ask whose voices are borrowed.",
      },
      {
        inspirationSlug: "robot-pet-funeral",
        role: "care before certainty",
        reason: "Shows attachment outrunning ontology.",
      },
      {
        inspirationSlug: "family-photo-archive",
        role: "searchable grief",
        reason: "Turns memory access into an ethical edge.",
      },
      {
        inspirationSlug: "sleep-mode-museum",
        role: "rest metaphor",
        reason: "Makes technical unavailability feel like an ethics of rest.",
      },
    ],
  },
  {
    slug: "civic-calendars-reveal-values",
    title: "Civic calendars reveal what a place values",
    kind: "recurrence",
    wowScore: 80,
    why: "The public pool, elevator threshold, and supermarket route all show mundane schedules and paths as compressed civic memory.",
    reflectionQuestion: "Which ordinary schedule would reveal the strongest hidden value if visualized?",
    related: [
      {
        inspirationSlug: "public-pool-calendar",
        role: "shared resource",
        reason: "Shows many publics competing for one blue rectangle.",
      },
      {
        inspirationSlug: "elevator-as-threshold",
        role: "transition ritual",
        reason: "Turns a short ride into self-editing time.",
      },
      {
        inspirationSlug: "memory-palace-supermarket",
        role: "economic memory",
        reason: "Maps inflation across a remembered route.",
      },
      {
        inspirationSlug: "grandmother-search-history",
        role: "adaptive biography",
        reason: "Shows a life story through substitutions, guests, and pride.",
      },
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
