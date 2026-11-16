const PALETTE = [
  "--trace-service-1",
  "--trace-service-2",
  "--trace-service-3",
  "--trace-service-4",
  "--trace-service-5",
  "--trace-service-6",
  "--trace-service-7",
  "--trace-service-8",
] as const;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function serviceColor(name: string): string {
  const idx = fnv1a(name) % PALETTE.length;
  return `var(${PALETTE[idx]})`;
}

/** Colors for groups shown side by side, such as the services of one trace.
 *  Each keeps its own hashed color unless an earlier group already took it,
 *  then moves to the next free slot, so up to eight groups never share one. */
export function serviceColors(names: readonly string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const taken = new Set<number>();
  for (const name of names) {
    if (colors.has(name)) continue;
    let idx = fnv1a(name) % PALETTE.length;
    if (taken.size < PALETTE.length) {
      while (taken.has(idx)) idx = (idx + 1) % PALETTE.length;
    }
    taken.add(idx);
    colors.set(name, `var(${PALETTE[idx]})`);
  }
  return colors;
}
