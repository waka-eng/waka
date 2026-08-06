-- Which words in a save carried a reading.
--
-- A save already said THAT it fed a reading, and a citation said WHY in prose.
-- Neither said which words — and the gap is widest exactly where the save is
-- longest, since a thousand-word essay gets credited whole for a reading that
-- turned on one sentence.
--
-- Nullable, and stays null far more often than not: a quote is kept only when
-- it is genuinely present in the save. A missing highlight is honest; a wrong
-- one attributes words to a person who never wrote them.
--
-- `quote_source` says who is speaking. A save's readable text is the person's
-- own words PLUS the page they linked, and a quote from the enrichment is the
-- article talking, not the member. Collapsing the two would quietly attribute
-- an article's argument to someone who only saved a link.
ALTER TABLE "group_top_of_mind_note_signals" ADD COLUMN IF NOT EXISTS "quote" text;--> statement-breakpoint
ALTER TABLE "group_top_of_mind_note_signals" ADD COLUMN IF NOT EXISTS "quote_source" text;--> statement-breakpoint
ALTER TABLE "top_of_mind_note_signals" ADD COLUMN IF NOT EXISTS "quote" text;--> statement-breakpoint
ALTER TABLE "top_of_mind_note_signals" ADD COLUMN IF NOT EXISTS "quote_source" text;
