import type { CaptureConfig, ResolvedCapture } from "./types.js";

export function resolveCapture(
  config: CaptureConfig | undefined,
): ResolvedCapture {
  if (config === false) {
    return { pageviews: false, interactions: false, webVitals: false };
  }
  if (config === true || config === undefined) {
    return { pageviews: true, interactions: true, webVitals: true };
  }
  return {
    pageviews: config.pageviews ?? true,
    interactions: config.interactions ?? true,
    webVitals: config.webVitals ?? true,
  };
}
