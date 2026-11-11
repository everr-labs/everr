import {
  type ProfileStack,
  ProfilesExplorer,
  type ProfilesRepositoryLike,
  type ProfilesExplorerSearch,
  type RuntimeMetricsRepositoryLike,
} from "@everr/telemetry-explorer/profiles";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

// A deterministic synthetic CPU profile of a Go HTTP service: a few hot paths
// plus a long tail of small stacks, enough to exercise pruning and labels.
function syntheticStacks(): ProfileStack[] {
  let seed = 42;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const frame = (name: string, file = "") => ({ name, file, line: 0 });
  const base = [frame("runtime.goexit"), frame("net/http.(*conn).serve", "net/http/server.go")];
  const handlers = [
    "github.com/acme/api.(*Server).ListOrders",
    "github.com/acme/api.(*Server).GetUser",
    "github.com/acme/api.(*Server).Checkout",
  ];
  const leaves = [
    "encoding/json.(*encodeState).marshal",
    "database/sql.(*DB).QueryContext",
    "runtime.mallocgc",
    "crypto/tls.(*Conn).Write",
    "regexp.(*Regexp).doExecute",
    "syscall.Syscall",
  ];
  const stacks: ProfileStack[] = [];
  for (let i = 0; i < 1_500; i++) {
    const handler = handlers[Math.floor(random() * handlers.length)] ?? "";
    const depth = 1 + Math.floor(random() * 4);
    const middle = Array.from({ length: depth }, (_, d) =>
      frame(`github.com/acme/api/internal/svc${d}.step${Math.floor(random() * 6)}`),
    );
    const leaf = leaves[Math.floor(random() * leaves.length)] ?? "";
    stacks.push({
      frames: [...base, frame(handler), ...middle, frame(leaf)],
      value: Math.round(random() ** 4 * 50_000_000) + 10_000,
    });
  }
  stacks.push({
    frames: [
      frame("runtime.goexit"),
      frame("runtime.gcBgMarkWorker"),
      frame("0x7f3a21c4", "libc.so.6"),
    ],
    value: 900_000_000,
  });
  return stacks.sort((a, b) => b.value - a.value);
}

const stacks = syntheticStacks();
const totalValue = stacks.reduce((sum, s) => sum + s.value, 0);

const repo: ProfilesRepositoryLike = {
  listServices: async () => ["api", "worker"],
  listSampleTypes: async () => [
    { sampleType: "alloc_space", sampleUnit: "bytes" },
    { sampleType: "cpu", sampleUnit: "nanoseconds" },
  ],
  stacks: async ({ limit = 1_000 }) => ({
    stacks: stacks.slice(0, limit).map((stack) => ({ ...stack, source: 0 })),
    totalValue,
    stackCount: stacks.length,
    sources: [{ repository: "https://github.com/acme/api", revision: "4f2c9e1" }],
  }),
  listVersions: async () => [
    {
      version: "1.8.0",
      firstSeen: "2026-01-01T09:00:00.000Z",
      lastSeen: "2026-01-01T11:00:00.000Z",
    },
    {
      version: "1.7.2",
      firstSeen: "2025-12-30T08:00:00.000Z",
      lastSeen: "2026-01-01T09:05:00.000Z",
    },
  ],
  exampleTraces: async () =>
    Array.from({ length: 6 }, (_, i) => ({
      traceId: `4bf92f3577b34da6a3ce929d0e0e47${String(i).padStart(2, "0")}`,
      spanId: `00f067aa0ba902b${i}`,
      serviceName: "api",
      rootSpanName: i % 2 === 0 ? "GET /orders" : "POST /checkout",
      value: 40_000_000 - i * 5_000_000,
    })),
  histogram: async () =>
    Array.from({ length: 60 }, (_, i) => {
      const start = Date.UTC(2026, 0, 1, 10, i);
      return {
        timestamp: new Date(start).toISOString(),
        endTimestamp: new Date(start + 60_000).toISOString(),
        value: Math.round((totalValue / 60) * (0.6 + 0.4 * Math.sin(i / 6))),
      };
    }),
  spanTimeline: async () => ({
    stacks: stacks.slice(0, 8).map((stack, i) => ({
      ...stack,
      value: 5,
      timestampsNs: Array.from({ length: 5 }, (_, j) =>
        String(1_767_261_600_000_000_000n + BigInt((j * 8 + i) * 10_000_000)),
      ),
    })),
    periodNs: 10_000_000,
    truncated: false,
  }),
  profiledSpans: async () => [],
  attributeKeys: async () => [
    { source: "resource", key: "host.name" },
    { source: "sample", key: "thread.name" },
  ],
  attributeValues: async () => ["api-1", "api-2"],
};

const emptyRepo: ProfilesRepositoryLike = {
  listServices: async () => [],
  listSampleTypes: async () => [],
  stacks: async () => ({ stacks: [], totalValue: 0, stackCount: 0 }),
  listVersions: async () => [],
  exampleTraces: async () => [],
  histogram: async () => [],
  spanTimeline: async () => ({ stacks: [], periodNs: 0, truncated: false }),
  profiledSpans: async () => [],
  attributeKeys: async () => [],
  attributeValues: async () => [],
};

// Node.js runtime metrics on the histogram's buckets: a steady event loop
// with a blocked stretch, and periodic major GCs.
const runtimeRepo: RuntimeMetricsRepositoryLike = {
  runtime: async () => {
    const buckets = Array.from({ length: 60 }, (_, i) => {
      const start = Date.UTC(2026, 0, 1, 10, i);
      const blocked = i >= 38 && i <= 41;
      return {
        timestamp: new Date(start).toISOString(),
        endTimestamp: new Date(start + 60_000).toISOString(),
        eventLoopDelayP99: blocked ? 0.18 + 0.02 * (i - 38) : 0.011 + 0.002 * Math.sin(i / 4),
        eventLoopDelayMax: blocked ? 0.42 : 0.03 + 0.01 * Math.sin(i / 3),
        gc: {
          minor: 0.006 + 0.002 * Math.cos(i / 5),
          major: i % 12 === 5 ? 0.09 : 0,
          incremental: i % 12 === 4 ? 0.02 : 0,
          weakcb: 0,
        },
      };
    });
    return { buckets, hasEventLoopDelay: true, hasGc: true };
  },
};

function Explorer({
  repo,
  runtimeRepo,
  initialSearch,
}: {
  repo: ProfilesRepositoryLike;
  runtimeRepo?: RuntimeMetricsRepositoryLike;
  initialSearch?: Partial<ProfilesExplorerSearch>;
}) {
  const [search, setSearch] = useState<ProfilesExplorerSearch>({
    service: [],
    q: "",
    attributes: [],
    showVolume: true,
    ...initialSearch,
  });
  return (
    <div className="flex h-[720px] flex-col border">
      <ProfilesExplorer
        repo={repo}
        runtimeRepo={runtimeRepo}
        timeRange={{ from: "now-1h", to: "now" }}
        refresh="off"
        search={search}
        onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
      />
    </div>
  );
}

const meta = {
  title: "Telemetry/Profiles explorer",
  component: Explorer,
  args: { repo, runtimeRepo },
} satisfies Meta<typeof Explorer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CpuProfile: Story = {};

export const CallersAndCallees: Story = {
  args: { initialSearch: { fn: { name: "runtime.mallocgc", file: "" } } },
};

export const ComparedByVersion: Story = { args: { initialSearch: { compare: "version" } } };

export const NoProfiles: Story = { args: { repo: emptyRepo, runtimeRepo: undefined } };
