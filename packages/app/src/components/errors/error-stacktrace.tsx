export function ErrorStacktrace({ stacktrace }: { stacktrace: string }) {
  const lines = stacktrace
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  return (
    <section className="min-w-0 rounded-md border bg-background p-3">
      <h2 className="mb-3 text-sm font-medium">Stacktrace</h2>
      <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
        <code className="grid gap-1 font-mono">
          {lines.map((line, index) => (
            <span key={`${index}-${line}`}>{line}</span>
          ))}
        </code>
      </pre>
    </section>
  );
}
