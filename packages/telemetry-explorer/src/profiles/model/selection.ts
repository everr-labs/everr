import type { SampleTypeOption } from "../data/types";

const PREFERRED_SAMPLE_TYPES = ["cpu", "samples"];

export function pickSampleType(
  options: readonly SampleTypeOption[],
  requested: { sampleType?: string; sampleUnit?: string },
): SampleTypeOption | undefined {
  const exact = options.find(
    (option) =>
      option.sampleType === requested.sampleType && option.sampleUnit === requested.sampleUnit,
  );
  if (exact) return exact;
  for (const preferred of PREFERRED_SAMPLE_TYPES) {
    const match = options.find((option) => option.sampleType === preferred);
    if (match) return match;
  }
  return options[0];
}

/** Tells sample types apart, for React keys and select values. */
export function sampleTypeKey(option: SampleTypeOption): string {
  return `${option.sampleType}\u0000${option.sampleUnit}`;
}
