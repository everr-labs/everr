// Cookieless session state: everything lives in JS memory, survives SPA
// navigations, and dies on reload or tab close. There is deliberately no
// storage fallback anywhere in this module. The handle is a tuple, and
// consumers receive the function they need rather than the pair.

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

export const randomUUID = () => crypto.randomUUID();

export function createSessionContext(
  initialUrl: string,
  initialReferrer: string | undefined,
): [rotate: RotatePageView, current: CurrentPage] {
  let ctx = {
    sessionId: randomUUID(),
    pageViewId: randomUUID(),
    url: initialUrl,
    path: pathOf(initialUrl),
    referrer: initialReferrer || undefined,
  };

  return [
    (url) => {
      ctx = {
        sessionId: ctx.sessionId,
        pageViewId: randomUUID(),
        url,
        path: pathOf(url),
        referrer: ctx.url,
      };
    },
    () => ctx,
  ];
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
