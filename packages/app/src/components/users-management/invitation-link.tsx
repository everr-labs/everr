/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the existing status element and layout during the linter migration. */
import { CopyStateContent } from "@everr/ui/components/copy-state-icon";
import { Button } from "@everr/ui/components/button";
import { DialogFooter } from "@everr/ui/components/dialog";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { useRef } from "react";

export function InvitationLink({ url, onClose }: { url: string; onClose: () => void }) {
  const linkRef = useRef<HTMLElement>(null);
  const { state, copy } = useCopyToClipboard(url, { selectOnFailure: linkRef });
  return (
    <div className="space-y-4">
      <code
        ref={linkRef}
        className="bg-muted/40 block rounded-md border p-3 font-mono text-xs break-all"
      >
        {url}
      </code>
      {state === "failed" && (
        <p role="status" className="text-sm text-muted-foreground">
          Could not copy automatically. Select and copy the link above.
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Done
        </Button>
        <Button onClick={copy}>
          <CopyStateContent copied={state === "copied"} label="Copy link" iconClassName="size-4" />
        </Button>
      </DialogFooter>
    </div>
  );
}
