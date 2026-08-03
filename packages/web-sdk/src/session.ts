// Session and page context. The page side (pageview id, url, referrer) is
// mode-independent: it lives in JS memory, rotates per SPA navigation, and
// dies on reload or tab close. The session id side is injectable: cookieless
// passes nothing and gets a random in-memory id per page load; consented
// mode passes a durable provider (see identity.ts) backed by localStorage.
// There is deliberately no storage fallback anywhere in this module. The
// handle is a tuple, and consumers receive the function they need rather
// than the pair.

export type PageContext = {
  readonly sessionId: string;
  readonly pageViewId: string;
  readonly url: string;
  readonly path: string;
  readonly referrer: string | undefined;
};

/** Rotates the pageview id; the outgoing URL becomes the new referrer. */
export type RotatePageView = (url: string) => void;
export type CurrentPage = () => PageContext;

/**
 * Resolves the session id for the record being emitted. A durable provider
 * rotates on its own inactivity clock whenever a record is emitted, so the
 * id is resolved per call rather than frozen into the page context.
 */
export type SessionProvider = () => string;

export const randomUUID = () => crypto.randomUUID();

/** Cookieless session: one random id per page load, memory only. */
export function memorySession(): SessionProvider {
  const id = randomUUID();
  return () => id;
}

export function createSessionContext(
  initialUrl: string,
  initialReferrer: string | undefined,
  session: SessionProvider = memorySession(),
): [rotate: RotatePageView, current: CurrentPage] {
  let ctx = {
    pageViewId: randomUUID(),
    url: initialUrl,
    path: pathOf(initialUrl),
    referrer: initialReferrer || undefined,
  };

  return [
    (url) => {
      ctx = {
        pageViewId: randomUUID(),
        url,
        path: pathOf(url),
        referrer: ctx.url,
      };
    },
    () => ({ sessionId: session(), ...ctx }),
  ];
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
