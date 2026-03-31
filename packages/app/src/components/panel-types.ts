import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Extract the queryFn type from a query options object. */
export type ExtractQueryFn<T> = T extends { queryFn?: infer QF }
  ? Extract<QF, (...args: never[]) => unknown>
  : never;

/** Extract the resolved data type from a query options object. */
export type ExtractQueryData<T> =
  ExtractQueryFn<T> extends (...args: never[]) => infer R
    ? Awaited<R>
    : unknown;

/** Map a tuple of query options to their resolved data types. */
export type InferQueriesData<T extends readonly unknown[]> = {
  [K in keyof T]: ExtractQueryData<T[K]>;
};

/**
 * Extract the resolved data type from a query factory function.
 * Used by TimeRangePanel where queries are factories, not options.
 */
export type InferFactoryData<T> = T extends (...args: never[]) => infer R
  ? ExtractQueryData<R>
  : unknown;

/** Map a tuple of query factories to their resolved data types. */
export type InferFactoriesData<T extends readonly unknown[]> = {
  [K in keyof T]: InferFactoryData<T[K]>;
};

/** Shared chrome props for all panel variants. */
export interface PanelChromeProps {
  title?: string;
  description?: string;
  variant?: "default" | "stat";
  skeleton?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  inset?: "default" | "flush-content";
  className?: string;
}
