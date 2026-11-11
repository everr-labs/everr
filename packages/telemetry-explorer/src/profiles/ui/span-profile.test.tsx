import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import type { ProfilesRepositoryLike } from "../data/repository";
import type { ProfileSpanTimeline } from "../data/types";
import { SpanProfile } from "./span-profile";

const SPAN_START = 1_794_352_829_000_000_000n;
const hashStack = {
  frames: [
    { name: "handleCheckout", file: "", line: 0 },
    { name: "createHash", file: "", line: 0 },
  ],
  value: 20_000_000,
};

function repo(sampleTypes: string[], timeline: ProfileSpanTimeline): ProfilesRepositoryLike {
  return {
    listServices: async () => [],
    listSampleTypes: async () =>
      sampleTypes.map((sampleType) => ({ sampleType, sampleUnit: "nanoseconds" })),
    stacks: async () => ({
      stacks: sampleTypes.length ? [hashStack] : [],
      totalValue: 20_000_000,
      stackCount: 1,
    }),
    listVersions: async () => [],
    exampleTraces: async () => [],
    histogram: async () => [],
    spanTimeline: async () => timeline,
    profiledSpans: async () => [],
    attributeKeys: async () => [],
    attributeValues: async () => [],
  };
}

function renderSpanProfile(profiles: ProfilesRepositoryLike) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SpanProfile
        repo={profiles}
        traceId="trace"
        spanId="span"
        window={{
          start: new Date("2026-11-10T23:20:29Z"),
          end: new Date("2026-11-10T23:20:30Z"),
        }}
        spanStartNs={String(SPAN_START)}
        spanDurationNs={30_000_000}
      />
    </QueryClientProvider>,
  );
}

const NO_TIMESTAMPS: ProfileSpanTimeline = { stacks: [], periodNs: 0, truncated: false };

describe("SpanProfile", () => {
  it("explains why a span has no samples", async () => {
    renderSpanProfile(repo([], NO_TIMESTAMPS));
    expect(
      await screen.findByText("No profile samples were taken during this span"),
    ).toBeInTheDocument();
  });

  it("offers each sample type the span has", async () => {
    renderSpanProfile(repo(["cpu", "wall"], NO_TIMESTAMPS));
    expect(await screen.findByRole("button", { name: "cpu" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "wall" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("img", { name: /Timeline/ })).not.toBeInTheDocument();
  });

  it("draws the timeline when the samples carry timestamps", async () => {
    renderSpanProfile(
      repo(["cpu"], {
        stacks: [
          {
            ...hashStack,
            value: 2,
            timestampsNs: [String(SPAN_START + 5_000_000n), String(SPAN_START + 15_000_000n)],
          },
        ],
        periodNs: 10_000_000,
        truncated: false,
      }),
    );
    expect(await screen.findByRole("img", { name: /Timeline of 2 samples/ })).toBeInTheDocument();
  });

  it("keeps a function highlighted after its row is clicked, until cleared", async () => {
    renderSpanProfile(repo(["cpu"], NO_TIMESTAMPS));
    const row = await screen.findByRole("button", { name: "createHash" });
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Stop highlighting createHash" }));
    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: /Stop highlighting/ })).not.toBeInTheDocument();
  });
});
