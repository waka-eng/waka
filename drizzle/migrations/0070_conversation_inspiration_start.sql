-- WHICH SAVED THING A CONVERSATION IS ABOUT, so the reply can read it instead
-- of hoping retrieval surfaces it.
--
-- Founder: "I basically want to have a good experience where user can pick an
-- inspiration on the right and then like chat about it and then when the user
-- specifically brings that up then the agent can read it."
--
-- THE LAST CLAUSE IS WHY THIS IS A COLUMN. Retrieval already reads the archive
-- two ways — lexical overlap (`readConversationMaterial`) and embeddings
-- (`readSemanticConversationCandidates`) — and both answer the question "what
-- in here resembles the sentence just typed". Neither answers "the person is
-- pointing at THIS one". The keeps where the two diverge are not an edge case:
-- a photo whose text is a caption, a saved link, a Korean note asked about in
-- English, a one-word keep. Those are exactly the ones a person picks off the
-- right-hand rail and then says "what do you think?" about — a sentence with
-- no overlap with anything. Stored, the pin is certain; inferred, it is a
-- coincidence we would be charging the founder's users for.
--
-- MUTABLE, WHICH IS WHERE IT PARTS FROM `initial_principle_id` (0062). A
-- principle start is a fact about a conversation's origin and can never have
-- been otherwise. A picked keep is where the conversation is aimed, and "pick
-- an inspiration on the right and then like chat about it" is a rail the
-- person keeps using while the thread is open — they switch. So PATCH
-- /conversations/:id writes this column after create, and `initial_` survives
-- in the name only to keep the two siblings legible as one family on the row.
--
-- NULLABLE, NULL BY DEFAULT, NO BACKFILL. Most conversations are about nothing
-- in the archive; every row that exists on the day this runs is one of those;
-- and putting the rail back to "nothing" is an action the person can take, so
-- NULL is a reachable answer rather than only an unfilled one. There is no
-- default and nothing to guess from — a conversation's messages are not
-- evidence that it was aimed at a keep, and inventing a pin from them would be
-- the product deciding what someone meant.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS initial_inspiration_id uuid;--> statement-breakpoint

-- OWNERSHIP MADE STRUCTURAL, NOT CHECKED. The reference is to
-- (profile_id, id) — the pair `inspirations_profile_id_id_unique` exists to
-- be the target of — and not to `id` alone. With the composite key, a
-- conversation physically cannot name another profile's keep: the row
-- Postgres would need in order to accept the write is not there. With a
-- single-column key it could, and tenant isolation would rest on every
-- present and future handler remembering to filter by profile. One of those
-- is an invariant; the other is a habit. This column is read straight into a
-- model prompt, which is the worst possible place for a habit.
--
-- ON DELETE SET NULL (initial_inspiration_id) — THE COLUMN LIST IS LOAD-
-- BEARING. A bare composite SET NULL nulls every column in the key, so
-- deleting a keep would also null `profile_id` and detach the conversation
-- from its owner. The column-list form, which Postgres has had since 15, nulls
-- only the pin: delete the keep and the conversation stays owned, stays
-- readable, and is simply no longer about anything. That matches the founder
-- law that fading never deletes — losing the source must not cost the thread.
-- CASCADE was rejected for the same reason: the conversation is the person's
-- words, not the keep's dependent.
--
-- Guarded the way 0004 guards its type: there is no ADD CONSTRAINT IF NOT
-- EXISTS, and a migration that cannot survive meeting its own effects takes
-- every later migration down with it behind an un-rerunnable file.
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_initial_inspiration_fk"
    FOREIGN KEY ("profile_id","initial_inspiration_id")
    REFERENCES "public"."inspirations"("profile_id","id")
    ON DELETE SET NULL("initial_inspiration_id") ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
