export async function invokeCommand<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  const response = await fetch(`/api/commands/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Everr-Local": "1" },
    body: JSON.stringify(args ?? {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Local request failed");
  return result as TResult;
}

export function toErrorMessageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
