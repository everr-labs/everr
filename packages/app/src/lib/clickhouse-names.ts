// The database and users the deployment creates and the migrations grant to.
// They are not settings: a different name would connect without any grants.

/** The read model the app queries. */
export const CLICKHOUSE_APP_DATABASE = "app";
/** Reads the read model. */
export const CLICKHOUSE_READER_USER = "app_ro";
/** Writes alert history and provisions SQL API access. */
export const CLICKHOUSE_ADMIN_USER = "app_admin";
/** The self-hosted installation's restricted SQL API identity. */
export const CLICKHOUSE_SQL_API_USER = "sql_api";
