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

export function serviceColor(namespace: string, name: string): string {
  const key = `${namespace}/${name}`;
  const idx = fnv1a(key) % PALETTE.length;
  return `var(${PALETTE[idx]})`;
}
