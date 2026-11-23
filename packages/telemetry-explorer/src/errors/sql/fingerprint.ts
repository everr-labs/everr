import { attributeExists, attributeText } from "../../sql/json-attributes";

// Everr's stable identity for an Error. The collector's everr_fingerprint
// processor stamps it on each exception log as ERROR_FINGERPRINT_ATTRIBUTE.
// Logs stored before the processor ran have no stamp, so those fall back to
// the `errorFingerprint` ClickHouse UDF, which computes the same value
// (collector/processor/everrfingerprintprocessor/testdata/fingerprints.json
// pins both). `if` short-circuits, so stamped rows skip the UDF. Every value
// is read as text, so the query reads subcolumns and never the whole
// LogAttributes column.
const UDF_FINGERPRINT_SQL = `errorFingerprint(ServiceName, ${attributeText("LogAttributes", "error.fingerprint")}, ${attributeText("LogAttributes", "exception.type")}, ${attributeText("LogAttributes", "exception.message")})`;
export const ERROR_FINGERPRINT_ATTRIBUTE = "everr.error.fingerprint";
const STAMPED_FINGERPRINT_SQL = attributeText("LogAttributes", ERROR_FINGERPRINT_ATTRIBUTE);
export const ERROR_FINGERPRINT_SQL = `if(${STAMPED_FINGERPRINT_SQL} != '', ${STAMPED_FINGERPRINT_SQL}, ${UDF_FINGERPRINT_SQL})`;

export const EXCEPTION_LOG_FILTER_SQL = `
  ${attributeExists("ResourceAttributes", "service.name")}
  AND SeverityNumber >= 17
  AND (
    ${attributeExists("LogAttributes", "exception.type")}
    OR ${attributeExists("LogAttributes", "exception.message")}
  )
`;

/**
 * How many distinct Errors a set of log rows holds, as a ClickHouse aggregate.
 *
 * Which rows count as an Error and what makes two of them the same Error are
 * both this module's rules, so callers get the composed aggregate rather than
 * the two halves to combine themselves. Add it to any `SELECT` over `logs`;
 * being a `uniq`, it counts distinct Errors across whatever the query groups
 * by, so a `WITH ROLLUP` total is the range-wide figure and not the sum of the
 * per-group counts.
 */
export function errorIssueCountExpr(): string {
  return `uniqIf(${ERROR_FINGERPRINT_SQL}, ${EXCEPTION_LOG_FILTER_SQL})`;
}
