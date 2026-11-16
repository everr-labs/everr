import { ClipboardList } from "lucide-react";
import { instrumentMissingPrompt } from "#app/data/dashboards/built-in/prompt.ts";
import { PromptHandoff } from "./prompt-handoff";

/**
 * Appears on a built-in dashboard whose telemetry requirements are unmet.
 * Instead of forking the dashboard (which would produce empty panels), this
 * hands the Agent a prompt that investigates and sets up the missing
 * instrumentation.
 */
export function InstrumentFromBuiltin({ name, missing }: { name: string; missing: string[] }) {
  return (
    <PromptHandoff
      // Primary: with no data, setting it up is the only thing to do here.
      triggerVariant="default"
      trigger={
        <>
          <ClipboardList className="size-3.5" />
          Set up instrumentation
        </>
      }
      title="Send the missing telemetry"
      description="Paste this into your coding assistant. It checks which instrumentation this dashboard needs and sets it up."
      prompt={instrumentMissingPrompt({ name, missing })}
    />
  );
}
