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
