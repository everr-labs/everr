import { Profile, StringTable } from "pprof-format";
import { ExportProfilesServiceRequest } from "pprof-format/otel";
import { describe, expect, it } from "vite-plus/test";
import { pprofToOtlp, relativeFileName } from "./otlp.js";
import {
  HTTP_ROUTE_ATTRIBUTE,
  SPAN_ID_LABEL,
  TIMESTAMP_LABEL,
  TRACE_ID_LABEL,
} from "./span-context.js";

const TRACE_ID = "0102030405060708090a0b0c0d0e0f10";
const SPAN_ID = "1112131415161718";
const SAMPLED_AT = 1_794_353_578_591_197_000n;

// main -> handler, with one sample inside a span and one outside.
function wallProfile() {
  const strings = new StringTable();
  const s = (value: string) => strings.dedup(value);
  return new Profile({
    sampleType: [
      { type: s("sample"), unit: s("count") },
      { type: s("wall"), unit: s("nanoseconds") },
      { type: s("cpu"), unit: s("nanoseconds") },
    ],
    function: [
      { id: 1, name: s("main"), filename: s("/app/server.ts") },
      { id: 2, name: s("handler"), filename: s("/app/routes.ts") },
    ],
    location: [
      { id: 1, line: [{ functionId: 1, line: 3 }] },
      { id: 2, line: [{ functionId: 2, line: 12 }] },
    ],
    sample: [
      {
        locationId: [2, 1],
        value: [2, 20_000_000, 15_000_000],
        label: [
          { key: s(TRACE_ID_LABEL), str: s(TRACE_ID) },
          { key: s(SPAN_ID_LABEL), str: s(SPAN_ID) },
          { key: s(HTTP_ROUTE_ATTRIBUTE), str: s("/orders/:id") },
          { key: s(TIMESTAMP_LABEL), num: SAMPLED_AT / 1000n },
        ],
      },
      { locationId: [1], value: [1, 10_000_000, 0] },
    ],
    stringTable: strings,
    timeNanos: 2_000_000_000n,
    durationNanos: 1_000_000_000n,
    period: 10_000_000,
  });
}

// Decodes the wire bytes, so the test reads what the collector would.
function decode(request: ExportProfilesServiceRequest) {
  const decoded = ExportProfilesServiceRequest.decode(request.encode());
  const dictionary = decoded.dictionary!;
  const text = (index: number) => dictionary.stringTable.strings[index];
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  return decoded.resourceProfiles[0].scopeProfiles[0].profiles.map((profile) => ({
    type: text(profile.sampleType!.typeStrindex),
    unit: text(profile.sampleType!.unitStrindex),
    start: BigInt(profile.timeUnixNano),
    samples: profile.samples.map((sample) => {
      const link = dictionary.linkTable[sample.linkIndex];
      return {
        stack: dictionary.stackTable[sample.stackIndex].locationIndices.map((index) => {
          const line = dictionary.locationTable[index].lines[0];
          const fn = dictionary.functionTable[line.functionIndex];
          return `${text(fn.nameStrindex)}:${text(fn.filenameStrindex)}:${Number(line.line)}`;
        }),
        value: Number(sample.values[0]),
        span: sample.linkIndex ? `${hex(link.traceId)}/${hex(link.spanId)}` : undefined,
        attributes: Object.fromEntries(
          sample.attributeIndices.map((index) => {
            const attribute = dictionary.attributeTable[index];
            return [text(attribute.keyStrindex), attribute.value?.stringValue];
          }),
        ),
        timestamps: sample.timestampsUnixNano.map(BigInt),
      };
    }),
  }));
}

describe("pprofToOtlp", () => {
  const profiles = decode(
    pprofToOtlp(
      [{ profile: wallProfile(), sampleTypes: ["wall", "cpu"] }],
      { "service.name": "everr-dev-app" },
      { sourceRoot: "/app" },
    ),
  );

  it("exports one OTLP profile per requested sample type", () => {
    expect(profiles.map((p) => `${p.type}/${p.unit}`)).toEqual([
      "wall/nanoseconds",
      "cpu/nanoseconds",
    ]);
  });

  it("links samples taken inside a span to it, with their labels and time", () => {
    const [wall] = profiles;
    expect(wall.samples).toEqual([
      {
        stack: ["handler:routes.ts:12", "main:server.ts:3"],
        value: 20_000_000,
        span: `${TRACE_ID}/${SPAN_ID}`,
        attributes: { "http.route": "/orders/:id" },
        timestamps: [SAMPLED_AT],
      },
      {
        stack: ["main:server.ts:3"],
        value: 10_000_000,
        span: undefined,
        attributes: {},
        timestamps: [],
      },
    ]);
  });

  it("drops samples with no weight for a type", () => {
    const cpu = profiles[1];
    expect(cpu.samples.map((s) => s.value)).toEqual([15_000_000]);
  });

  it("stamps the profile with the start of its window", () => {
    expect(profiles[0].start).toBe(1_000_000_000n);
  });
});

describe("pprofToOtlp merging", () => {
  const OTHER_SPAN = "2122232425262728";

  // The wall profiler records each tick inside a span as its own sample.
  function ticks() {
    const strings = new StringTable();
    const s = (value: string) => strings.dedup(value);
    const tick = (spanId: string, at: bigint) => ({
      locationId: [1],
      value: [10_000_000],
      label: [
        { key: s(TRACE_ID_LABEL), str: s(TRACE_ID) },
        { key: s(SPAN_ID_LABEL), str: s(spanId) },
        { key: s(TIMESTAMP_LABEL), num: at / 1000n },
      ],
    });
    return new Profile({
      sampleType: [{ type: s("wall"), unit: s("nanoseconds") }],
      function: [{ id: 1, name: s("main"), filename: s("/app/server.ts") }],
      location: [{ id: 1, line: [{ functionId: 1, line: 3 }] }],
      sample: [
        tick(SPAN_ID, SAMPLED_AT),
        tick(OTHER_SPAN, SAMPLED_AT + 5_000_000n),
        tick(SPAN_ID, SAMPLED_AT + 10_000_000n),
        { locationId: [1], value: [10_000_000] },
        { locationId: [1], value: [10_000_000] },
      ],
      stringTable: strings,
      timeNanos: 2_000_000_000n,
      durationNanos: 1_000_000_000n,
      period: 10_000_000,
    });
  }

  const [wall] = ExportProfilesServiceRequest.decode(
    pprofToOtlp([{ profile: ticks(), sampleTypes: ["wall"] }], {}).encode(),
  ).resourceProfiles[0].scopeProfiles[0].profiles;
  const summary = wall.samples.map((sample) => ({
    link: sample.linkIndex,
    values: sample.values.map(Number),
    timestamps: sample.timestampsUnixNano.map(BigInt),
  }));

  it("folds repeated ticks of a stack in one span into one sample, one value per timestamp", () => {
    expect(summary[0]).toEqual({
      link: summary[0].link,
      values: [10_000_000, 10_000_000],
      timestamps: [SAMPLED_AT, SAMPLED_AT + 10_000_000n],
    });
  });

  it("keeps each span's ticks apart and adds up untimed samples", () => {
    expect(summary).toHaveLength(3);
    expect(summary[1].link).not.toBe(summary[0].link);
    expect(summary[1].timestamps).toEqual([SAMPLED_AT + 5_000_000n]);
    expect(summary[2]).toEqual({ link: 0, values: [20_000_000], timestamps: [] });
  });
});

describe("relativeFileName", () => {
  it("makes paths inside the source root relative to it", () => {
    expect(relativeFileName("/app/packages/app/src/router.tsx", "/app")).toBe(
      "packages/app/src/router.tsx",
    );
    expect(relativeFileName("file:///app/server.mjs", "/app")).toBe("server.mjs");
  });

  it("keeps paths outside the source root absolute", () => {
    expect(relativeFileName("/application/server.mjs", "/app")).toBe("/application/server.mjs");
    expect(relativeFileName("node:internal/timers", "/app")).toBe("node:internal/timers");
    expect(relativeFileName("file:///srv/server.mjs", undefined)).toBe("/srv/server.mjs");
  });
});
