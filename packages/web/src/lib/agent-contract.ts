/**
 * Legacy profile shapes shared by the canvas and source provenance renderer.
 * The application supplies one personal Home and no agent roster. These are
 * retained rendering types, not endpoints or a promise of selectable agents;
 * the former agent-wall fixture and its loader have been removed.
 */
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
  /**
   * How many memories this agent's archive holds, when that is more than
   * arrived. Optional because a fixture bundle is the whole of itself: there
   * is nothing behind it to be short of, and a reader with no total falls
   * back to the length, which for a fixture is the truth.
   */
  inspirationTotal?: number;
}
