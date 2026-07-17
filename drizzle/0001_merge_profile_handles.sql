-- Consolidate the two profile-tracking tables into one.
--   twitter_handles      (twitter-only, `handle`)            ─┐
--   tracked_user_handles (generic, `platform` + `username`) ─┴─► profile_handles
--
-- Applied by hand against the DB (this repo uses `drizzle-kit push`, which would
-- read the rename as drop+create and lose data). Fully idempotent — safe to re-run.

DO $$
BEGIN
  -- 1. Rename the generic table (keeps its rows + id/created_at).
  IF to_regclass('public.tracked_user_handles') IS NOT NULL
     AND to_regclass('public.profile_handles') IS NULL THEN
    ALTER TABLE tracked_user_handles RENAME TO profile_handles;
  END IF;

  -- 2. Rename its constraints (a table rename leaves these on the old name;
  --    matching them keeps a later `drizzle-kit push` a clean no-op).
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_user_handles_unique') THEN
    ALTER TABLE profile_handles RENAME CONSTRAINT tracked_user_handles_unique TO profile_handles_unique;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_user_handles_pkey') THEN
    ALTER TABLE profile_handles RENAME CONSTRAINT tracked_user_handles_pkey TO profile_handles_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_user_handles_company_id_companies_id_fk') THEN
    ALTER TABLE profile_handles RENAME CONSTRAINT tracked_user_handles_company_id_companies_id_fk TO profile_handles_company_id_companies_id_fk;
  END IF;

  -- 3. Fold twitter_handles rows in as platform='twitter', then drop the table.
  IF to_regclass('public.twitter_handles') IS NOT NULL THEN
    INSERT INTO profile_handles (company_id, platform, username, created_at)
    SELECT company_id, 'twitter'::platform, handle, created_at
    FROM twitter_handles
    ON CONFLICT ON CONSTRAINT profile_handles_unique DO NOTHING;

    DROP TABLE twitter_handles;
  END IF;
END $$;
