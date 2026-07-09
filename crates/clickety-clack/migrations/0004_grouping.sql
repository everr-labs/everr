ALTER TABLE routes
    ADD COLUMN group_by            JSONB,
    ADD COLUMN group_wait_secs     INT,
    ADD COLUMN group_interval_secs INT;
