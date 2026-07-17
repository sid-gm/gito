-- Seed after the 0000 full-reset migration. Creates one company, its API key,
-- and its collect_settings row. Multi-company: run once per company.
--
-- 1. Edit the company name below.
-- 2. Run in the Neon SQL console.
-- 3. Copy the returned api_key into the extension popup (Setup → API key) —
--    the old key died with the old companies table.

WITH new_company AS (
  INSERT INTO companies (name, api_key)
  VALUES (
    'CHANGE_ME',  -- ← company name
    'gito_' || replace(gen_random_uuid()::text, '-', '')
  )
  RETURNING id, name, api_key
),
new_settings AS (
  INSERT INTO collect_settings (company_id)
  SELECT id FROM new_company
  RETURNING company_id
)
SELECT id AS company_id, name, api_key FROM new_company;
