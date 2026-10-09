import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HomeStatus } from "@/common/onboarding";
import { createApiKey } from "@/data/api-keys";
import { homeStatusQueryOptions } from "@/data/onboarding/options";
import { completeOnboarding, getHomeStatus } from "@/data/onboarding/server";
import { HomeExperience } from "./home-experience";
import { onboardingProgressKey } from "./use-setup-progress";

const navigation = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigation,
}));

vi.mock("@/data/onboarding/server", () => ({
  getHomeStatus: vi.fn(),
  completeOnboarding: vi.fn(),
}));
vi.mock("@/data/api-keys", () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { apiKey: {} } }));

const initial = (): HomeStatus => ({
  organizationName: "My organization",
  canCreateKeys: true,
  onboardingCompleted: false,
});
let persisted: HomeStatus;
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  persisted = initial();
  vi.mocked(getHomeStatus).mockImplementation(async () =>
    structuredClone(persisted),
  );
  vi.mocked(completeOnboarding).mockImplementation(async () => {
    persisted.onboardingCompleted = true;
    return { onboardingCompleted: true };
  });
  vi.mocked(createApiKey).mockResolvedValue({
    id: "key-1",
    key: "ek_shown_once",
    permissions: { ingest: ["write"] },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.clear();
});

function mount({
  preload = true,
  setupRequested = false,
}: {
  preload?: boolean;
  setupRequested?: boolean;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  if (preload)
    client.setQueryData(
      homeStatusQueryOptions("alice", "one").queryKey,
      structuredClone(persisted),
    );
  const home = (
    organizationId = "one",
    userId = "alice",
    setup = setupRequested,
  ) => (
    <QueryClientProvider client={client}>
      <HomeExperience
        userId={userId}
        organizationId={organizationId}
        setupRequested={setup}
      >
        <div>Telemetry Usage dashboard</div>
      </HomeExperience>
    </QueryClientProvider>
  );
  return { client, home, ...render(home()), user: userEvent.setup() };
}

function seedProgress(
  step: "install" | "agent" | "local" | "production",
  mode: "agent" | "manual" = "agent",
) {
  localStorage.setItem(
    onboardingProgressKey("alice", "one"),
    JSON.stringify({ step, mode }),
  );
}

it("shows only the current step and requires confirmations before unlocking later steps", async () => {
  const { user } = mount();
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Instrument your app/ }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: /Verify locally/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /To production/ })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Copy install command" }),
  );
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    screen.getByRole("heading", { name: "Instrument your app" }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Install Everr" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Use my coding agent" }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("walks the agent path through local verification and finishes onboarding", async () => {
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Copy skills command" }));
  expect(await navigator.clipboard.readText()).toBe(
    "everr skills install --all --project",
  );
  await user.click(screen.getByRole("button", { name: "Copy setup command" }));
  expect(await navigator.clipboard.readText()).toBe("/everr-setup-telemetry");
  expect(screen.getByRole("button", { name: /Verify locally/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Copy setup command" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "I can see my local telemetry" }),
  );
  expect(
    screen.getByRole("link", { name: /production guide/i }),
  ).toHaveAttribute(
    "href",
    "https://everr.dev/docs/guides/production-telemetry",
  );
  expect(
    screen.queryByRole("button", { name: "Copy setup command" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Copy production endpoint" }),
  );
  expect(await navigator.clipboard.readText()).toBe(
    "https://ingest.everr.dev/",
  );
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
});

it("skips project skills for manual setup and lets members finish without keys", async () => {
  persisted.canCreateKeys = false;
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  const guide = screen.getByRole("link", {
    name: "Open the instrumentation guide",
  });
  expect(guide).toHaveAttribute(
    "href",
    "https://everr.dev/docs/learn/instrument-your-app",
  );
  expect(
    screen.queryByRole("button", { name: "Copy skills command" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Copy setup command" }),
  ).toBeNull();
  await user.click(guide);
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "I can see my local telemetry" }),
  );
  expect(
    screen.queryByRole("button", { name: "Create ingestion key" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
});

it("can still advance and choose a method when browser storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "I can see my local telemetry" }),
  );
  expect(screen.getByRole("link", { name: /production guide/i })).toBeVisible();
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
});

it("keeps production open if completion fails and allows retry", async () => {
  seedProgress("production", "manual");
  vi.mocked(completeOnboarding).mockRejectedValueOnce(
    new Error("Completion unavailable"),
  );
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Completion unavailable",
  );
  expect(screen.getByRole("heading", { name: "To production" })).toBeVisible();
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
});

it("shows the dashboard when another member completes onboarding", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  try {
    mount();
    expect(
      screen.getByRole("heading", { name: "Install Everr" }),
    ).toBeVisible();
    persisted.onboardingCompleted = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByText("Telemetry Usage dashboard")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Install Everr" })).toBeNull();
  } finally {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  }
});

it("restores saved progress and reviews earlier steps without forgetting later confirmations", async () => {
  seedProgress("production");
  const { user, unmount } = mount();
  expect(screen.getByRole("heading", { name: "To production" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Install Everr/ }));
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    screen.getByRole("heading", { name: "Instrument your app" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /To production/ }));
  expect(
    screen.getByRole("button", { name: "Finish onboarding" }),
  ).toBeVisible();
  unmount();
  mount();
  expect(screen.getByRole("heading", { name: "To production" })).toBeVisible();
});

it("keeps the method saved by the single-page flow", async () => {
  localStorage.setItem(
    onboardingProgressKey("alice", "one"),
    JSON.stringify({ mode: "manual" }),
  );
  const { user } = mount();
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    screen.getByRole("button", { name: "Set up manually" }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
});

it("keeps completed organizations on ordinary Home after refresh, regardless of saved progress", async () => {
  persisted.onboardingCompleted = true;
  seedProgress("production", "manual");
  const first = mount();
  expect(screen.getByText("Telemetry Usage dashboard")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "To production" })).toBeNull();
  first.unmount();
  mount({ preload: false });
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
});

it("reopens completed onboarding at production with setup=1 and removes the parameter on finish", async () => {
  persisted.onboardingCompleted = true;
  const { user, rerender, home } = mount({ setupRequested: true });
  expect(screen.getByRole("heading", { name: "To production" })).toBeVisible();
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  await waitFor(() => expect(navigation).toHaveBeenCalled());
  const args = navigation.mock.calls[0][0];
  expect(args.search({ setup: 1, from: "now-1h" })).toEqual({
    setup: undefined,
    from: "now-1h",
  });
  rerender(home("one", "alice", false));
  expect(screen.getByText("Telemetry Usage dashboard")).toBeVisible();
});

it("uses the saved step when completed onboarding is explicitly reopened", () => {
  persisted.onboardingCompleted = true;
  seedProgress("local", "manual");
  mount({ setupRequested: true });
  expect(screen.getByRole("heading", { name: "Verify locally" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
});

it("renders errors with retry instead of assuming no data", async () => {
  vi.mocked(getHomeStatus).mockRejectedValueOnce(
    new Error("Organization unavailable"),
  );
  const { user } = mount({ preload: false });
  expect(await screen.findByText("Couldn't load your setup")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Install Everr" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("heading", { name: "Install Everr" }),
  ).toBeVisible();
});

it("keeps the open step and saved confirmations when refresh fails, then retries", async () => {
  seedProgress("production");
  const { client, user } = mount();
  await user.click(screen.getByRole("button", { name: /Install Everr/ }));
  vi.mocked(getHomeStatus).mockRejectedValueOnce(
    new Error("Refresh unavailable"),
  );
  await act(() =>
    client.refetchQueries({
      queryKey: homeStatusQueryOptions("alice", "one").queryKey,
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't refresh your setup: Refresh unavailable",
  );
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /To production/ }));
  expect(
    screen.getByRole("button", { name: "Finish onboarding" }),
  ).toBeVisible();
});

it("does not reopen onboarding when a stale refresh resolves after completion", async () => {
  seedProgress("production");
  const { client, user } = mount();
  const previous = structuredClone(persisted);
  let resolveRefresh!: (status: HomeStatus) => void;
  vi.mocked(getHomeStatus).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  );
  const { queryKey } = homeStatusQueryOptions("alice", "one");
  let refresh!: Promise<void>;
  act(() => {
    refresh = client.refetchQueries({ queryKey });
  });
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
  await act(async () => {
    resolveRefresh(previous);
    await refresh;
  });
  expect(screen.getByText("Telemetry Usage dashboard")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "To production" })).toBeNull();
});

it("does not show the previous organization's progress while the new one loads", async () => {
  seedProgress("production");
  const { home, rerender } = mount();
  vi.mocked(getHomeStatus).mockImplementation(() => new Promise(() => {}));
  rerender(home("two"));
  expect(screen.getByLabelText("Loading your setup")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
});

it("keeps the issued key visible when another member completes onboarding", async () => {
  seedProgress("production");
  const { user, client } = mount();
  await user.click(
    screen.getByRole("button", { name: "Create ingestion key" }),
  );
  await user.type(
    await screen.findByRole("textbox", { name: "Name" }),
    "production",
  );
  expect(screen.getByRole("switch", { name: /Send telemetry/ })).toBeChecked();
  expect(
    screen.getByRole("switch", { name: /Manage as code/ }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Create key" }));
  expect(await screen.findByText("ek_shown_once")).toBeVisible();
  persisted.onboardingCompleted = true;
  await act(() =>
    client.refetchQueries({
      queryKey: homeStatusQueryOptions("alice", "one").queryKey,
    }),
  );
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
  expect(screen.getByText("ek_shown_once")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
});

it("isolates saved steps and methods between users and organizations", async () => {
  seedProgress("local");
  const { home, rerender, user } = mount();
  expect(screen.getByRole("heading", { name: "Verify locally" })).toBeVisible();
  rerender(home("two"));
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(screen.getByRole("heading", { name: "Verify locally" })).toBeVisible();
  rerender(home("one", "bob"));
  expect(
    await screen.findByRole("heading", { name: "Install Everr" }),
  ).toBeVisible();
  rerender(home("two"));
  expect(
    await screen.findByRole("heading", { name: "Verify locally" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("link", { name: "Open the instrumentation guide" }),
  ).toBeVisible();
  rerender(home("one"));
  expect(
    await screen.findByRole("heading", { name: "Verify locally" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("button", { name: "Copy setup command" }),
  ).toBeVisible();
});

it("restores the current step after refresh and recovers from corrupt storage", async () => {
  const first = mount();
  await first.user.click(screen.getByRole("button", { name: "Continue" }));
  await first.user.click(
    screen.getByRole("button", { name: "Set up manually" }),
  );
  await first.user.click(
    screen.getByRole("button", { name: "Check my telemetry" }),
  );
  first.unmount();
  const second = mount();
  expect(screen.getByRole("heading", { name: "Verify locally" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
  second.unmount();
  localStorage.setItem(onboardingProgressKey("alice", "one"), "invalid json");
  mount();
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
});

it("creates a public browser key from production setup", async () => {
  seedProgress("production", "manual");
  const { user } = mount();
  await user.click(
    screen.getByRole("button", { name: "Create public browser key" }),
  );
  await user.type(
    await screen.findByRole("textbox", { name: "Name" }),
    "browser",
  );
  const origins = screen.getByRole("textbox", { name: "Allowed origins" });
  await user.type(origins, "https://app.example.com/path");
  await user.click(screen.getByRole("button", { name: "Create public key" }));
  expect(screen.queryByText("ek_shown_once")).toBeNull();
  expect(
    screen.getByRole("textbox", { name: "Allowed origins" }),
  ).toBeVisible();
  await user.clear(origins);
  await user.type(origins, "https://app.example.com");
  await user.click(screen.getByRole("button", { name: "Create public key" }));
  expect(await screen.findByText("ek_shown_once")).toBeVisible();
  expect(createApiKey).toHaveBeenCalledWith({
    data: {
      name: "browser",
      scopes: ["ingest"],
      public: true,
      allowedOrigins: ["https://app.example.com"],
    },
  });
});

it("lets manual users return to step two and continue without selecting their method again", async () => {
  seedProgress("local", "manual");
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: /Instrument your app/ }));
  expect(
    screen.getByRole("button", { name: "Set up manually" }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
});

it("changes setup method without navigating or unlocking the next step", async () => {
  seedProgress("agent");
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  expect(
    screen.getByRole("heading", { name: "Instrument your app" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /Verify locally/ })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Copy skills command" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Use my coding agent" }));
  expect(
    screen.getByRole("button", { name: "Copy skills command" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Copy setup command" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
});

it("switches paths while reviewing without losing confirmed progress", async () => {
  seedProgress("production", "manual");
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("heading", { name: "Instrument your app" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Use my coding agent" }));
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /To production/ })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  await user.click(screen.getByRole("button", { name: "Check my telemetry" }));
  expect(
    screen.getByRole("button", { name: "Copy local status command" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /To production/ }));
  expect(screen.getByRole("link", { name: /production guide/i })).toBeVisible();
});

it("keeps verification explicit and offers recovery without marking onboarding complete", async () => {
  seedProgress("local", "manual");
  const { user } = mount();
  await user.click(
    screen.getByRole("button", { name: "Copy local status command" }),
  );
  expect(screen.queryByText("Telemetry Usage dashboard")).toBeNull();
  expect(screen.getByRole("button", { name: /To production/ })).toBeDisabled();
  await user.click(screen.getByText("No data yet?"));
  expect(
    screen.getByRole("link", { name: "Open the instrumentation guide" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("heading", { name: "Instrument your app" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Set up manually" }),
  ).toHaveAttribute("aria-pressed", "true");
});
