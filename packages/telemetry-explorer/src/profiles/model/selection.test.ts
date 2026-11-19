import { describe, expect, it } from "vite-plus/test";
import { pickSampleType } from "./selection";

describe("pickSampleType", () => {
  const options = [
    { sampleType: "alloc_space", sampleUnit: "bytes" },
    { sampleType: "cpu", sampleUnit: "nanoseconds" },
    { sampleType: "samples", sampleUnit: "count" },
  ];

  it("honors the requested type and unit", () => {
    expect(pickSampleType(options, { sampleType: "samples", sampleUnit: "count" })).toBe(
      options[2],
    );
  });

  it("prefers cpu, then samples, then the first option", () => {
    expect(pickSampleType(options, {})).toBe(options[1]);
    expect(pickSampleType([options[0], options[2]], {})).toBe(options[2]);
    expect(pickSampleType([options[0]], { sampleType: "cpu" })).toBe(options[0]);
  });
});
