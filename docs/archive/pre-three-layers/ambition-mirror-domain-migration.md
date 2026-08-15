# Ambition Mirror Domain Migration Plan

WAKA is moving from an inspirations capture app toward an ambition mirror powered
by a personal context graph. This plan keeps existing behavior stable while new
code adopts signal, context graph, top-of-mind, and feedback language.

## Domain Rename Map

| Existing concept | New product concept | Migration direction |
| --- | --- | --- |
| Inspiration | Signal | A captured item or high-intent personal context event. Keep persisted `inspirations` during compatibility, but expose new TypeScript/API aliases as `signal` first. |
| Inspiration spark | Signal excerpt / signal packet input | Treat `inspiration_sparks` as provenance-rich slices of a signal. Later code can rename this layer after signal packet types land. |
| Meaning packet | Signal packet | A compact interpretation of one signal. Keep `meaning_packets` readable while service and route code moves to `signal_packet` naming. |
| Meaning node | Context node | A durable graph claim about themes, values, people, environments, aesthetics, tensions, projects, open questions, or hypotheses. |
| Meaning edge | Context edge | A relationship between context nodes. Existing edge kinds can remain as compatibility values until typed context edge categories are introduced. |
| Meaning evidence | Context evidence | Provenance linking graph claims back to signals and signal packets. |
| WOW moment | Top-of-mind note | A provisional post-it-style reflection generated from graph context. WOW storage and routes remain compatibility surfaces until `/api/top-of-mind` and UI migration are complete. |
| Belief/reflection prompt in WOW detail | Top-of-mind note body / correction prompt | Keep the reflective tone, but make the note feel replaceable, evidence-backed, and easy to correct. |
| User response to belief resonance | Feedback | User validation or correction that improves future graph state. |
| Gemini classifier/generator | Model provider | Keep Gemini as implementation detail while domain services depend on provider-neutral model interfaces. |

## Persistence Strategy

Initial stories should avoid destructive table renames. Existing rows must stay
readable, existing tests should continue to exercise compatibility routes, and
new code should introduce signal-facing aliases before migrations.

| Current table | Target domain name | Strategy |
| --- | --- | --- |
| `inspirations` | `signals` | Wrap first. Add signal-facing shared types and serializers that map to the existing table. Defer physical table rename until API and web surfaces no longer depend on inspiration naming. |
| `inspiration_sparks` | signal excerpts or signal packet evidence input | Leave persisted name during early migration. Revisit once signal packet generation owns the terminology. |
| `inspiration_embeddings` | signal embeddings | Wrap first. Keep table name while embeddings still belong one-to-one to captured signals. |
| `inspiration_revisit_events` | signal revisit events | Wrap first. These remain useful as recurrence and agency inputs for top-of-mind ranking. |
| `meaning_packets` | `signal_packets` | Wrap first, then migrate. Old rows must be readable as signal packets. A later migration can rename the table or add a compatibility view. |
| `meaning_nodes` | `context_nodes` | Migrate after node categories are typed. Existing nodes should receive a deterministic default category during migration. |
| `meaning_edges` | `context_edges` | Migrate with context nodes. Preserve existing active/stale status, weight, confidence, evidence ids, and tenant scope. |
| `meaning_evidence` | `context_evidence` | Migrate with context nodes. Preserve packet and signal provenance. |
| `wow_moments` | `top_of_mind_notes` | Wrap first. Add top-of-mind serializers mapped from WOW rows, then add or migrate persistence once note status, confidence, related signal ids, and related context node ids are represented. |
| `wow_moment_inspirations` | top-of-mind note signal references | Wrap first. Preserve role, reason, sort order, and tenant-scoped foreign keys. |
| `background_jobs` types `process_inspiration`, `meaning_graph_rebuild` | `process_signal`, `context_graph_rebuild`, top-of-mind refresh jobs | Add new job types only when workers are migrated. Keep old job types readable until pending/running jobs drain. |
| Future feedback table | `feedback` | Add new persistence using the new vocabulary. It should target `signal`, `context_node`, `top_of_mind_note`, and `hypothesis`. |

## API Route Strategy

Compatibility routes stay live while new routes are introduced. New clients
should prefer signal and top-of-mind routes once they exist.

| Current route | Target route | Strategy |
| --- | --- | --- |
| `GET/POST/PATCH/DELETE /api/inspirations` | `/api/signals` | Add signal-facing types first, then add route aliases. Keep inspiration routes until web UI and tests have migrated. |
| `/api/attachments` with `inspirationId` | `/api/attachments` with `signalId` | Wrap request/response names after signal aliases exist. Keep accepting `inspirationId` during compatibility. |
| `/api/wow-moments` | `/api/top-of-mind` | Add top-of-mind route returning active note serializers and evidence previews. Keep WOW routes until old UI paths are removed. |
| `/api/wow-status` | internal top-of-mind/job status or remove | Leave internal/demo-only while capture pipeline migration is underway. Do not make it a primary product surface. |
| `/api/admin/meaning-graph` | internal `/api/admin/context-graph` | Keep admin-only. Add a context-graph alias when context node persistence migrates. |
| `/api/admin/top-of-mind-preview` | internal top-of-mind preview | Keep internal and tenant-scoped. It can support QA and deterministic refresh testing, not the primary user experience. |
| Background job admin routes | internal job admin routes | Leave internal. Rename displayed job labels only after job type migration. |

## Web Component Strategy

Visible product language should move earlier than physical persistence names,
but internal admin components can lag behind if they are clearly internal.

| Current component/page | Target surface | Strategy |
| --- | --- | --- |
| `CaptureForm`, `CaptureCell`, `InspirationsBoard`, `InspirationCard`, history detail components | Signal capture and signal history | Rename visible copy toward signal, resonance, and "what hit." Defer component file renames until route/API aliases are stable. |
| `WowMomentsSection` | Top-of-mind notes | Keep the post-it visual metaphor. Change copy and serializers so notes feel provisional, replaceable, and evidence-backed. |
| `MeaningGraph` admin page | Internal context graph inspector | Keep internal. It may be renamed after API context graph aliases exist, but it must not become the main user-facing graph UI. |
| Admin WOW/status panels | Internal top-of-mind and job inspection | Keep behind internal/demo gates. Avoid exposing raw graph internals in user-facing note evidence drawers. |
| I18n message keys containing inspiration/WOW/meaning | Signal/top-of-mind/context keys | Update visible copy with tests. Old keys can remain temporarily if hidden or internal. |

## Internal Graph Inspection Boundary

The admin graph inspector remains internal. The user-facing experience should
not become a literal graph visualization. Graph-backed output should appear as:

- provisional top-of-mind notes with post-it affordances,
- concise evidence drawers that show supporting signals and readable context,
- lightweight feedback controls for validation and correction,
- later decision memos that summarize what the user seems drawn to.

Raw node ids, edge ids, model-provider payloads, graph rebuild mechanics, and
admin health details should remain in internal routes and admin-only UI.

## Phased Compatibility Plan

1. Add vocabulary aliases and documentation first. Signal-facing TypeScript
   types should serialize current inspiration rows without behavior changes.
2. Add context graph categories while preserving existing meaning graph rows
   through deterministic defaults.
3. Rename service code from meaning packet to signal packet while keeping
   `meaning_packets` readable.
4. Wrap WOW rows as top-of-mind notes, then add `/api/top-of-mind` with evidence
   previews and tenant-scoped serialization.
5. Add feedback persistence and deterministic graph-weight application. Feedback
   updates should record provenance and should not erase user data.
6. Refresh top-of-mind notes from context graph candidates with deduplication.
7. Migrate the home surface and capture copy to top-of-mind and signal language.
8. After API and web clients no longer rely on old names, decide whether to run
   physical table/route/component renames or keep old names as internal storage
   details documented in the final compatibility audit.

During the migration, tests should cover both old compatibility surfaces and new
domain serializers. Existing data should never require backfill just to remain
listable; backfills should only add new optional fields, deterministic defaults,
or derived graph state.

## Test Compatibility Notes

- Existing inspiration capture/list tests remain regression tests until
  `/api/signals` reaches parity.
- Existing WOW route and component tests remain useful while top-of-mind notes
  are backed by WOW persistence.
- Meaning graph writer/admin graph tests should move to context graph language
  as node categories land, while preserving tenant scoping and admin-only gates.
- Frontend stories that change visible copy or top-of-mind interaction still
  require browser verification before being marked complete.

## Final Naming Conventions

- New product-facing UI, docs, model prompts, and web API helpers should say
  signal, signal packet, context graph, context node, top-of-mind note,
  resonance, and feedback.
- `wow_moments`, `wow_score`, `/api/wow-moments`, and related TypeScript names
  are legacy compatibility surfaces only. Prefer `/api/top-of-mind` and
  top-of-mind serializers for user-facing work.
- Admin-only diagnostics may mention legacy table, route, or enum names when
  needed to debug compatibility, but visible labels should explain the product
  concept as top-of-mind notes, resonance, or context.
