import { Button } from "@everr/ui/components/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Bot, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface SecretRevealProps {
  secret: string;
  title: string;
  description: string;
  onDone: () => void;
}

// A secret is readable once, at creation and again at rotation. Both places
// need the same copy button, the same "Copied" countdown, and the same
// reminder that there is no second chance to read it.
export function SecretReveal({
  secret,
  title,
  description,
  onDone,
}: SecretRevealProps) {
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Clear the "Copied" reset timer if the dialog unmounts mid-countdown.
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
            <Bot className="size-4" />
          </span>
          {title}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="bg-muted/40 rounded-md border p-3 font-mono text-xs break-all">
        {secret}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
        <Button onClick={copySecret}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy secret"}
        </Button>
      </DialogFooter>
    </div>
  );
}
