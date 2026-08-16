// The functions of the SDK for React. They are in a separate entry. Thus the
// core code uses no framework, and a consumer of the index entry does not get
// these bytes in its build. The react package is an optional peer dependency,
// and only this entry needs it. This module imports `captureError` from the
// package itself. The "." export in package.json selects the entry for the
// runtime: the index entry in the browser, and the server entry in Node. Thus
// one react entry operates in the two module graphs, and no code changes a
// binding at run time.

import { captureError } from "@everr/otel-web";
import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children?: ReactNode;
  /**
   * React shows this in place of the children after an error. It is a node, or
   * a function that receives the value of the error. The default shows nothing.
   */
  fallback?: ReactNode | ((error: unknown) => ReactNode);
};

type ErrorBoundaryState = { errored: boolean; error?: unknown };

/**
 * Reports the render errors through the SDK with the "react" mechanism and the
 * component stack, then shows the fallback in place of the components below
 * it. This module uses no JSX, and at run time it uses only react. Thus the
 * entry stays small.
 *
 * In the browser the report gives a warning before a WebSDK exists, and it
 * does nothing after shutdown. Thus an incorrect setup is visible. On the
 * server it operates without a WebSDK, because the report.server module needs
 * no setup.
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
    captureError(error, {
      "everr.error.mechanism": "react",
      "everr.react.component_stack": errorInfo.componentStack ?? undefined,
    });
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
