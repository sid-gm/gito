-- Auto-promoted tracked threads expire after a fixed window (1 week) so hot
-- posts stop being re-collected once the window passes; manual adds leave this
-- null and track indefinitely.
--
-- Additive nullable column — safe. Applied by hand (idempotent) to keep a later
-- `drizzle-kit push` a clean no-op, matching the 0001 convention.

ALTER TABLE tracked_threads
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
