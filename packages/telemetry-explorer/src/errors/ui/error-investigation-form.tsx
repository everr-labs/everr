import { Button } from "@everr/ui/components/button";
import { Textarea } from "@everr/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useState,
} from "react";

// Shared composer for creating and editing an Investigation. The caller owns
// what "submit" means; the composer owns text state, pending, and errors.
export function InvestigationComposer({
  initialValue = "",
  placeholder,
  submitLabel,
  hint,
  autoFocus = false,
  onSubmit,
  onSuccess,
  onCancel,
}: {
  initialValue?: string;
  placeholder: string;
  submitLabel: string;
  hint?: ReactNode;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<unknown>;
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const fieldId = useId();
  const [body, setBody] = useState(initialValue);
  const mutation = useMutation({
    mutationFn: (value: string) => onSubmit(value),
    onSuccess: () => {
      setBody("");
      onSuccess?.();
    },
  });

  const trimmed = body.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || mutation.isPending) return;
    mutation.mutate(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2">
      <label htmlFor={fieldId} className="sr-only">
        {submitLabel}
      </label>
      <Textarea
        id={fieldId}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={mutation.isPending}
        autoFocus={autoFocus}
        className="min-h-20"
      />
      {mutation.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Failed to save the Investigation."}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{hint}</div>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            disabled={!trimmed || mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : null}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
