// Cookieless session state: everything lives in JS memory, survives SPA
// navigations, and dies on reload or tab close. There is deliberately no
// storage fallback anywhere in this module.

export type PageContext = {
  readonly sessionId: string;
  readonly pageViewId: string;
  readonly url: string;
  readonly referrer: string | undefined;
};

export class SessionContext {
  readonly sessionId: string;
  private pageViewId: string;
  private url: string;
  private referrer: string | undefined;

  constructor(initialUrl: string, initialReferrer: string | undefined) {
    this.sessionId = crypto.randomUUID();
    this.pageViewId = crypto.randomUUID();
    this.url = initialUrl;
    this.referrer = initialReferrer || undefined;
  }

  /** Rotates the pageview id; the outgoing URL becomes the new pageview's referrer. */
  startPageView(url: string): void {
    this.referrer = this.url;
    this.url = url;
    this.pageViewId = crypto.randomUUID();
  }

  current(): PageContext {
    return {
      sessionId: this.sessionId,
      pageViewId: this.pageViewId,
      url: this.url,
      referrer: this.referrer,
    };
  }
}
