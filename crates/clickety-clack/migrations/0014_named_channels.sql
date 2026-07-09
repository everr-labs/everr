-- Channels become standalone named resources: the secret-bearing endpoint
-- configs, unique by (tenant, name). Receivers become named sets of channel
-- REFERENCES: their `channels` column now holds a JSON array of channel names
-- instead of inline config objects.
--
-- Backfill: every inline config of every pre-reference receiver is materialized
-- as a named channel (name `<receiver>-<type>`, suffixed `-2`, `-3`, ... on a
-- same-name collision; deterministic, no config dedup across receivers), then
-- the receiver row is rewritten to reference those names. The
-- `jsonb_typeof(elem) = 'object'` guard limits the backfill to inline-config
-- rows, so both statements are no-ops on fresh databases (no rows) and on rows
-- already holding name arrays. Config values are copied verbatim: secret fields
-- are already encryption envelopes at rest, and the same cipher reads them from
-- the channels table.

CREATE TABLE channels (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    name        TEXT NOT NULL,
    config      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant, name)
);
CREATE INDEX channels_tenant_idx ON channels (tenant);

WITH inline AS (
    SELECT r.tenant,
           r.name AS receiver_name,
           elem.config,
           elem.ord,
           r.name || '-' || (elem.config->>'type') AS base
    FROM receivers r,
         LATERAL jsonb_array_elements(r.channels) WITH ORDINALITY AS elem(config, ord)
    WHERE jsonb_typeof(r.channels) = 'array'
      AND jsonb_typeof(elem.config) = 'object'
),
named AS (
    SELECT tenant, config, base,
           row_number() OVER (PARTITION BY tenant, base ORDER BY receiver_name, ord) AS rn
    FROM inline
)
INSERT INTO channels (id, tenant, name, config)
SELECT gen_random_uuid(),
       tenant,
       CASE WHEN rn = 1 THEN base ELSE base || '-' || rn END,
       config
FROM named;

-- Rewrite each backfilled receiver to reference its materialized channels by
-- name. The CTE recomputes the exact names of the insert above (same base, same
-- deterministic window ordering); receivers still hold their inline objects at
-- this point, so the recomputation sees identical input.
WITH inline AS (
    SELECT r.tenant,
           r.name AS receiver_name,
           elem.config,
           elem.ord,
           r.name || '-' || (elem.config->>'type') AS base
    FROM receivers r,
         LATERAL jsonb_array_elements(r.channels) WITH ORDINALITY AS elem(config, ord)
    WHERE jsonb_typeof(r.channels) = 'array'
      AND jsonb_typeof(elem.config) = 'object'
),
named AS (
    SELECT tenant, receiver_name, ord, base,
           row_number() OVER (PARTITION BY tenant, base ORDER BY receiver_name, ord) AS rn
    FROM inline
),
agg AS (
    SELECT tenant, receiver_name,
           jsonb_agg(to_jsonb(CASE WHEN rn = 1 THEN base ELSE base || '-' || rn END)
                     ORDER BY ord) AS names
    FROM named
    GROUP BY tenant, receiver_name
)
UPDATE receivers r
SET channels = agg.names
FROM agg
WHERE r.tenant = agg.tenant AND r.name = agg.receiver_name;
