-- Preview-mode flag for rules. The spec is stored as jsonb, so `suppressed` lives inside
-- `rules.spec` (serde defaults it to false on read); backfill existing rows so the key is
-- always present and SQL reads like (spec->>'suppressed')::bool never see NULL.
UPDATE rules
   SET spec = jsonb_set(spec, '{suppressed}', 'false'::jsonb, true)
 WHERE NOT (spec ? 'suppressed');
