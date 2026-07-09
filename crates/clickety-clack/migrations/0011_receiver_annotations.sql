-- Free-form receiver metadata. Defaults to '{}' so old rows read as an empty map.
ALTER TABLE receivers
    ADD COLUMN annotations JSONB NOT NULL DEFAULT '{}'::jsonb;
