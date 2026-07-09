-- A receiver is now a named bundle of one or more channels. Rename the column and
-- wrap every pre-list single-channel value into a one-element array. The type guard
-- makes the backfill a no-op on rows that are already arrays (and on fresh databases,
-- which have no rows at all).
ALTER TABLE receivers RENAME COLUMN channel TO channels;
UPDATE receivers
SET channels = jsonb_build_array(channels)
WHERE jsonb_typeof(channels) <> 'array';
