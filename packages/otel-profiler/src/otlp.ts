import { randomBytes } from "node:crypto";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Profile } from "pprof-format";
import {
  ExportProfilesServiceRequest,
  type FunctionInput,
  type KeyValueAndUnitInput,
  type LinkInput,
  type LocationInput,
  type ProfileInput,
  StringTable,
} from "pprof-format/otel";
import { SPAN_ID_LABEL, TIMESTAMP_LABEL, TRACE_ID_LABEL } from "./span-context.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

// Structural, because @datadog/pprof builds its profiles with the CommonJS copy
// of pprof-format, whose StringTable is a distinct class from the ESM one.
type PprofProfile = Omit<Profile, "stringTable"> & { stringTable: { strings: string[] } };

export type PprofExport = {
  profile: PprofProfile;
  /** pprof sample types to export, e.g. `wall`; each becomes one OTLP profile. */
  sampleTypes: readonly string[];
};

/**
 * Re-encodes pprof profiles as one OTLP ExportProfilesServiceRequest. Every
 * profile shares the request's dictionary, so a stack seen by both the wall and
 * the heap profiler is written once.
 */
export function pprofToOtlp(
  exports: readonly PprofExport[],
  resourceAttributes: Record<string, string>,
  options: {
    /** Absolute directory that file names are made relative to, e.g. the repository root. */
    sourceRoot?: string;
  } = {},
): ExportProfilesServiceRequest {
  const dictionary = new Dictionary(options.sourceRoot);
  const profiles: ProfileInput[] = [];
  for (const { profile, sampleTypes } of exports) {
    profiles.push(...dictionary.convert(profile, sampleTypes));
  }
  return new ExportProfilesServiceRequest({
    resourceProfiles: [
      {
        resource: {
          attributes: Object.entries(resourceAttributes).map(([key, value]) => ({
            key,
            value: { stringValue: value },
          })),
        },
        scopeProfiles: [{ scope: { name: PKG_NAME, version: PKG_VERSION }, profiles }],
      },
    ],
    dictionary: dictionary.tables(),
  });
}

class Dictionary {
  constructor(private readonly sourceRoot: string | undefined) {}

  private readonly strings = new StringTable();
  private readonly functions = new Interner<FunctionInput>([{}]);
  private readonly locations = new Interner<LocationInput>([{}]);
  private readonly stacks = new Interner<{ locationIndices: number[] }>([{ locationIndices: [] }]);
  private readonly links = new Interner<LinkInput>([{}]);
  private readonly attributes = new Interner<KeyValueAndUnitInput>([{}]);

  tables() {
    return {
      mappingTable: [{}],
      locationTable: this.locations.values,
      functionTable: this.functions.values,
      linkTable: this.links.values,
      stringTable: this.strings,
      attributeTable: this.attributes.values,
      stackTable: this.stacks.values,
    };
  }

  convert(profile: PprofProfile, sampleTypes: readonly string[]): ProfileInput[] {
    const text = (index: unknown) => profile.stringTable.strings[Number(index)] ?? "";
    const functions = new Map(profile.function.map((fn) => [Number(fn.id), fn]));
    const locations = new Map(profile.location.map((loc) => [Number(loc.id), loc]));

    const locationIndex = new Map<number, number>();
    const location = (id: number) => {
      let index = locationIndex.get(id);
      if (index === undefined) {
        const lines = (locations.get(id)?.line ?? []).map((line) => {
          const fn = functions.get(Number(line.functionId));
          const name = this.strings.dedup(text(fn?.name) || "(anonymous)");
          const filename = this.strings.dedup(
            relativeFileName(text(fn?.filename), this.sourceRoot),
          );
          return {
            functionIndex: this.functions.add(
              { nameStrindex: name, filenameStrindex: filename },
              `${name}:${filename}`,
            ),
            line: Number(line.line),
          };
        });
        index = this.locations.add(
          { lines },
          lines.map((l) => `${l.functionIndex}:${l.line}`).join(","),
        );
        locationIndex.set(id, index);
      }
      return index;
    };

    // pprof and OTLP both list a stack leaf first.
    const samples = profile.sample.map((sample) => {
      const locationIndices = sample.locationId.map((id) => location(Number(id)));
      let traceId: string | undefined;
      let spanId: string | undefined;
      let timestamp: bigint | undefined;
      const attributeIndices: number[] = [];
      for (const label of sample.label) {
        const key = text(label.key);
        const value = text(label.str);
        if (key === TRACE_ID_LABEL) traceId = value;
        else if (key === SPAN_ID_LABEL) spanId = value;
        else if (key === TIMESTAMP_LABEL) timestamp = BigInt(label.num) * 1000n;
        else {
          attributeIndices.push(
            this.attributes.add(
              { keyStrindex: this.strings.dedup(key), value: { stringValue: value } },
              `${key}=${value}`,
            ),
          );
        }
      }
      return {
        stackIndex: this.stacks.add({ locationIndices }, locationIndices.join(",")),
        linkIndex:
          traceId && spanId
            ? this.links.add(
                { traceId: Buffer.from(traceId, "hex"), spanId: Buffer.from(spanId, "hex") },
                `${traceId}:${spanId}`,
              )
            : 0,
        attributeIndices,
        // One sample per hit inside a span, so one timestamp per value.
        timestampsUnixNano: timestamp ? [timestamp] : [],
        values: sample.value,
      };
    });

    const durationNano = BigInt(profile.durationNanos);
    // pprof stamps the profile when it is collected, at the end of its window.
    const timeUnixNano = BigInt(profile.timeNanos) - durationNano;
    const periodType = profile.periodType && {
      typeStrindex: this.strings.dedup(text(profile.periodType.type)),
      unitStrindex: this.strings.dedup(text(profile.periodType.unit)),
    };

    return profile.sampleType.flatMap((valueType, column) => {
      const type = text(valueType.type);
      if (!sampleTypes.includes(type)) return [];
      const typed = samples.flatMap(({ values, ...sample }) =>
        Number(values[column]) > 0 ? [{ ...sample, values: [values[column]] }] : [],
      );
      if (typed.length === 0) return [];
      return [
        {
          sampleType: {
            typeStrindex: this.strings.dedup(type),
            unitStrindex: this.strings.dedup(text(valueType.unit)),
          },
          periodType,
          period: profile.period,
          timeUnixNano,
          durationNano,
          profileId: randomBytes(16),
          samples: typed,
        },
      ];
    });
  }
}

class Interner<T> {
  private readonly index = new Map<string, number>();

  /** `zero` fills index 0, which OTLP reserves for "not set". */
  constructor(readonly values: T[]) {
    this.index.set("", 0);
  }

  add(value: T, key: string): number {
    let index = this.index.get(key);
    if (index === undefined) {
      index = this.values.length;
      this.values.push(value);
      this.index.set(key, index);
    }
    return index;
  }
}

/**
 * ESM frames arrive as `file://` URLs and mapped frames as absolute paths; both
 * become paths relative to `root` when they sit inside it.
 */
export function relativeFileName(name: string, root: string | undefined): string {
  const path = name.startsWith("file://") ? fileURLToPath(name) : name;
  if (!root) return path;
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!path.startsWith(prefix)) return path;
  const relative = path.slice(prefix.length);
  return sep === "/" ? relative : relative.split(sep).join("/");
}
