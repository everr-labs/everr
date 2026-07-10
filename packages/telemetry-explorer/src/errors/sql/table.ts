export { validateTableName } from "../../sql/table";

// Triage entries live in their own table (ADR 0004), separate from the logs
// table the rest of the errors SQL reads. Unqualified: resolves in the app
// database, like the logs table name does; writers qualify it themselves.
export const ERROR_TRIAGE_EVENTS_TABLE = "error_triage_events";
