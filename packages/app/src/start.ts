import { createStart } from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";

declare global {
  // eslint-disable-next-line no-var
  var __citricAppRuntimeStartedPromise: Promise<void> | undefined;
}

export function ensureAppRuntimeStarted(): Promise<void> {
  if (!import.meta.env.SSR || process.env.NODE_ENV === "test") {
    return Promise.resolve();
  }

  if (!globalThis.__citricAppRuntimeStartedPromise) {
    globalThis.__citricAppRuntimeStartedPromise = import(
      "./server/github-events/runtime"
    )
      .then((runtime) => runtime.ensureGitHubEventsRuntimeStarted())
      .then(() => undefined)
      .catch((error) => {
        globalThis.__citricAppRuntimeStartedPromise = undefined;
        throw error;
      });
  }

  return globalThis.__citricAppRuntimeStartedPromise;
}

export const startInstance = createStart(() => ({
  requestMiddleware: [authkitMiddleware()],
}));
