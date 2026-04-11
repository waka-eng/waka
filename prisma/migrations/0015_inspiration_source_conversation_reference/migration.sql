DO $$
BEGIN
  IF to_regclass('public."Inspiration"') IS NOT NULL THEN
    ALTER TABLE "Inspiration"
      ADD COLUMN IF NOT EXISTS "sourceConversationRef" TEXT;

    UPDATE "Inspiration"
    SET
      "sourceConversationRef" = COALESCE(
        "sourceConversationRef",
        NULLIF(
          BTRIM(
            COALESCE(
              "sourceMeta"->>'sourceConversationRef',
              "sourceMeta"->>'conversationRef'
            )
          ),
          ''
        ),
        CASE
          WHEN NULLIF(BTRIM(COALESCE("sourceMeta"->>'provider', '')), '') IS NULL
            THEN NULL
          WHEN NULLIF(BTRIM("sourceMeta"->>'conversationId'), '') IS NOT NULL
            THEN CONCAT(
              'ai-conversation-ref:v1:',
              LOWER(BTRIM("sourceMeta"->>'provider')),
              ':conversation=',
              BTRIM("sourceMeta"->>'conversationId')
            )
          WHEN NULLIF(BTRIM("sourceMeta"->>'threadId'), '') IS NOT NULL
            THEN CONCAT(
              'ai-conversation-ref:v1:',
              LOWER(BTRIM("sourceMeta"->>'provider')),
              ':thread=',
              BTRIM("sourceMeta"->>'threadId')
            )
          WHEN NULLIF(BTRIM("sourceMeta"->>'shareId'), '') IS NOT NULL
            THEN CONCAT(
              'ai-conversation-ref:v1:',
              LOWER(BTRIM("sourceMeta"->>'provider')),
              ':share=',
              BTRIM("sourceMeta"->>'shareId')
            )
          WHEN NULLIF(BTRIM("sourceMeta"->>'sourceId'), '') IS NOT NULL
            THEN CONCAT(
              'ai-conversation-ref:v1:',
              LOWER(BTRIM("sourceMeta"->>'provider')),
              ':source=',
              BTRIM("sourceMeta"->>'sourceId')
            )
          WHEN NULLIF(
            BTRIM(COALESCE("sourceMeta"->>'conversationUrl', "sourceUrl")),
            ''
          ) IS NOT NULL
            THEN CONCAT(
              'ai-conversation-ref:v1:',
              LOWER(BTRIM("sourceMeta"->>'provider')),
              ':url=',
              BTRIM(COALESCE("sourceMeta"->>'conversationUrl', "sourceUrl"))
            )
          ELSE NULL
        END
      )
    WHERE "sourceType" = 'AI_CONVERSATION'
      AND "sourceConversationRef" IS NULL;

    CREATE INDEX IF NOT EXISTS "Inspiration_userId_sourceConversationRef_idx"
      ON "Inspiration" ("userId", "sourceConversationRef");
  END IF;
END
$$;
