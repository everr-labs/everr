export interface NormalizedError {
  type: string;
  message: string;
  stacktrace?: string;
}

const MAX_CAUSE_DEPTH = 5;

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message,
      stacktrace: renderStack(error, 0),
    };
  }

  return { type: "NonError", message: safeStringify(error) };
}

function renderStack(error: Error, depth: number): string {
  let text = error.stack ?? `${error.name}: ${error.message}`;
  if (depth >= MAX_CAUSE_DEPTH) {
    return text;
  }

  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      text +=
        inner instanceof Error && inner !== error
          ? `\n[aggregate] ${renderStack(inner, depth + 1)}`
          : `\n[aggregate] ${safeStringify(inner)}`;
    }
  }

  if (error.cause !== undefined) {
    text +=
      error.cause instanceof Error && error.cause !== error
        ? `\n[cause] ${renderStack(error.cause, depth + 1)}`
        : `\n[cause] ${safeStringify(error.cause)}`;
  }

  return text;
}

export function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}
