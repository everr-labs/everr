export async function invokeCommand<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  const response = await fetch(`/api/commands/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Everr-Local": "1" },
    body: JSON.stringify(args ?? {}),
  });
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- Preserve the permissive command boundary and original JSON/error behavior; each caller owns its response type.
  const result: TResult & { error?: string } = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Local request failed");
  return result;
}
