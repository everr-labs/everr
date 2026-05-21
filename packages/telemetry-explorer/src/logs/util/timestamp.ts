export function normalizeTimestampToUtc(raw: string): string {
  const trimmed = raw.trim();
  const isoLike = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  if (isoLike.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(isoLike)) {
    return new Date(isoLike).toISOString();
  }
  return new Date(`${isoLike}Z`).toISOString();
}
