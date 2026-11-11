import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { m } from "@/paraglide/messages";

export function AskAiComposer() {
  const [prompt, setPrompt] = useState<string>(() => m.ask_prompt());
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="p-4 min-[481px]:p-6">
        <div className="flex flex-col items-start justify-center px-2 pt-4 pb-7 text-left">
          <h3 className="text-[clamp(22px,2.4vw,28px)] font-medium leading-[1.2] tracking-[-0.025em]">
            {m.ask_card_title()}
          </h3>
          <p className="mt-3 text-sm text-muted-foreground">{m.ask_card_lead()}</p>
        </div>
        <div className="ml-6 rounded-[16px_16px_4px_16px] border border-border bg-background px-[18px] pt-[18px] pb-3 focus-within:border-primary">
          <textarea
            className="block min-h-[210px] w-full resize-none border-0 bg-transparent p-0 font-sans text-base leading-[1.6] text-foreground caret-primary outline-none placeholder:text-muted-foreground min-[481px]:min-h-[150px]"
            aria-label={m.ask_prompt_label()}
            placeholder={m.ask_placeholder()}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setStatus("idle");
            }}
            spellCheck={false}
          />
          <div className="mt-3 flex items-center justify-end gap-3">
            <button
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary"
              type="button"
              aria-label={status === "copied" ? m.ask_copied_label() : m.ask_copy()}
              title={status === "copied" ? m.ask_copied_title() : m.ask_copy()}
              disabled={!prompt.trim()}
              onClick={() => {
                void copy();
              }}
            >
              {status === "copied" ? (
                <Check size={20} aria-hidden="true" />
              ) : (
                <Copy size={20} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        <p
          className="mt-3 ml-6 text-center text-xs leading-normal text-muted-foreground"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the existing status element and layout.
          role="status"
        >
          {status === "error"
            ? m.ask_status_error()
            : status === "copied"
              ? m.ask_status_copied()
              : m.ask_status_idle()}
        </p>
      </div>
    </div>
  );
}
