import { createStart } from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";

export function ensureAppRuntimeStarted(): Promise<void> {
  if (!import.meta.env.SSR || process.env.NODE_ENV === "test") {
    return Promise.resolve();
  }

  return import("./server/github-events/runtime").then((runtime) =>
    runtime.ensureGitHubEventsRuntimeForAppStart(),
  );
}

export const startInstance = createStart(() => ({
  requestMiddleware: [authkitMiddleware()],
}));
