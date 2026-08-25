import type { z } from "zod";

/**
 * localStorage as an untrusted store: values go in as JSON and only come back
 * out when they still parse against the given schema. Anything else — absent
 * key, corrupt JSON, stale shape from an older build, blocked storage — reads
 * as null, so callers only ever see data the schema vouches for.
 */
export function readLocalStorage<Schema extends z.ZodType>(
  key: string,
  schema: Schema,
): z.infer<Schema> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or privacy-mode failures just lose the nicety.
  }
}

export function removeLocalStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Privacy-mode or storage failures are harmless.
  }
}
