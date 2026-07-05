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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Switch } from "@everr/ui/components/switch";
import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCreateApiKey } from "@/components/api-keys/queries";
import { SCOPE_ICONS } from "@/components/api-keys/scope-meta";
import { ALL_API_KEY_SCOPES, API_KEY_SCOPES, type ApiKeyScope } from "@/lib/api-key-scopes";

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
] as const;

type Expiry = (typeof EXPIRY_OPTIONS)[number]["value"];

function defaultScopes(): Record<ApiKeyScope, boolean> {
  // Default to no capabilities — least privilege. The user must opt into
  // each capability the key needs, and creation requires at least one.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Object.fromEntries returns a string-indexed type; a Record over the finite ApiKeyScope union can't be recovered from a dynamic key list, and we derive from ALL_API_KEY_SCOPES on purpose (single source of truth)
  return Object.fromEntries(ALL_API_KEY_SCOPES.map((scope) => [scope, false])) as Record<
    ApiKeyScope,
    boolean
  >;
}

export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("never");
  const [scopes, setScopes] = useState<Record<ApiKeyScope, boolean>>(defaultScopes);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const create = useCreateApiKey();

  // Clear the "Copied" reset timer if the dialog unmounts mid-countdown.
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);

  const reset = () => {
    setName("");
    setExpiry("never");
    setScopes(defaultScopes());
    setIssuedKey(null);
    setCopied(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && create.isPending) return;
    // Reset on open, not close: clearing `issuedKey` on close would swap the
    // success screen back to the form mid close-out animation (a visible
    // flash). Closing keeps whatever was shown; the next open starts fresh.
    if (next) reset();
    setOpen(next);
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
  };

  const selectedScopes = ALL_API_KEY_SCOPES.filter((s) => scopes[s]);
  const noScopePicked = selectedScopes.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (noScopePicked) {
      toast.error("Pick at least one capability for the key");
      return;
    }
    const days = expiry === "never" ? undefined : Number(expiry);
    create.mutate(
      { name: trimmed, expiresInDays: days, scopes: selectedScopes },
      {
        // The server fn guarantees a string `key` or throws, so no null guard.
        onSuccess: (data) => {
          setIssuedKey(data.key);
          toast.success("API key created");
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
      clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New key
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {issuedKey ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                  <KeyRound className="size-4" />
                </span>
                Copy your key now
              </DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. Store it in your secret manager — you
                won&apos;t be able to retrieve it later.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted/40 rounded-md border p-3 font-mono text-xs break-all">
              {issuedKey}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
              <Button onClick={copyKey}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "Copied" : "Copy key"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Mint an organization-scoped <code className="font-mono text-[0.7rem]">ek_</code> key
                and choose what it&apos;s allowed to do.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  name="api-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="prod-api"
                  required
                  autoFocus
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-key-expiry">Expiration</Label>
                <Select
                  value={expiry}
                  onValueChange={(v) => {
                    const option = EXPIRY_OPTIONS.find((o) => o.value === v);
                    if (option) setExpiry(option.value);
                  }}
                >
                  <SelectTrigger id="api-key-expiry" className="w-full">
                    <SelectValue>
                      {EXPIRY_OPTIONS.find((o) => o.value === expiry)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Capabilities</legend>
              <p className="text-muted-foreground text-xs">
                Grant only what this key needs — it&apos;s rejected for anything else.
              </p>
              <div className="space-y-2 pt-0.5">
                {ALL_API_KEY_SCOPES.map((scope) => {
                  const meta = API_KEY_SCOPES[scope];
                  const Icon = SCOPE_ICONS[scope];
                  const switchId = `api-key-scope-${scope}`;
                  return (
                    <div
                      key={scope}
                      className="has-[[data-checked]]:border-foreground/20 flex items-center gap-3 rounded-lg border p-3 transition-colors"
                    >
                      <span className="bg-muted/50 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
                        <Icon className="size-4" />
                      </span>
                      <label
                        htmlFor={switchId}
                        className="min-w-0 flex-1 cursor-pointer space-y-0.5"
                      >
                        <span className="block text-sm font-medium">{meta.label}</span>
                        <span className="text-muted-foreground block text-xs/relaxed">
                          {meta.description}
                        </span>
                      </label>
                      <Switch
                        id={switchId}
                        checked={scopes[scope]}
                        onCheckedChange={() => toggleScope(scope)}
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || noScopePicked}>
                {create.isPending && <Loader2 className="size-4 animate-spin" />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
