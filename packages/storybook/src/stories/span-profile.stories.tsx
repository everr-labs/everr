import {
  type ProfileStack,
  type ProfilesRepositoryLike,
  SpanProfile,
} from "@everr/telemetry-explorer/profiles";
import type { Meta, StoryObj } from "@storybook/react-vite";

const SPAN_START_NS = 1_767_261_600_000_000_000n;
const PERIOD_NS = 10_000_000;

const frame = (name: string, file = "") => ({ name, file, line: 0 });
const base = [frame("(anonymous)"), frame("handleCheckout", "src/checkout.ts")];

// A 400 ms checkout span: JSON parsing, then hashing, then a database write.
const phases: { leaf: string; from: number; to: number }[] = [
  { leaf: "JSON.parse", from: 0, to: 6 },
  { leaf: "node:crypto.createHash", from: 6, to: 28 },
  { leaf: "pg.Client.query", from: 28, to: 34 },
  { leaf: "Garbage Collection", from: 34, to: 37 },
];

const stacks = phases.map(({ leaf, from, to }) => ({
  frames: [...base, frame(leaf)],
  value: to - from,
  timestampsNs: Array.from({ length: to - from }, (_, i) =>
    String(SPAN_START_NS + BigInt((from + i) * PERIOD_NS + 3_000_000)),
  ),
}));

const flameStacks: ProfileStack[] = stacks.map(({ frames, value }) => ({
  frames,
  value: value * PERIOD_NS,
}));

const repo: ProfilesRepositoryLike = {
  listServices: async () => ["checkout"],
  listSampleTypes: async () => [
    { sampleType: "cpu", sampleUnit: "nanoseconds" },
    { sampleType: "wall", sampleUnit: "nanoseconds" },
  ],
  stacks: async () => ({
    stacks: flameStacks,
    totalValue: flameStacks.reduce((sum, s) => sum + s.value, 0),
    stackCount: flameStacks.length,
  }),
  histogram: async () => [],
  spanTimeline: async () => ({ stacks, periodNs: PERIOD_NS, truncated: false }),
  profiledSpans: async () => [],
  listVersions: async () => [],
  exampleTraces: async () => [],
  attributeKeys: async () => [],
  attributeValues: async () => [],
};

const noTimestampsRepo: ProfilesRepositoryLike = {
  ...repo,
  spanTimeline: async () => ({ stacks: [], periodNs: 0, truncated: false }),
};

const emptyRepo: ProfilesRepositoryLike = {
  ...repo,
  listSampleTypes: async () => [],
  stacks: async () => ({ stacks: [], totalValue: 0, stackCount: 0 }),
  spanTimeline: async () => ({ stacks: [], periodNs: 0, truncated: false }),
};

function Panel({ repo }: { repo: ProfilesRepositoryLike }) {
  return (
    <div className="flex h-[640px] w-[420px] flex-col border">
      <SpanProfile
        repo={repo}
        traceId="c19d702e33dde89450b1d9454ac97a53"
        spanId="6efc9f4ab87fc14c"
        window={{ start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T10:00:01Z") }}
        spanStartNs={String(SPAN_START_NS)}
        spanDurationNs={400_000_000}
      />
    </div>
  );
}

const meta = {
  title: "Telemetry/Span profile",
  component: Panel,
  args: { repo },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTimeline: Story = {};

export const WithoutTimestamps: Story = { args: { repo: noTimestampsRepo } };

export const NoSamples: Story = { args: { repo: emptyRepo } };
