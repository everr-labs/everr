// Platform types the SDK reads that lib.dom does not (yet) declare, plus
// the typed getEntriesByType overload. Declared globally the way the
// web-vitals library's types.ts did (adapted from GoogleChrome/web-vitals,
// copyright Google LLC, Apache License 2.0), trimmed to the fields the SDK
// touches.
declare global {
  // https://wicg.github.io/nav-speculation/prerendering.html
  interface PerformanceNavigationTiming {
    activationStart?: number;
  }

  // https://wicg.github.io/layout-instability/
  interface LayoutShiftAttribution {
    node: Node | null;
  }
  interface LayoutShift extends PerformanceEntry {
    value: number;
    sources: LayoutShiftAttribution[];
    hadRecentInput: boolean;
  }

  // https://w3c.github.io/largest-contentful-paint/
  interface LargestContentfulPaint extends PerformanceEntry {
    readonly id: string;
    readonly url: string;
    readonly element: Element | null;
  }

  // https://w3c.github.io/long-animation-frame/
  interface PerformanceScriptTiming extends PerformanceEntry {
    readonly invokerType: string;
    readonly sourceURL: string;
    readonly sourceFunctionName: string;
    readonly forcedStyleAndLayoutDuration: DOMHighResTimeStamp;
  }
  interface PerformanceLongAnimationFrameTiming extends PerformanceEntry {
    readonly styleAndLayoutStart: DOMHighResTimeStamp;
    readonly blockingDuration: DOMHighResTimeStamp;
    readonly scripts: PerformanceScriptTiming[];
  }

  interface PerformanceEntryMap {
    navigation: PerformanceNavigationTiming;
    resource: PerformanceResourceTiming;
    paint: PerformancePaintTiming;
    "visibility-state": PerformanceEntry;
    "largest-contentful-paint": LargestContentfulPaint;
    "layout-shift": LayoutShift;
    "long-animation-frame": PerformanceLongAnimationFrameTiming;
  }
  interface Performance {
    getEntriesByType<K extends keyof PerformanceEntryMap>(
      type: K,
    ): PerformanceEntryMap[K][];
  }
}

export {};
