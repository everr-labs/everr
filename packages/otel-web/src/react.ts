// The React-facing surface of the SDK, a dedicated entry so the core stays
// framework-free and index consumers never carry these bytes (react is an
// optional peer, needed only by this entry). It imports the errors module's
// live `report` binding, so reporting works whenever init() has run.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { report } from "./errors.js";

export function captureReactError(
  error: unknown,
  errorInfo?: { componentStack?: string | null },
): void {
  // Before init this warns (never throws) so miswiring is visible; after
  // shutdown it is silent by design. Works on the server too once the
  // server-side init() has run.
  report(
    error,
    "react",
    true,
    errorInfo?.componentStack
      ? { "everr.react.component_stack": errorInfo.componentStack }
      : undefined,
  );
}

type ErrorBoundaryProps = {
  children?: ReactNode;
  /**
   * Rendered in place of the children after an error: a node, or a function
   * of the thrown value. Defaults to rendering nothing.
   */
  fallback?: ReactNode | ((error: unknown) => ReactNode);
};

type ErrorBoundaryState = { errored: boolean; error?: unknown };

/**
 * Reports render errors through the SDK (as `captureReactError`) and swaps
 * the subtree for the fallback. No JSX and no runtime beyond react itself,
 * so the entry stays framework-thin.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { errored: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { errored: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureReactError(error, errorInfo);
  }

  render(): ReactNode {
    const { errored, error } = this.state;
    if (!errored) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function"
      ? fallback(error)
      : (fallback ?? null);
  }
}
