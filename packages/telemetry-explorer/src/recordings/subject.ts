import type { ErrorOccurrence } from "../errors/data/types";
import { type ClipSubject, RECORDING_STREAM_ATTRIBUTE } from "./data/schemas";

/**
 * The subject a Clip must cover for this exception log to show one. The SQL
 * half of the rule is `recordedLogPredicateSql`; the coverage integration test
 * holds the two together.
 */
export function clipSubjectOfOccurrence(
  occurrence: Pick<ErrorOccurrence, "timestamp" | "traceId" | "logAttributes">,
): ClipSubject | undefined {
  const streamId = occurrence.logAttributes[RECORDING_STREAM_ATTRIBUTE];
  if (streamId) return { kind: "log", streamId, at: occurrence.timestamp };
  if (occurrence.traceId) return { kind: "trace", traceId: occurrence.traceId };
  return undefined;
}
