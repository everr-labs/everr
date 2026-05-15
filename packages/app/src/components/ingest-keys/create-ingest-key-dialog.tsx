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
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateIngestKey } from "./queries";

export function CreateIngestKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useCreateIngestKey();

  const reset = () => {
    setName("");
    setExpiresInDays("");
    setIssuedKey(null);
    setCopied(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && create.isPending) return;
    setOpen(next);
    if (!next) reset();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
    create.mutate(
      { name: trimmed, expiresInDays: days },
      {
        onSuccess: (data) => {
          const key = (data as { key?: string } | null)?.key ?? null;
          if (!key) {
            toast.error("Server did not return a key");
            return;
          }
          setIssuedKey(key);
          toast.success("Ingest key created");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const copyKey = async () => {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        New ingest key
      </DialogTrigger>
      <DialogContent>
        {issuedKey ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Copy your key now</DialogTitle>
              <DialogDescription>
                This is the only time the full key will be shown. Store it in
                your secret manager — you won't be able to retrieve it later.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">
              {issuedKey}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button onClick={copyKey}>
                {copied ? (
                  <Check className="mr-2 size-4" />
                ) : (
                  <Copy className="mr-2 size-4" />
                )}
                {copied ? "Copied" : "Copy key"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New ingest key</DialogTitle>
              <DialogDescription>
                Mint an organization-scoped key for sending OpenTelemetry data
                to Everr.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="ingest-key-name">Name</Label>
                <Input
                  id="ingest-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="prod-api"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ingest-key-expiry">
                  Expires in (days, optional)
                </Label>
                <Input
                  id="ingest-key-expiry"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  placeholder="never"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
