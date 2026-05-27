import type { ErrorOccurrence } from "@/data/errors/types";

export function getErrorOccurrenceKey(occurrence: ErrorOccurrence): string {
  return [occurrence.timestamp, occurrence.traceId, occurrence.spanId].join(
    "|",
  );
}

export function findErrorOccurrenceByKey(
  occurrences: ErrorOccurrence[],
  key: string,
): ErrorOccurrence | undefined {
  if (occurrences.length === 0) return undefined;
  if (!key) return occurrences[0];

  return (
    occurrences.find(
      (occurrence) => getErrorOccurrenceKey(occurrence) === key,
    ) ?? occurrences[0]
  );
}
