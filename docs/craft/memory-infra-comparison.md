# Memory infrastructure: where WAKA matches the field, and where nothing matches it

Status: research, authored 2026-08-30.
Purpose: answer one question — mechanism by mechanism, is WAKA's approach
*similar to*, *a different position on*, or *without analog in* the existing
memory-infrastructure landscape? Successor lens to
[`agent-memory-ecosystem-2026.md`](agent-memory-ecosystem-2026.md) (2026-08-22,
strategy) — this doc is the comparison, that doc is the wedge. Corrections to
its facts are recorded in §6.
Method: three parallel research passes on 2026-08-30 — developer memory
infrastructure (code-level, from GitHub HEADs and papers where vendor docs
were egress-blocked), platform/consumer memory (announcements and credible
reporting), and the academic literature (every load-bearing arXiv ID
re-verified). Vendor-only claims are flagged; WAKA's side is taken from
`docs/data-model.md`, `docs/generation.md`, and the code audit in
[`agent-memory-wedge.md`](agent-memory-wedge.md). Sources inline.

---

## The verdict in one paragraph

WAKA's *shape* is now field-standard: everyone extracts with an LLM, matches
with embeddings, keeps history instead of deleting, consolidates in the
background, layers abstractions, and delivers over MCP. WAKA's *positions* on
that shape are mostly one step further along axes the field is already on —
explicit capture instead of transcript mining, arithmetic instead of LLM
arbitration, quotes verified in code instead of links to chunks, a directive
top layer instead of a descriptive persona. And five mechanisms have **no
analog found anywhere** — products or literature: human-only conflict
resolution, structural edit-locks, dismissal as a standing suppression law,
evidence-count promotion, and read-time pure-arithmetic confidence. The
sharpest external fact of the week: the two biggest platforms just split on
the exact axis where WAKA holds a structural third answer — Anthropic
**merged** agent and chat memory (Aug 25), OpenAI had **disabled** memory in
agent mode for safety (July 2025), and WAKA's ruling is neither: separate
stacks, with agents conditioning read-only on the person's.

---

## §0 The landscape, compressed

Three camps, all churning in 2026:

- **Developer infra** — Mem0 (64.3k stars; $24M; extraction → LLM-chosen ops,
  though OSS HEAD is now ADD-only), Zep/Graphiti (temporal knowledge graph,
  bi-temporal edge invalidation; Community Edition discontinued), Letta
  (agent-self-edited memory blocks + sleep-time compute; V1 server retired,
  re-centered on git-backed memory), LangMem (near-frozen), Cognee
  (document→graph ECL), Supermemory (chunks→memories→profile), Memobase
  (profile slots), Honcho (theory-of-mind "peers"), Tencent's Agent
  Memory/Team Memory (L0→L3 pyramid, org ACLs; 20k stars in 90 days), Memori
  (SQL-native, captures agent execution traces).
- **Platform memory** — ChatGPT (background "Dreaming" synthesis since June
  2026; OpenAI concedes the summary page may not show everything remembered;
  ~96% of stored memories are system-initiated), Claude (individual editable
  entries → "Topics" Aug 25, unified across chat and Cowork; the only
  platform with memory import/export), Gemini (retrieval over connected
  accounts; inferred layer has no itemized view), Copilot (memories in a
  hidden Exchange folder — eDiscovery applies), Grok (memories + user-written
  Skills).
- **Literature** — Generative Agents' recency×importance×relevance and
  reflection trees; MemGPT's memory pressure; sleep-time compute; MemoryBank's
  Ebbinghaus decay; MemoryOS heat scores; MIRIX's six typed memories; and the
  2026 benchmark turn from recall to governance (MemoryAgentBench,
  GateMem, MemoryArena, Mem2ActBench).

## §1 Similar — convergent with field practice

Nothing in this section differentiates WAKA; it establishes that the
architecture is orthodox where orthodoxy is right.

| Mechanism | WAKA | The field |
|---|---|---|
| LLM extraction of durable statements from raw input | `extractSignalCandidates`, 0–3 per capture | Universal: Mem0's extraction phase, Zep's entity/edge extraction, Memobase's pipeline, Tencent's L1 atomic facts |
| Embedding similarity for match/dedup | match-or-mint bands (0.7 / 0.86 / 0.94) | Universal: Mem0 retrieves top-10 similar before writing; Zep resolves entities; batch dedupe is table stakes |
| Keep history, don't delete | statement chains, `retired`/`yielded` states, versioned artifacts | Zep's bi-temporal `invalid_at` edges ([arXiv 2501.13956](https://arxiv.org/abs/2501.13956)) are the reference design; superseded facts stay queryable |
| Background consolidation on idle/schedule | nightly principle minting | Letta sleep-time compute ([arXiv 2504.13171](https://arxiv.org/abs/2504.13171)); OpenAI/Anthropic "Dreaming" batch synthesis |
| Multi-level abstraction | 4 layers | Now field-standard shape: Tencent's L0 raw → L3 persona; Zep episodes → entities → communities; Supermemory chunks → memories → profile; MIRIX's six types ([arXiv 2507.07957](https://arxiv.org/abs/2507.07957)) |
| Provenance links from derived to source | `signal_evidence` → inspirations | Zep edges → episodes; Supermemory memories → chunks; Tencent persona → ground-truth drill-down |
| Per-principal namespacing | profiles | Mem0 `user_id`/`agent_id`/`run_id`; Honcho peers; standard |
| MCP as the agent door | waka-mcp | Universal substrate: OpenMemory, Graphiti MCP, Cognee MCP, Supermemory MCP |
| Decay/recency weighting exists | 45d/30d half-lives | Generative Agents' 0.995^hours at retrieval ([arXiv 2304.03442](https://arxiv.org/abs/2304.03442)); MemoryBank's Ebbinghaus curve ([arXiv 2305.10250](https://arxiv.org/abs/2305.10250)); MemoryOS heat ([arXiv 2506.06326](https://arxiv.org/abs/2506.06326)) |
| A "contested" state exists | contested pairs | LatticeMind keeps losing items as contested ([arXiv 2608.08236](https://arxiv.org/html/2608.08236)); BeliefMem holds weighted hypotheses (arXiv 2605.05583) |
| Distilled personal principles exist in research | L4 | Inverse Constitutional AI compresses a person's preferences into a short constitution ([arXiv 2406.06560](https://arxiv.org/abs/2406.06560)); "Superego" gates agent plans on user constitutions (arXiv 2506.13774) |
| Verbatim-quote grounding exists in research | `verifyQuote` | "From Lossy to Verified" substring-matches evidence quotes against raw source ([arXiv 2602.17913](https://arxiv.org/html/2602.17913v1)); Eywa treats facts as revisable indexes over authoritative evidence (arXiv 2605.30771) |

Two of those last rows moved since our 2026-08-22 research: quote
verification and contested states now have published neighbors. Neither is
shipped in any product found.

## §2 Different in degree — same axis, different position

1. **Formation trigger: chosen, not harvested.** The whole field mines
   transcripts (Mem0/Zep/Honcho ingest conversations; ChatGPT's Dreaming
   reads years of chats; ~96% of ChatGPT memories are system-initiated;
   Copilot extracts by default). WAKA's ground is only what the person (or an
   agent, into its own stack) deliberately kept. Closest neighbors: Personal
   .ai's user-curated Memory Blocks, Grok's user-written Skills, Letta's
   operator-edited blocks — all partial. Consequence: WAKA trades recall
   coverage for a ground the owner can stand behind.

2. **Who decides writes: arithmetic vs. LLM judgment.** Mem0's published
   design has an LLM choose ADD/UPDATE/DELETE ([arXiv
   2504.19413](https://arxiv.org/abs/2504.19413)) — and its OSS HEAD now
   hardcodes ADD, punting arbitration to read time. Letta lets the agent
   overwrite its own blocks. WAKA: the model writes sentences; admission,
   promotion, matching bands, and refusal are numbers, and a Postgres trigger
   enforces the promotion bar. The literature is on WAKA's side here:
   deterministic version-aware aggregation beats LLM conflict resolution
   ([arXiv 2606.01435](https://arxiv.org/abs/2606.01435): 94.8% vs the 7–60%
   field on FactConsolidation).

3. **Conflict handling: the spectrum's far end.** Zep invalidates the old
   edge (LLM decides, timestamps record); Mem0 OSS accumulates and lets
   retrieval rank; Supermemory reconciles in background (vendor,
   mechanism unpublished); Letta overwrites. WAKA holds both sides as
   contested and lets *only an owner act* resolve — no published system or
   product reserves resolution exclusively for a human (literature pass,
   explicit could-not-find). The benchmark context makes this position
   valuable: conflict resolution is where everything breaks
   (MemoryAgentBench FactConsolidation: Zep 7%, Mem0 18%, best ≈60% —
   [arXiv 2507.05257](https://arxiv.org/abs/2507.05257)).

4. **Decay: computed, never stored.** Systems either mutate stored scores
   (MemoryBank reinforcement, MemoryOS heat) or have no decay at all (Zep,
   Mem0, Letta, MIRIX). WAKA's confidence is a pure function of the evidence
   set and the clock, evaluated at read, with evidence dated by the witnessing
   capture. Generative Agents computes recency at retrieval but stores
   importance; read-time-only arithmetic confidence appears in practitioner
   essays, not in any peer-reviewed system or shipped product found.

5. **The top layer: directive, not descriptive.** The field's highest
   abstractions describe the person — Tencent's persona, Memobase's profile,
   Honcho's theory-of-mind representations, ChatGPT's synthesized profile.
   WAKA's L4 prescribes the next choice ("a fact about the person is a
   signal, not a principle"), is rank-ordered for decidability, and the
   owner's declaration is *binding on their agents*. Research analog exists
   (Inverse Constitutional AI); shipped analog doesn't. Grok Skills are
   hand-written directives with no evidence layer beneath them — the two
   halves nobody joins are exactly WAKA's L2→L4 chain: directives *earned
   from* evidence, or declared and then demonstrated.

6. **Provenance depth: verified quotes vs. links.** Zep, Supermemory, and
   Tencent link derived memories to source material; nobody verifies the
   claim inside the link. WAKA stores an evidence quote only if code confirms
   it is a verbatim span of the person's own words, labels whose words it is,
   and refuses model-invented citations at the foreign key. Two 2026 papers
   now describe the same discipline; no product ships it.

7. **Portability: full-fidelity vs. text paste.** Claude became the only
   platform with memory import/export (paste-text, "experimental",
   re-extracted on arrival); Letta's Agent File exports agent+memory state;
   OpenMemory keeps everything local; OpenAI exports conversations but not
   memory. WAKA's export is the whole stack with its structure — chains,
   evidence, suppressions, consultations — plus first-class self-host.
   Same direction as the field's best; more of the truth crosses.

8. **Multi-principal: structure vs. tags.** Mem0 namespaces by ID string;
   Honcho is the field's richest (peers with directional observation flags —
   the closest thing to profiles found); Tencent Team Memory adds org ACLs.
   WAKA's tenancy is composite foreign keys — Postgres physically refuses a
   cross-profile link — and cross-profile access is a matrix with an explicit
   grant verb. Same goal; enforcement moved from convention to schema.

## §3 No analog found (products or literature, 2026-08-30 search)

The literature pass explicitly searched for each and reported
could-not-find; treat "unique" as "no analog found," not "provably novel."

1. **Human-only contradiction resolution.** The machine may name an opposed
   pair; it may never pick the winner — no evidence weight resolves anything,
   and the loser of an owner's verdict becomes `yielded`, a state, never a
   deletion.
2. **Structural edit-locks.** Human-touched statements survive regeneration
   byte-for-byte because the version writer copies them from the previous
   version's database rows — the model is asked to reproduce them and then
   not trusted to. End-user locking exists nowhere in the product field ("no
   system offers end-user memory locking or per-fact correction UI" — infra
   pass); A-MemGuard *names* locking as a defense ([arXiv
   2510.02373](https://arxiv.org/abs/2510.02373)); nobody ships it.
3. **Dismissal as a standing suppression law.** A dismissed pattern's vector
   becomes a refusal anchor: candidates at ≥0.86 cosine are dropped
   pre-match, every refusal logged and reversible. Closest neighbor is
   Agentic Unlearning's blocklist + dependency graph against re-derivation
   ([arXiv 2602.17692](https://arxiv.org/abs/2602.17692)) — different
   mechanism, same intent, and the intent is otherwise unserved: GateMem
   ([arXiv 2606.18829](https://arxiv.org/abs/2606.18829)) shows deleted
   content resurfacing across every method it tests.
4. **Evidence-count promotion.** `emerging → active` at 3 evidence rows,
   enforced twice (code + DB trigger). The field promotes by LLM judgment,
   heat scores, or not at all; nobody counts witnesses. (The 2026-08-22
   research's caveat stands: repetition isn't importance — the
   single-mention-critical-fact gap is real, and `durable-interest` is the
   queued answer.)
5. **Read-time pure-arithmetic confidence** with evidence dated by the
   witnessing capture (an old save cited today widens spread instead of
   faking recency). No cron, no stored mutating score, nothing to poison by
   touching the score itself.

Three more with no analog at the *system* level, though pieces exist:

6. **The agent/human write wall.** Agents read the person's memory
   (conditioning) and cannot write into it — capture across profiles is the
   human's act alone. The platforms just demonstrated both failure modes
   WAKA's ruling avoids: OpenAI disabled memory in agent mode entirely
   (losing conditioning); Anthropic unified agent and chat memory (losing
   separation) — and the memory-poisoning record (SpAIware, CVE-2026-21852,
   OWASP ASI06) says the write path is exactly where the risk lives.
7. **Vote-governed shared memory.** Tencent Team Memory has ACLs but no
   governance for when memory is *wrong*; no system found puts a shared
   artifact behind member votes with majority adoption, counted refusal,
   auto-locking accepted text, and erasure-surviving departed marks — and
   none makes an agent a voting member on equal terms.
8. **Drift-locked self-description.** `generation.md`'s numbers are
   machine-checked against the implementation in CI, both directions. In a
   field where vendor benchmark numbers don't survive reproduction, no
   vendor found holds itself to this.

## §4 Where the field is ahead, honestly

- **Retrieval at scale.** pgvector/graph-native stores everywhere; WAKA
  scans ≤500 vectors in application code — fine for its cardinality
  (patterns, not chat logs), a wall if that assumption breaks.
- **Relationship structure.** Zep, Cognee, HippoRAG model entities and
  associations; WAKA parked its context graph. Multi-hop "how do these
  connect" questions are answered better by graphs.
- **Ingestion breadth.** Cognee's 38 source types, Supermemory's
  OCR/transcription, platform connectors (Gmail/Drive/Photos); WAKA enriches
  links and images only.
- **Execution-trace capture.** Memori records tool calls, decisions, and
  outcomes as memory; WAKA's decision captures are self-reported citations —
  consultation, not observed behavior.
- **Benchmark evidence.** The field has numbers (however shaky); WAKA has
  invariants and zero published scores. "Proof over recall" is the chosen
  posture, and it means no line in anyone's comparison table.
- **Distribution.** OpenMemory is a Docker command; Mem0 is in the AWS
  Strands SDK; platforms are free defaults. WAKA today requires deploying
  your own Lambda — the wedge doc's item 9 remains the gap.

## §5 The platform contrast, sharpened

Worth stating apart because it is the consumer-facing story:

- **Completeness:** OpenAI concedes its memory summary "will not include
  everything ChatGPT remembers"; deleting a conversation no longer deletes
  what was learned from it. Anthropic claims see-everything, edit-anything.
  WAKA's export *is* everything, structurally.
- **Correction:** a documented ChatGPT case of an explicitly deleted memory
  reproduced verbatim ~2 years later (weak source, corroborated complaints);
  in WAKA a dismissal is a logged, standing refusal — and the receipt is
  visible.
- **Provenance:** platform sources are post-hoc and per-response; nobody
  shows per-memory provenance. Every WAKA statement carries its verified
  quotes or doesn't exist.
- **Initiative:** ~96% of ChatGPT memories are system-initiated; 100% of
  WAKA's ground is owner-initiated (or an agent's, in its own stack).

## §6 Corrections and updates to `agent-memory-ecosystem-2026.md`

Recorded so the older doc's readers inherit them:

1. **Mem0:** OSS HEAD confirmed ADD-only *in code* (the 08-22 doc flagged it
   from secondary sources); stars now ~64.3k (not 41k — that figure was the
   Oct 2025 announcement's); the $24M is best read as the Oct 2025 round led
   by Basis Set with seed counted cumulatively in some coverage; "exclusive
   memory provider for AWS Agent SDK" is the vendor PR's phrasing — Mem0 is
   integrated into AWS Strands, while AWS also sells its own AgentCore
   Memory.
2. **GateMem** is a governance *benchmark*, not a mechanism, and the 7%/18%
   conflict figures belong to MemoryAgentBench's FactConsolidation
   specifically. All questioned arXiv IDs verified as real with contents
   matching.
3. **ETH Zurich context-file study** ([arXiv
   2602.11988](https://arxiv.org/abs/2602.11988)): the honest headline is
   broadly negative — LLM-generated files *hurt* (−3% success, +20% cost);
   hand-written ones help modestly (+4%) at similar cost. "Hand-written
   beats generated" stands; "context files work" does not.
4. **Anthropic moved on 2026-08-25:** Topics view, real-time memory writes,
   sensitive-categories opt-in, memory unified across chat and Cowork, and
   paste-text import/export across ChatGPT/Gemini/Grok. **Tripwire 1
   ("platform ships portable + user-lockable + audited memory") is now
   partially fired:** portable (thinly) and editable — but no locking, no
   provenance, no read audit, and the response the wedge doc pre-committed
   (lean harder on multi-principal governance) is already the queue.
5. **OSS churn:** Letta's Apache-2.0 V1 server retired (git-backed memory in
   letta-code is the successor); Zep Community Edition discontinued and fact
   ratings deprecated; LangMem effectively frozen since Oct 2025. The
   "just self-host an OSS memory layer" alternative thinned considerably
   this year.
6. **New neighbors to watch:** Tencent Team Memory (org ACLs, role-scoped
   assembly — the governance story to beat for rooms), Memori
   (execution-trace memory), Honcho (peers/directional observation — the
   nearest multi-principal design).

## §7 What this changes about the story

Nothing structural — the wedge holds; three sentences sharpen:

- The elevator contrast is now datable: *"In August 2026 OpenAI's answer to
  agent memory was to turn it off, and Anthropic's was to merge it with
  yours. Ours is separate stacks: your agents read how you choose and
  physically cannot write into it."*
- "No invented quotes, ever" is no longer unprecedented in research (two
  2026 papers) — the claim to keep is *"no shipped memory product verifies
  its quotes; ours won't store an unverified one."*
- The five no-analog mechanisms (§3, items 1–5) are the defensible "unique"
  list for any external material; everything else is "further along a shared
  axis," and should be said that way — the field converging on our shape is
  evidence the shape is right, not a threat.

---

Sources: inline above. Method caveats: vendor doc sites for Mem0, Letta,
Zep, Supermemory, Memobase, and Honcho plus openai.com/claude.com help pages
were egress-blocked at research time — facts there rest on GitHub source
(primary), papers, and search-indexed snippets; claims resting on
low-authority coverage are marked in the underlying passes. WAKA-side claims
are from the canon docs and the 2026-08-22 code audit, current at this
commit.
