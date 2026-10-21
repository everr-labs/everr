import { z } from "zod";

const CommandErrorSchema = z.object({ error: z.string().min(1) });

export async function invokeCommand<Schema extends z.ZodType>(
  command: string,
  schema: Schema,
  args?: Record<string, unknown>,
): Promise<z.output<Schema>> {
  const response = await fetch(`/api/commands/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Everr-Local": "1" },
    body: JSON.stringify(args ?? {}),
  });
  const result: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = CommandErrorSchema.safeParse(result);
    throw new Error(error.success ? error.data.error : "Local request failed");
  }
  const parsed = schema.safeParse(result);
  if (!parsed.success) {
    throw new Error("Invalid local response", { cause: parsed.error });
  }
  return parsed.data;
}
