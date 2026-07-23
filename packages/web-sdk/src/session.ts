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

export class SessionContext {
  private context: PageContext;

  constructor(initialUrl: string, initialReferrer: string | undefined) {
    this.context = {
      sessionId: crypto.randomUUID(),
      pageViewId: crypto.randomUUID(),
      url: initialUrl,
      path: pathOf(initialUrl),
      referrer: initialReferrer || undefined,
    };
  }

  /** Rotates the pageview id; the outgoing URL becomes the new pageview's referrer. */
  startPageView(url: string): void {
    this.context = {
      sessionId: this.context.sessionId,
      pageViewId: crypto.randomUUID(),
      url,
      path: pathOf(url),
      referrer: this.context.url,
    };
  }

  current(): PageContext {
    return this.context;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
