import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
function savedProgress() {
  return JSON.parse(
    localStorage.getItem(onboardingProgressKey("alice", "one")) ?? "null",
  );
}

it("shows only the current step and requires confirmations before unlocking later steps", async () => {
  const { user } = mount();
  expect(
    screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent),
  ).toEqual(["Install Everr"]);
  expect(
    screen.getByRole("button", { name: /Connect your agent/ }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: /Setup telemetry/ }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: /To production/ })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Copy install command" }),
  );
  expect(completeOnboarding).not.toHaveBeenCalled();
  expect(savedProgress()).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "I already have the CLI" }),
  );
  expect(
    screen.getByRole("heading", { name: "Connect your agent" }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Install Everr" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Use my coding agent" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(savedProgress()).toEqual({ step: "agent", mode: "agent" });
});

it("walks the agent path and finishes with an endpoint and production handoff but no second prompt", async () => {
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "CLI installed" }));
  expect(
    screen.getByText("everr skills install --all --project"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Copy skills command" }));
  expect(screen.queryByText("/everr-setup-telemetry")).toBeNull();
  expect(savedProgress()).toEqual({ step: "agent", mode: "agent" });
  await user.click(
    screen.getByRole("button", { name: "Project skills installed" }),
  );
  expect(screen.getByText("/everr-setup-telemetry")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Copy setup command" }));
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
  expect(savedProgress()).toEqual({ step: "local", mode: "agent" });
  await user.click(
    screen.getByRole("button", { name: "I can see my local telemetry" }),
  );
  const production = within(
    screen.getByRole("region", { name: "To production" }),
  );
  expect(production.getByText("https://ingest.everr.dev/")).toBeVisible();
  expect(
    production.getByText(
      /Follow the production instructions from the setup command in the previous step/,
    ),
  ).toBeVisible();
  expect(production.queryByText(/\/everr-setup-telemetry/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Copy setup command" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Copy production endpoint" }),
  );
  expect(completeOnboarding).not.toHaveBeenCalled();
  expect(savedProgress()).toEqual({ step: "production", mode: "agent" });
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
  expect(persisted.onboardingCompleted).toBe(true);
  expect(createApiKey).not.toHaveBeenCalled();
});

it("skips project skills for manual setup and lets members finish without keys", async () => {
  persisted.canCreateKeys = false;
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "CLI installed" }));
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  const guide = screen.getByRole("link", {
    name: "Open the instrumentation guide",
  });
  expect(guide).toHaveAttribute("target", "_blank");
  expect(
    screen.queryByRole("button", { name: "Copy skills command" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Copy setup command" }),
  ).toBeNull();
  expect(savedProgress()).toEqual({ step: "local", mode: "manual" });
  await user.click(guide);
  expect(savedProgress()).toEqual({ step: "local", mode: "manual" });
  expect(completeOnboarding).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "I can see my local telemetry" }),
  );
  expect(
    screen.getByRole("link", { name: "Open the production guide" }),
  ).toHaveAttribute("target", "_blank");
  expect(screen.getByText(/admin or owner needs to create/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Create ingestion key" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull();
});

it("can still advance and choose a method when browser storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "CLI installed" }));
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  expect(
    screen.getByRole("link", { name: "Open the instrumentation guide" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "I can see my local telemetry" }),
  );
  expect(
    screen.getByRole("link", { name: "Open the production guide" }),
  ).toBeVisible();
  expect(completeOnboarding).not.toHaveBeenCalled();
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
  expect(persisted.onboardingCompleted).toBe(false);
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
});

it("polls visible Home until another member completes the organization onboarding", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  try {
    mount({ preload: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getHomeStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(getHomeStatus).toHaveBeenCalledTimes(2);
    focusManager.setFocused(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(getHomeStatus).toHaveBeenCalledTimes(2);
    persisted.onboardingCompleted = true;
    await act(async () => {
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getHomeStatus).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getHomeStatus).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Telemetry Usage dashboard")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Install Everr" })).toBeNull();
  } finally {
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  }
});

it("restores saved progress and reviews earlier steps without forgetting later confirmations", async () => {
  seedProgress("production");
  const { user } = mount();
  expect(screen.getByRole("heading", { name: "To production" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Install Everr/ }));
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  expect(savedProgress()).toEqual({ step: "production", mode: "agent" });
  await user.click(
    screen.getByRole("button", { name: "I already have the CLI" }),
  );
  expect(
    screen.getByRole("heading", { name: "Connect your agent" }),
  ).toBeVisible();
  expect(savedProgress()).toEqual({ step: "production", mode: "agent" });
  await user.click(screen.getByRole("button", { name: /To production/ }));
  expect(
    screen.getByRole("button", { name: "Finish onboarding" }),
  ).toBeVisible();
});

it("keeps the method saved by the single-page flow", async () => {
  localStorage.setItem(
    onboardingProgressKey("alice", "one"),
    JSON.stringify({ mode: "manual" }),
  );
  const { user } = mount();
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "CLI installed" }));
  expect(
    screen.getByRole("button", { name: "Set up manually" }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  expect(
    screen.getByRole("link", { name: "Open the instrumentation guide" }),
  ).toBeVisible();
});

it("keeps completed organizations on ordinary Home after refresh, regardless of saved progress", async () => {
  persisted.onboardingCompleted = true;
  seedProgress("production", "manual");
  const first = mount();
  expect(screen.getByText("Telemetry Usage dashboard")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "To production" })).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
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
  expect(args.replace).toBe(true);
  rerender(home("one", "alice", false));
  expect(screen.getByText("Telemetry Usage dashboard")).toBeVisible();
  expect(screen.queryByRole("link")).toBeNull();
});

it("uses the saved step when completed onboarding is explicitly reopened", () => {
  persisted.onboardingCompleted = true;
  seedProgress("local", "manual");
  mount({ setupRequested: true });
  expect(
    screen.getByRole("heading", { name: "Setup telemetry" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Open the instrumentation guide" }),
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
  expect(savedProgress()).toEqual({ step: "production", mode: "agent" });
  expect(completeOnboarding).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
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
  await waitFor(() => expect(getHomeStatus).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("button", { name: "Finish onboarding" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
  await act(async () => {
    resolveRefresh(previous);
    await refresh;
  });
  expect(client.getQueryData<HomeStatus>(queryKey)?.onboardingCompleted).toBe(
    true,
  );
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
  await waitFor(() =>
    expect(getHomeStatus).toHaveBeenCalledWith({
      data: { organizationId: "two" },
    }),
  );
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
  await user.click(screen.getByRole("button", { name: "Create key" }));
  expect(await screen.findByText("ek_shown_once")).toBeVisible();
  expect(createApiKey).toHaveBeenCalledWith({
    data: { name: "production", scopes: ["ingest"] },
  });
  expect(persisted.onboardingCompleted).toBe(false);
  expect(savedProgress()).toEqual({ step: "production", mode: "agent" });
  act(() =>
    client.setQueryData(homeStatusQueryOptions("alice", "one").queryKey, {
      ...persisted,
      onboardingCompleted: true,
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText("See where your app slows down or fails"),
    ).toBeNull(),
  );
  expect(screen.getByText("ek_shown_once")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByText("Telemetry Usage dashboard")).toBeVisible();
});

it("isolates saved steps and methods between users and organizations", async () => {
  seedProgress("local");
  const { home, rerender, user } = mount();
  expect(screen.getByText("/everr-setup-telemetry")).toBeVisible();
  rerender(home("two"));
  await user.click(
    await screen.findByRole("button", { name: "CLI installed" }),
  );
  await user.click(screen.getByRole("button", { name: "Set up manually" }));
  expect(
    JSON.parse(
      localStorage.getItem(onboardingProgressKey("alice", "two")) ?? "null",
    ),
  ).toEqual({ step: "local", mode: "manual" });
  rerender(home("one", "bob"));
  expect(
    await screen.findByRole("heading", { name: "Install Everr" }),
  ).toBeVisible();
  expect(localStorage.getItem(onboardingProgressKey("bob", "one"))).toBeNull();
  expect(savedProgress()).toEqual({ step: "local", mode: "agent" });
});

it("restores the current step after refresh and recovers from corrupt storage", async () => {
  const first = mount();
  await first.user.click(screen.getByRole("button", { name: "CLI installed" }));
  await first.user.click(
    screen.getByRole("button", { name: "Set up manually" }),
  );
  first.unmount();
  const second = mount();
  expect(
    screen.getByRole("heading", { name: "Setup telemetry" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Open the instrumentation guide" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Finish onboarding" }),
  ).toBeNull();
  second.unmount();
  localStorage.setItem(onboardingProgressKey("alice", "one"), "invalid json");
  mount();
  expect(screen.getByRole("heading", { name: "Install Everr" })).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
});

it("keeps public-key origin validation and ingest-only scope", async () => {
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
  expect(createApiKey).not.toHaveBeenCalled();
  await user.clear(origins);
  await user.type(origins, "https://app.example.com");
  await user.click(screen.getByRole("button", { name: "Create public key" }));
  await screen.findByText("ek_shown_once");
  expect(createApiKey).toHaveBeenCalledWith({
    data: {
      name: "browser",
      scopes: ["ingest"],
      public: true,
      allowedOrigins: ["https://app.example.com"],
    },
  });
});
