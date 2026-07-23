-- First-class identity: namespace ('' = live; consumers stamp preview ids)
-- and name (the as-code address, "project/slug" for everr-owned resources),
-- unique per (tenant, namespace, name). Backfilled from the identity
-- annotations this migration retires (everr.name / everr.project /
-- everr.preview); rows with no everr.name get a generated name from the id.

-- rules: both columns are new.
ALTER TABLE rules ADD COLUMN namespace TEXT NOT NULL DEFAULT '';
ALTER TABLE rules ADD COLUMN name TEXT;

UPDATE rules SET
    namespace = COALESCE(spec->'annotations'->>'everr.preview', ''),
    name = CASE
        WHEN spec->'annotations' ? 'everr.name' THEN
            COALESCE(spec->'annotations'->>'everr.project', 'default')
                || '/' || (spec->'annotations'->>'everr.name')
        ELSE 'rule-' || left(id::text, 8)
    END;

-- Disambiguate any pre-existing duplicates before the unique index lands:
-- later duplicates (by created_at, id) get a short-id suffix.
WITH d AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY tenant, namespace, name
               ORDER BY created_at, id
           ) AS rn
    FROM rules
)
UPDATE rules SET name = rules.name || '-' || left(rules.id::text, 8)
FROM d
WHERE d.id = rules.id AND d.rn > 1;

ALTER TABLE rules ALTER COLUMN name SET NOT NULL;
CREATE UNIQUE INDEX rules_tenant_ns_name_idx ON rules (tenant, namespace, name);

-- slos: name already exists (unique per tenant); add namespace, rewrite
-- names from the annotations (this strips the ".pv-<hash>" preview suffix
-- workaround, whose rows carry everr.name + everr.preview), and rescope
-- uniqueness to (tenant, namespace, name).
ALTER TABLE slos ADD COLUMN namespace TEXT NOT NULL DEFAULT '';

-- Drop the legacy per-tenant unique index BEFORE the backfill: rewriting a
-- preview clone's ".pv-<hash>" name back to the live SLO's name is a
-- (tenant, name) collision by design, legal only under the namespaced index
-- created below.
DROP INDEX slos_tenant_name_idx;

UPDATE slos SET
    namespace = COALESCE(spec->'annotations'->>'everr.preview', ''),
    name = CASE
        WHEN spec->'annotations' ? 'everr.name' THEN
            COALESCE(spec->'annotations'->>'everr.project', 'default')
                || '/' || (spec->'annotations'->>'everr.name')
        ELSE name
    END;

WITH d AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY tenant, namespace, name
               ORDER BY created_at, id
           ) AS rn
    FROM slos
)
UPDATE slos SET name = slos.name || '-' || left(slos.id::text, 8)
FROM d
WHERE d.id = slos.id AND d.rn > 1;

CREATE UNIQUE INDEX slos_tenant_ns_name_idx ON slos (tenant, namespace, name);
