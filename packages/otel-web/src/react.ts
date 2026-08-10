// The functions of the SDK for React. They are in a separate entry. Thus the
// core code uses no framework, and a consumer of the index entry does not get
// these bytes in its build. The react package is an optional peer dependency,
// and only this entry needs it. This module imports the dynamic `report`
// binding from the errors module. Thus the reports operate when a WebSDK
// exists.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { report } from "./errors.js";

export function captureReactError(
  error: unknown,
  errorInfo?: { componentStack?: string | null },
): void {
  // Before a WebSDK exists, this gives a warning and throws no error. Thus an
  // incorrect setup is visible. After shutdown it gives no warning, and this is
  // correct. It also operates on the server when the WebSDK for the server
  // exists.
  report(
    error,
    "react",
    errorInfo?.componentStack
      ? { "everr.react.component_stack": errorInfo.componentStack }
      : undefined,
  );
}

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
 * Reports the render errors through the SDK with `captureReactError`, then
 * shows the fallback in place of the components below it. This module uses no
 * JSX, and at run time it uses only react. Thus the entry stays small.
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
