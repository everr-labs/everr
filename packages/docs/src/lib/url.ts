export function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  if (process.env.NODE_ENV === "production") {
    return "https://everr.dev";
  }

  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}
