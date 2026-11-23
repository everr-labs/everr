// The localStorage adapter for the visitor id and the session. The functions
// read and write typed values, and thus the serialization is a detail here.
// session.ts decides when the code may call them: never while anonymized.

/** The session in the store: its id and the time of the last activity. */
export type SessionState = { id: string; t: number };

const VISITOR_KEY = "everr.visitor.id";
const SESSION_KEY = "everr.session";

// The code tries to use the store, but it accepts a failure. localStorage is
// not always available, for example in private mode or when the user stops the
// store. Then each read and each write fails, but the code throws no error. The
// identity then stays in memory for the life of the page.

export function readVisitor(): string | null {
  try {
    return localStorage.getItem(VISITOR_KEY);
  } catch {
    return null;
  }
}

export function writeVisitor(id: string): void {
  try {
    localStorage.setItem(VISITOR_KEY, id);
  } catch {
    // The store is not available. The identity then stays in memory.
  }
}

/** Returns null when the store has no session or the data is not correct. */
export function readSession(): SessionState | null {
  try {
    const parsed: { id?: unknown; t?: unknown } = JSON.parse(
      localStorage.getItem(SESSION_KEY) ?? "null",
    );
    if (typeof parsed?.id === "string" && typeof parsed.t === "number")
      // oxlint-disable-next-line typescript/consistent-type-assertions -- Retain the validated stored object, including any additional persisted fields.
      return parsed as SessionState;
  } catch {
    // The store is not available, or the data is not correct.
  }
  return null;
}

export function writeSession(state: SessionState): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // The same as above.
  }
}

/** Removes all the identity data from the store. */
export function removeIdentity(): void {
  try {
    localStorage.removeItem(VISITOR_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // The same as above.
  }
}
