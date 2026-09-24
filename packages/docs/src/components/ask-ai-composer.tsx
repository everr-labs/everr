import { Check, Copy } from "lucide-react";
import { useState } from "react";

const defaultPrompt =
  "Look into Everr at https://everr.dev and its documentation. What does it do, where might it help my project, and what are its limitations? Ask me about my stack before recommending it. Be critical and cite your sources.";

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
    <div className="ai-composer">
      <div className="ai-chat-body">
        <div className="ai-chat-welcome">
          <h3>Is Everr right for you?</h3>
          <p>Ask your AI to take a look.</p>
        </div>
        <div className="ai-composer-box">
          <textarea
            aria-label="Prompt for your AI"
            placeholder="Write your prompt…"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setStatus("idle");
            }}
            spellCheck={false}
          />
          <div className="ai-composer-toolbar">
            <span>Edit your prompt, then copy</span>
            <button
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
        <p className="ai-composer-help" role="status">
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
