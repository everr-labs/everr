export { validateTableName } from "../../sql/table";

// Triage entries live in their own table (ADR 0004), separate from the logs
// table the rest of the errors SQL reads. Unqualified: resolves in the app
// database, like the logs table name does; writers qualify it themselves.
export const ERROR_TRIAGE_EVENTS_TABLE = "error_triage_events";

// Default logs table the errors surface reads. The Regression rule is only
// correct when Resolution snapshots scan the same table the summary
// derivation matches Occurrences against, so both sides cite this one name.
export const ERRORS_LOGS_TABLE = "logs";
