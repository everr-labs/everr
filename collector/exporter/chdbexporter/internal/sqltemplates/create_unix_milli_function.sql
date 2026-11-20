-- everrUnixMilliOrEpoch UDF for the local collector's chDB. Registered with
-- the recordings layout, before its table is created, because the table's
-- MATERIALIZED columns call it.
--
-- The statement must stay identical to the one in
-- packages/app/clickhouse/0013-create-recordings.sql.
-- packages/app/src/db/clickhouse-migrations.test.ts compares them.
--
-- Unix milliseconds from a client-sent attribute (as text) to a DateTime64(3).
-- Total: a value that is not a number, is negative, or is past the end of the
-- DateTime64 range (2299-12-31) becomes the epoch instead of throwing or
-- wrapping.
CREATE OR REPLACE FUNCTION everrUnixMilliOrEpoch AS (raw) ->
  fromUnixTimestamp64Milli(
    toInt64(if(toFloat64OrZero(raw) BETWEEN 0 AND 10413791999999, toFloat64OrZero(raw), 0))
  )
