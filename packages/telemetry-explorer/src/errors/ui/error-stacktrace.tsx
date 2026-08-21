import { CodeBlock } from "@everr/ui/components/code-block";
import { CopyValueButton } from "@everr/ui/components/detail-panel";

export function ErrorStacktrace({
  stacktrace,
  message,
}: {
  stacktrace: string;
  message?: string;
}) {
  if (stacktrace.trim().length === 0) return null;
  const copyValue = message ? `${message}\n\n${stacktrace}` : stacktrace;

  return (
    <section className="group min-w-0 rounded-md border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Stacktrace</h2>
        <CopyValueButton
          value={copyValue}
          className="opacity-100 focus-visible:opacity-100"
        />
      </div>
      <CodeBlock className="max-h-[28rem] rounded-md bg-muted/40">
        <code className="font-mono">{stacktrace}</code>
      </CodeBlock>
    </section>
  );
}
