/**
 * Truncate `text` to at most `max` UTF-16 code units, appending a single
 * ellipsis ("…") when truncation occurs.
 *
 * The boundary is surrogate-aware: if the last kept code unit is a high
 * surrogate (0xd800–0xdbff), the slice backs up one so the pair is not split
 * and no lone surrogate is emitted. The returned string is therefore at most
 * `max` units long (or `max - 1` when the backup fires), and is always a
 * well-formed UTF-16 string.
 */
export function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;

  let end = max - 1;
  if (end > 0) {
    const lastCodeUnit = text.charCodeAt(end - 1);
    if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
      end -= 1;
    }
  }
  return `${text.slice(0, end)}…`;
}
