// The platform types that the SDK reads and that lib.dom does not declare now.
// This file also declares the typed getEntriesByType function. The declarations
// are global, the same as in the types.ts file of the web-vitals library. This
// code comes from GoogleChrome/web-vitals, copyright Google LLC, Apache License
// 2.0. It contains only the fields that the SDK uses.
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
