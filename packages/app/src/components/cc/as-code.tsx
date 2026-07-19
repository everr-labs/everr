// packages/app/src/components/cc/as-code.tsx
//
// The as-code bridge on rule/SLO detail pages. Rules and SLOs are Git-owned
// YAML applied with `everr apply`; "editing" one from the app means copying
// the exact document the CLI accepts, changing it in the repo, and applying.
// This disclosure makes that path one click instead of tribal knowledge.
import { Button } from "@everr/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { stringify } from "yaml";
import { CcDisclosureTrigger } from "./shared";

export function CcAsCode({
  doc,
  filename,
}: {
  /** The as-code document (AlertRuleYaml / SloYaml) to serialize. */
  doc: unknown;
  /** Suggested filename, e.g. "checkout-latency.alert.yaml". */
  filename: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const yamlText = stringify(doc);

  function handleCopy() {
    void navigator.clipboard.writeText(yamlText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CcDisclosureTrigger open={open}>
        <span className="text-xs font-medium">Edit as code</span>
        <span className="text-xs text-muted-foreground">
          the YAML document this resource is applied from
        </span>
      </CcDisclosureTrigger>
      <CollapsibleContent>
        <div className="relative mt-2">
          <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 pr-12 font-mono text-xs leading-relaxed ring-1 ring-foreground/10">
            {yamlText}
          </pre>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy YAML"
            onClick={handleCopy}
            className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="text-emerald-500" /> : <Copy />}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Save as <code className="font-mono">{filename}</code> in your repo and
          run <code className="font-mono">everr apply</code> — the applied
          version replaces this one.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
