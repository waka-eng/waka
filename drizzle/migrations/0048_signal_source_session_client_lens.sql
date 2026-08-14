-- Signal provenance + lens-scoped distillation (agent memory groundwork).
--
-- 1. sessions.client — which kind of client a session was minted for
--    ("web" browser flows, "cli" the waka-mcp loopback exchange). Recorded
--    server-side at mint time, never client-supplied.
-- 2. signals.source — who captured the signal ("app" UI, "agent" CLI/MCP),
--    derived from sessions.client at insert time. Existing rows default to
--    'app': they all predate any CLI write path shipping provenance.
-- 3. top_of_mind_notes.lens — which signal slice a note was distilled from
--    ("all" pre-existing behaviour, "app", "agent"). Lens-scoped notes carry
--    a "<lens>:" key prefix, so existing uniqueness indexes need no change.
ALTER TABLE "signals" ADD COLUMN "source" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "client" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "top_of_mind_notes" ADD COLUMN "lens" text DEFAULT 'all' NOT NULL;
