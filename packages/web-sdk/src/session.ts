// Cookieless session state: everything lives in JS memory, survives SPA
// navigations, and dies on reload or tab close. There is deliberately no
// storage fallback anywhere in this module.

export type PageContext = {
  readonly sessionId: string;
  readonly pageViewId: string;
  readonly url: string;
  readonly path: string;
  readonly referrer: string | undefined;
};

export type SessionContext = ReturnType<typeof createSessionContext>;

export function createSessionContext(
  initialUrl: string,
  initialReferrer: string | undefined,
) {
  let ctx = {
    sessionId: crypto.randomUUID(),
    pageViewId: crypto.randomUUID(),
    url: initialUrl,
    path: pathOf(initialUrl),
    referrer: initialReferrer || undefined,
  };

  return {
    startPageView(url: string) {
      ctx = {
        sessionId: ctx.sessionId,
        pageViewId: crypto.randomUUID(),
        url,
        path: pathOf(url),
        referrer: ctx.url,
      };
    },
    current: () => ctx,
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
