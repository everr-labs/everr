import { CodeBlock } from "@everr/ui/components/code-block";
import { CopyValueButton } from "@everr/ui/components/detail-panel";
import { ErrorDetailSection } from "./error-detail-section";

/**
 * A stack trace as the runtime wrote it. The text is free-form and each
 * runtime has its own format, so the page shows it unchanged.
 */
export function ErrorStacktrace({
  stacktrace,
  message,
  title = "Stack trace",
  emptyText,
}: {
  stacktrace: string;
  /** The exception message. The copy control puts it before the stack trace. */
  message?: string;
  title?: string;
  /** Shown when there is no stack trace. Without it the section is absent. */
  emptyText?: string;
}) {
  if (stacktrace.trim().length === 0) {
    if (!emptyText) return null;
    return (
      <ErrorDetailSection title={title}>
        <p className="text-muted-foreground text-xs">{emptyText}</p>
      </ErrorDetailSection>
    );
  }

  const copyValue = message ? `${message}\n\n${stacktrace}` : stacktrace;

  return (
    <ErrorDetailSection
      title={title}
      actions={<CopyValueButton value={copyValue} className="opacity-100" />}
    >
      <CodeBlock className="bg-muted/20 max-h-[32rem] rounded-md border">
        <code className="font-mono">{stacktrace}</code>
      </CodeBlock>
    </ErrorDetailSection>
  );
}
