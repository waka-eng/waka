ALTER TABLE conversations ADD COLUMN opening jsonb;
--> statement-breakpoint
ALTER TABLE conversations ADD CONSTRAINT conversations_opening_descriptor_check CHECK (opening IS NULL OR coalesce((jsonb_typeof(opening) = 'object' AND opening->>'version' = '1' AND opening->>'kind' IN ('source','prompt','activity') AND (opening - ARRAY['version','locale','hash','kind','source','why','supports','question','imageId','key','asOf','day','backing']) = '{}'::jsonb),false));
