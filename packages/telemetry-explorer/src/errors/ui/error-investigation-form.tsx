import { Button } from "@everr/ui/components/button";
import { Textarea } from "@everr/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { errorTriageEventsQueryKey } from "../data/options";
import type { CreateErrorInvestigationInput } from "../data/schemas";

export type CreateErrorInvestigation = (
  input: CreateErrorInvestigationInput,
) => Promise<unknown>;

export function ErrorInvestigationForm({
  fingerprint,
  createInvestigation,
}: {
  fingerprint: string;
  createInvestigation: CreateErrorInvestigation;
}) {
  const fieldId = useId();
  const [body, setBody] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: CreateErrorInvestigationInput) =>
      createInvestigation(input),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({
        queryKey: errorTriageEventsQueryKey(fingerprint),
      });
    },
  });

  const trimmed = body.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || mutation.isPending) return;
    mutation.mutate({ fingerprint, body: trimmed });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2 border-t p-3">
      <label htmlFor={fieldId} className="sr-only">
        Record an Investigation
      </label>
      <Textarea
        id={fieldId}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Record an Investigation: what you found, what you ruled out, where to look next."
        disabled={mutation.isPending}
        className="min-h-20"
      />
      {mutation.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Failed to record the Investigation."}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Markdown supported. Entries are append-only and cannot be edited.
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={!trimmed || mutation.isPending}
        >
          {mutation.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : null}
          Record Investigation
        </Button>
      </div>
    </form>
  );
}
