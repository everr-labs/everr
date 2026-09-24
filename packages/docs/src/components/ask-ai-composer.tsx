import { Check, Copy } from "lucide-react";
import { useState } from "react";

const defaultPrompt =
  "Look into Everr at https://everr.dev. How can we benefit from it and how would it help us? Is it worth trying?";

export function AskAiComposer() {
  const [prompt, setPrompt] = useState(defaultPrompt);
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
            Is Everr right for you?
          </h3>
          <p className="mt-3 text-sm text-muted-foreground">
            Ask your AI to take a look.
          </p>
        </div>
        <div className="ml-6 rounded-[16px_16px_4px_16px] border border-border bg-background px-[18px] pt-[18px] pb-3 focus-within:border-primary">
          <textarea
            className="block min-h-[210px] w-full resize-none border-0 bg-transparent p-0 font-sans text-base leading-[1.6] text-foreground caret-primary outline-none placeholder:text-muted-foreground min-[481px]:min-h-[150px]"
            aria-label="Prompt for your AI"
            placeholder="Write your prompt…"
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
              aria-label={status === "copied" ? "Prompt copied" : "Copy prompt"}
              title={status === "copied" ? "Copied" : "Copy prompt"}
              disabled={!prompt.trim()}
              onClick={copy}
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
          role="status"
        >
          {status === "error"
            ? "Copy failed. Select the text above and copy it manually."
            : status === "copied"
              ? "Copied. Paste into your AI to start the conversation."
              : "Take this to ChatGPT, Claude, or your coding agent."}
        </p>
      </div>
    </div>
  );
}
