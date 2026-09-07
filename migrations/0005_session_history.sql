ALTER TABLE messages ADD COLUMN IF NOT EXISTS ordinal INTEGER;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY conversation_id
    ORDER BY created_at, CASE actor WHEN 'USER' THEN 0 WHEN 'ASSISTANT' THEN 1 ELSE 2 END, id
  ) AS ordinal
  FROM messages
)
UPDATE messages SET ordinal = ranked.ordinal
FROM ranked
WHERE messages.id = ranked.id AND messages.ordinal IS NULL;

ALTER TABLE messages ALTER COLUMN ordinal SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_ordinal_unique ON messages(conversation_id, ordinal);
CREATE INDEX IF NOT EXISTS messages_conversation_content_idx ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS conversations_owner_updated_idx ON conversations(owner_account_id, updated_at DESC);

ALTER TABLE evidence_items ADD COLUMN IF NOT EXISTS path TEXT;
UPDATE evidence_items SET path = COALESCE(source_id, locator, title) WHERE path IS NULL;
ALTER TABLE evidence_items ALTER COLUMN path SET NOT NULL;
