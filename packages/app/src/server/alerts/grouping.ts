export interface GroupSchedule {
  nextFlushAt: Date;
  lastFlushedAt: Date | null;
}

export function nextGroupFlushAt(
  existing: GroupSchedule | null,
  now: Date,
  groupWaitSeconds: number,
  groupIntervalSeconds: number,
): Date {
  if (!existing) {
    return new Date(now.getTime() + groupWaitSeconds * 1_000);
  }
  if (!existing.lastFlushedAt) return existing.nextFlushAt;
  return new Date(
    Math.min(
      existing.nextFlushAt.getTime(),
      Math.max(
        now.getTime(),
        existing.lastFlushedAt.getTime() + groupIntervalSeconds * 1_000,
      ),
    ),
  );
}
