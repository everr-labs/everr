import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@everr/ui/components/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { mutationErrorStatus } from "#app/lib/mutation-status.ts";
import { allowedOriginsInputError, publicKeyMetadataOf } from "#app/lib/public-ingest-keys.ts";
import { AllowedOriginsField, parseAllowedOriginsText } from "./allowed-origins-field";
import { type ApiKey, useUpdatePublicKeyOrigins } from "./queries";

export function EditKeyOriginsDialog({ row }: { row: ApiKey }) {
  const [open, setOpen] = useState(false);
  const [originsText, setOriginsText] = useState("");
  const update = useUpdatePublicKeyOrigins();

  const handleOpenChange = (next: boolean) => {
    if (!next && update.isPending) return;
    if (next) {
      setOriginsText(publicKeyMetadataOf(row.metadata)?.allowedOrigins.join("\n") ?? "");
      update.reset();
    }
    setOpen(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allowedOrigins = parseAllowedOriginsText(originsText);
    const error = allowedOriginsInputError(allowedOrigins);
    if (error) {
      toast.error(error);
      return;
    }

    update.mutate(
      { keyId: row.id, allowedOrigins },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success("Allowed origins updated. Changes usually take effect within 30 seconds.");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Edit origins for ${row.name ?? "this public key"}`}
          />
        }
      >
        Edit origins
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Edit origins</DialogTitle>
            <DialogDescription>
              Update the origins allowed to use {row.name ?? "this public key"}.
            </DialogDescription>
          </DialogHeader>
          <AllowedOriginsField
            value={originsText}
            onChange={setOriginsText}
            disabled={update.isPending}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={update.isPending}
              loading={update.isPending}
              status={mutationErrorStatus(update)}
            >
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
