import type { ErrorOccurrence } from "../data/types";

function getLegacyErrorOccurrenceKey(occurrence: ErrorOccurrence): string {
  return [occurrence.timestamp, occurrence.traceId, occurrence.spanId].join(
    "|",
  );
}

export function getErrorOccurrenceKey(occurrence: ErrorOccurrence): string {
  if (occurrence.timestampRank !== undefined) {
    return [occurrence.timestamp, occurrence.timestampRank].join("|");
  }
  return getLegacyErrorOccurrenceKey(occurrence);
}

export function findErrorOccurrenceByKey(
  occurrences: ErrorOccurrence[],
  key: string,
): ErrorOccurrence | undefined {
  return (
    occurrences.find(
      (occurrence) =>
        getErrorOccurrenceKey(occurrence) === key ||
        getLegacyErrorOccurrenceKey(occurrence) === key,
    ) ?? occurrences[0]
  );
}
