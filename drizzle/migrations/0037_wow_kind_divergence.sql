-- New wow kind for reading-divergence announcements: the same signal reads
-- differently beside a room than it does alone. Produced only by the
-- announcer (never the wow judge), and only ever on the signal owner's own
-- board — the row references their private solo reading.
ALTER TYPE "wow_kind" ADD VALUE IF NOT EXISTS 'divergence';
