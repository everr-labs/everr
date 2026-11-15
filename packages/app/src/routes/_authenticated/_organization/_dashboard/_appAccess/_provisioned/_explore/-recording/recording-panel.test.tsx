import type { ClipSubject, CoveringClip } from "@everr/telemetry-explorer/recordings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const replayers = vi.hoisted(() => {
  class FakeReplayer {
    wrapper = document.createElement("div");
    iframe = document.createElement("iframe");
    calls: string[] = [];
    time = 0;
    private handlers = new Map<string, () => void>();
    constructor(
      readonly events: unknown[],
      readonly config: Record<string, unknown>,
    ) {
      created.push(this);
    }
    play(offset?: number) {
      this.calls.push(`play ${offset}`);
    }
    pause(offset?: number) {
      this.calls.push(`pause ${offset}`);
    }
    on(event: string, handler: () => void) {
      this.handlers.set(event, handler);
    }
    emit(event: string) {
      this.handlers.get(event)?.();
    }
    destroy() {
      this.calls.push("destroy");
    }
    getCurrentTime() {
      return this.time;
    }
  }
  const created: FakeReplayer[] = [];
  return { FakeReplayer, created };
});

vi.mock("@rrweb/replay", () => ({ Replayer: replayers.FakeReplayer }));
vi.mock("@composition/client", () => ({ productClient: { sessionRecordings: true } }));
vi.mock("#app/data/replay/server.ts", () => ({
  getCoveringClips: vi.fn(),
  getClipEvents: vi.fn(),
}));

import { getClipEvents, getCoveringClips } from "#app/data/replay/server.ts";
import { sessionRecordingsHost } from "./host";

const T = 1_700_000_000_000;

function coveringClip(overrides: Partial<CoveringClip> = {}): CoveringClip {
  return {
    clipId: "clip-1",
    streamId: "stream-1",
    sessionId: "session-1",
    serviceName: "web",
    trigger: "error",
    truncated: false,
    startMs: T,
    endMs: T + 60_000,
    focus: { startMs: T + 25_000, endMs: T + 26_000 },
    ...overrides,
  };
}

const playableEvents = [
  { type: 4, timestamp: T, data: { href: "https://shop.test/" } },
  { type: 2, timestamp: T + 5, data: { node: {} } },
  { type: 3, timestamp: T + 30_000, data: { source: 2 } },
];

function eventsResponse(events: unknown[], status = 200): Response {
  return new Response(JSON.stringify(status === 200 ? { events, gaps: [] } : { error: "x" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPlayer(subject: ClipSubject) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = sessionRecordingsHost;
  if (!host) throw new Error("the Cloud product stores recordings");
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
  const view = render(wrap(host.renderPlayer(subject)));
  return {
    rerender: (next: ClipSubject) => view.rerender(wrap(host.renderPlayer(next))),
  };
}

const section = () => screen.findByRole("region", { name: "Session recording" });

beforeEach(() => {
  vi.mocked(getCoveringClips).mockReset();
  vi.mocked(getClipEvents).mockReset();
  replayers.created.length = 0;
});

describe("session recording panel", () => {
  it("draws nothing when no Clip covers the record", async () => {
    vi.mocked(getCoveringClips).mockResolvedValue([]);
    renderPlayer({ kind: "trace", traceId: "t1" });

    await waitFor(() => expect(getCoveringClips).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Session recording" })).not.toBeInTheDocument();
  });

  it("shows the Clip without loading its events until Play", async () => {
    vi.mocked(getCoveringClips).mockResolvedValue([coveringClip({ truncated: true })]);
    renderPlayer({ kind: "log", streamId: "stream-1", at: "2023-11-14 22:13:45.000000000" });

    const panel = await section();
    expect(getCoveringClips).toHaveBeenCalledWith({
      data: { kind: "log", streamId: "stream-1", at: "2023-11-14 22:13:45.000000000" },
    });
    expect(panel).toHaveTextContent("error trigger");
    expect(panel).toHaveTextContent("truncated");
    expect(panel).toHaveTextContent("1:00");
    expect(getClipEvents).not.toHaveBeenCalled();
  });

  it("loads the events once and plays from ten seconds before the subject", async () => {
    vi.mocked(getCoveringClips).mockResolvedValue([coveringClip()]);
    vi.mocked(getClipEvents).mockResolvedValue(eventsResponse(playableEvents));
    renderPlayer({ kind: "trace", traceId: "t1" });

    fireEvent.click(await screen.findByRole("button", { name: "Play" }));

    await waitFor(() => expect(replayers.created).toHaveLength(1));
    const player = replayers.created[0];
    expect(getClipEvents).toHaveBeenCalledWith({ data: { clipId: "clip-1", startMs: T } });
    expect(player?.calls).toEqual(["play 15000"]);
    expect(player?.config).not.toHaveProperty("UNSAFE_replayCanvas");

    if (player) player.time = 17_000;
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(player?.calls.at(-1)).toBe("pause 17000");

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(player?.calls.at(-1)).toBe("play 17000");
    expect(getClipEvents).toHaveBeenCalledTimes(1);
  });

  it("looks up an equal subject once, and another subject again", async () => {
    vi.mocked(getCoveringClips).mockResolvedValue([coveringClip()]);
    const view = renderPlayer({ kind: "trace", traceId: "t1" });
    await section();

    view.rerender({ kind: "trace", traceId: "t1" });
    view.rerender({ kind: "trace", traceId: "t1" });
    await section();
    expect(getCoveringClips).toHaveBeenCalledTimes(1);

    view.rerender({ kind: "trace", traceId: "t2" });
    await waitFor(() => expect(getCoveringClips).toHaveBeenCalledTimes(2));
  });

  it("offers a choice when several Clips cover the record", async () => {
    vi.mocked(getCoveringClips).mockResolvedValue([
      coveringClip(),
      coveringClip({
        clipId: "clip-2",
        trigger: "network",
        startMs: T + 70_000,
        endMs: T + 80_000,
      }),
    ]);
    renderPlayer({ kind: "trace", traceId: "t1" });

    const picker = await screen.findByRole("combobox", { name: "Clip" });
    expect(await section()).toHaveTextContent("error trigger");
    fireEvent.change(picker, { target: { value: "1" } });
    expect(await section()).toHaveTextContent("network trigger");
  });

  it("explains a Clip that cannot play", async () => {
    vi.mocked(getCoveringClips).mockResolvedValue([coveringClip()]);
    vi.mocked(getClipEvents).mockResolvedValue(
      eventsResponse(playableEvents.filter((event) => event.type !== 2)),
    );
    renderPlayer({ kind: "trace", traceId: "t1" });

    fireEvent.click(await screen.findByRole("button", { name: "Play" }));

    expect(
      await screen.findByText("The start of this clip was not received, so it cannot play."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(replayers.created).toHaveLength(0);
  });

  it("explains a Clip too large to play", async () => {
    vi.mocked(getCoveringClips).mockResolvedValue([coveringClip()]);
    vi.mocked(getClipEvents).mockResolvedValue(eventsResponse([], 413));
    renderPlayer({ kind: "trace", traceId: "t1" });

    fireEvent.click(await screen.findByRole("button", { name: "Play" }));

    expect(await screen.findByText("This clip is too large to play here.")).toBeInTheDocument();
    expect(getClipEvents).toHaveBeenCalledTimes(1);
  });
});
