import { Button } from "@everr/ui/components/button";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { useRef } from "react";

export function InvitationLink({ url }: { url: string }) {
  const linkRef = useRef<HTMLElement>(null);
  const { state, copy } = useCopyToClipboard(url, { selectOnFailure: linkRef });
  return (
    <div className="space-y-3">
      <code
        ref={linkRef}
        className="block break-all rounded-md border bg-muted p-3 text-sm"
      >
        {url}
      </code>
      <Button type="button" variant="outline" onClick={copy}>
        {state === "copied" ? "Copied" : "Copy invite link"}
      </Button>
      {state === "failed" && (
        <p role="status" className="text-sm text-muted-foreground">
          Could not copy automatically. Select and copy the link above.
        </p>
      )}
    </div>
  );
}
