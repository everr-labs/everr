-- The SQL API reads every column of recordings except Body (raw rrweb,
-- megabytes per row, holds page text). Content is read through the
-- /api/cli/recordings routes. It is a table grant followed by a revoke of the
-- withheld columns (SQL_API_WITHHELD_COLUMNS in
-- packages/app/src/lib/sql-api-tables.ts, which a test keeps equal to this
-- file), because a column-list grant makes ClickHouse refuse JSON subcolumn
-- reads such as LogAttributes.`url.path`. Size is still readable: length(Body)
-- works, and nothing else of Body does.
--
-- No row policy: self-hosted has one tenant per installation, so the one
-- consequence of the order is only that, between the GRANT and the REVOKE and
-- again on any re-run (GRANT SELECT restores the column), the SQL API user can
-- read Body for a moment. A re-run must always run both statements, in this
-- order.
GRANT SELECT ON app.recordings TO sql_api_role;
REVOKE SELECT(Body) ON app.recordings FROM sql_api_role;
