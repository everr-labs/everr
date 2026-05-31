import type { ErrorOccurrence } from "../data/types";

export function getErrorOccurrenceKey(occurrence: ErrorOccurrence): string {
  return [occurrence.timestamp, occurrence.traceId, occurrence.spanId].join(
    "|",
  );
}

export function findErrorOccurrenceByKey(
  occurrences: ErrorOccurrence[],
  key: string,
): ErrorOccurrence | undefined {
  return (
    occurrences.find(
      (occurrence) => getErrorOccurrenceKey(occurrence) === key,
    ) ?? occurrences[0]
  );
}
