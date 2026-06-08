import { describe, expect, it } from "vitest";
import type { ErrorOccurrence } from "../data/types";
import {
  findErrorOccurrenceByKey,
  getErrorOccurrenceKey,
} from "./error-occurrence-key";

const occurrence = {
  fingerprint: "fp-1",
  timestamp: "2026-05-26 10:05:00.000000000",
  serviceName: "web",
  traceId: "trace-1",
  spanId: "span-1",
  body: "boom",
  exceptionType: "TypeError",
  exceptionMessage: "boom",
  exceptionStacktrace: "at x",
  resourceAttributes: {},
  logAttributes: {},
  scopeAttributes: {},
} satisfies ErrorOccurrence;

describe("getErrorOccurrenceKey", () => {
  it("uses timestamp and timestamp rank when the rank is available", () => {
    expect(getErrorOccurrenceKey({ ...occurrence, timestampRank: 2 })).toBe(
      "2026-05-26 10:05:00.000000000|2",
    );
  });

  it("keeps timestamp tuple support for existing links", () => {
    expect(getErrorOccurrenceKey(occurrence)).toBe(
      "2026-05-26 10:05:00.000000000|trace-1|span-1",
    );
  });

  it("finds ranked occurrences and existing timestamp tuple links", () => {
    const selected = { ...occurrence, timestampRank: 2 };
    const occurrences = [
      { ...occurrence, timestampRank: 1, spanId: "span-0" },
      selected,
    ];

    expect(
      findErrorOccurrenceByKey(occurrences, "2026-05-26 10:05:00.000000000|2"),
    ).toBe(selected);
    expect(
      findErrorOccurrenceByKey(
        occurrences,
        "2026-05-26 10:05:00.000000000|trace-1|span-1",
      ),
    ).toBe(selected);
  });
});
