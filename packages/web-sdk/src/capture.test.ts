import { describe, expect, it } from "vitest";
import { resolveCapture } from "./capture.js";

describe("resolveCapture", () => {
  it("defaults everything on when omitted", () => {
    expect(resolveCapture(undefined)).toEqual({
      pageviews: true,
      interactions: true,
      webVitals: true,
    });
  });

  it("treats `true` as all-on", () => {
    expect(resolveCapture(true)).toEqual({
      pageviews: true,
      interactions: true,
      webVitals: true,
    });
  });

  it("treats `false` as all-off", () => {
    expect(resolveCapture(false)).toEqual({
      pageviews: false,
      interactions: false,
      webVitals: false,
    });
  });

  it("toggles per signal in the object form, defaulting unset keys on", () => {
    expect(resolveCapture({ pageviews: false })).toEqual({
      pageviews: false,
      interactions: true,
      webVitals: true,
    });
    expect(resolveCapture({ interactions: false, webVitals: false })).toEqual({
      pageviews: true,
      interactions: false,
      webVitals: false,
    });
  });
});
