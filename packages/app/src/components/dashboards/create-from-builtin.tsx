import { GitFork } from "lucide-react";
import { createFromBuiltinPrompt } from "#app/data/dashboards/built-in/prompt.ts";
import { PromptHandoff } from "./prompt-handoff";

/**
 * The only create path a built-in offers: hand the Agent a prompt that reads
 * the built-in through the resources API and applies an adapted copy as code.
 * There is no in-app create on purpose (ADR 0004) — a Dashboard made here
 * would exist in no repository, so apply could never reconcile it.
 */
export function CreateFromBuiltin({ slug, name }: { slug: string; name: string }) {
  return (
    <PromptHandoff
      trigger={
        <>
          <GitFork className="size-3.5" />
          Fork this dashboard
        </>
      }
      title="Fork into your repository"
      description="Paste this into your coding assistant and finish the last line with what to change. It saves an adapted copy as code and runs everr apply."
      prompt={createFromBuiltinPrompt({ slug, name })}
    />
  );
}
