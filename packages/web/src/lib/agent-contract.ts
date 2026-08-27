/**
 * WHAT THE AGENT ENDPOINTS WILL HAND OVER — declared before they exist.
 *
 * The backend for agent profiles is not built yet: agent ids and the MCP
 * tools are still being made, and the founder's instruction is that the
 * DESIGN can and should be done now. So the shapes are written here first,
 * `lib/fixture/agent-walls.ts` produces them, and the surface renders them.
 * When the four endpoints land, they are checked against this file, the
 * fixture is deleted, and nothing that reads these types changes:
 *
 *   GET /api/agents                  → ApiAgentSummary[]
 *   GET /api/agents/:id/direction    → ApiAgentDirection   (current + history[])
 *   GET /api/agents/:id/top-of-mind  → ApiAgentTopOfMind   (its sky)
 *   GET /api/agents/:id/inspirations → ApiAgentSignal[]    (origin, producedBy)
 *
 * THESE ARE SHAPES, AND SHAPES ARE NOT FIXTURE. Nothing in this file invents
 * a value. It is as real as any other declaration of a payload — the only
 * unusual thing about it is that the server which will send that payload has
 * not been written, so for now the only thing producing these is a fixture.
 *
 * They lived inside the fixture until now, on the reasoning that keeping the
 * shapes beside the invented rows made the whole thing self-contained and
 * deletable in one go. That stopped being true the moment product code needed
 * them: `space/inspiration/orb.ts` and `space-kinds/agent.ts` both import
 * from here, and while this was `lib/fixture` those two files read as though
 * the product depended on made-up data. It never did. The dependency runs
 * fixture → contract, which is also the order the two will be deleted in.
 *
 * When the endpoints exist this file's contents belong in `lib/api.ts`, which
 * `docs/architecture.md` names as the only place HTTP happens. It is separate
 * today because `api.ts` is where things that are FETCHED are described, and
 * none of this is fetched yet.
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
