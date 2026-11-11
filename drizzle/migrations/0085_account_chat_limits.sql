CREATE TABLE account_chat_limits (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  minute_started_at timestamptz NOT NULL DEFAULT now(),
  minute_count integer NOT NULL DEFAULT 0 CHECK (minute_count >= 0),
  hour_started_at timestamptz NOT NULL DEFAULT now(),
  hour_count integer NOT NULL DEFAULT 0 CHECK (hour_count >= 0)
);
