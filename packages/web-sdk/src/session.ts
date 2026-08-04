// Session and page context. The page side (pageview id, url, referrer)
// lives in JS memory, rotates per SPA navigation, and dies on reload or tab
// close. The session id side is injected: identity.ts provides it, backed by
// the store the persistence option picks. There is deliberately no storage
// access anywhere in this module. The handle is a tuple, and consumers
// receive the function they need rather than the pair.

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

/**
 * web-vitals' metric id shape minus its version tag: a timestamp plus a
 * 13-digit random integer, cheap to generate, unique enough for ids that
 * only ever need to be distinct, and free of the secure-context requirement
 * crypto.randomUUID carries.
 */
export const uniqueId = () =>
  `${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;

export function createSessionContext(
  initialUrl: string,
  initialReferrer: string | undefined,
  session: SessionProvider,
): [rotate: RotatePageView, current: CurrentPage] {
  let ctx = {
    pageViewId: uniqueId(),
    url: initialUrl,
    path: pathOf(initialUrl),
    referrer: initialReferrer || undefined,
  };

  return [
    (url) => {
      ctx = {
        pageViewId: uniqueId(),
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
