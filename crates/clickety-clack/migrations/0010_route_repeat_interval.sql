-- Optional still-firing reminder cadence per route. NULL = never re-notify
-- (the pre-existing behavior, and the default for old rows).
ALTER TABLE routes
    ADD COLUMN repeat_interval_secs INT;
