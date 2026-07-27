import { diag } from "@opentelemetry/api";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { PKG_NAME } from "./client.js";
import { getClient } from "./core.js";

export function captureReactError(
  error: unknown,
  errorInfo?: { componentStack?: string | null },
): void {
  const client = getClient();
  if (!client) {
    diag.warn(`${PKG_NAME}: captureReactError called before init(); error dropped`);
    return;
  }

  client.capture({
    error,
    mechanism: "react",
    handled: true,
    attributes: errorInfo?.componentStack
      ? { "everr.react.component_stack": errorInfo.componentStack }
      : {},
  });
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureReactError(error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.error) {
      const { fallback } = this.props;
      return typeof fallback === "function"
        ? fallback(this.state.error)
        : (fallback ?? null);
    }

    return this.props.children;
  }
}
