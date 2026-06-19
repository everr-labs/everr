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
import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ALL_API_KEY_SCOPES,
  useCreateApiKey,
} from "@/components/api-keys/queries";
import { SCOPE_ICONS } from "@/components/api-keys/scope-meta";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/api-key-scopes";

function defaultScopes(): Record<ApiKeyScope, boolean> {
  // New keys get every scope by default — same as the server's
  // `defaultPermissions` in auth.server.ts. The user can deselect any
  // scope they don't want before creating the key.
  return Object.fromEntries(
    ALL_API_KEY_SCOPES.map((scope) => [scope, true]),
  ) as Record<ApiKeyScope, boolean>;
}

export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [scopes, setScopes] =
    useState<Record<ApiKeyScope, boolean>>(defaultScopes);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useCreateApiKey();

  const reset = () => {
    setName("");
    setExpiresInDays("");
    setScopes(defaultScopes());
    setIssuedKey(null);
    setCopied(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && create.isPending) return;
    setOpen(next);
    if (!next) reset();
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
    const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
    create.mutate(
      { name: trimmed, expiresInDays: days, scopes: selectedScopes },
      {
        onSuccess: (data) => {
          const key = (data as { key?: string | null } | null)?.key ?? null;
          if (!key) {
            toast.error("Server did not return a key");
            return;
          }
          setIssuedKey(key);
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
      setTimeout(() => setCopied(false), 1500);
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
                This is the only time the full key is shown. Store it in your
                secret manager — you won't be able to retrieve it later.
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
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy key"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>New API key</DialogTitle>
              <DialogDescription>
                Mint an organization-scoped{" "}
                <code className="font-mono text-[0.7rem]">ek_</code> key and
                choose what it's allowed to do.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="prod-api"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-key-expiry">Expires in</Label>
                <div className="relative">
                  <Input
                    id="api-key-expiry"
                    type="number"
                    min={1}
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(e.target.value)}
                    placeholder="never"
                    className="pr-12"
                  />
                  <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
                    days
                  </span>
                </div>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Capabilities</legend>
              <p className="text-muted-foreground text-xs">
                The key is rejected for anything outside what you select.
              </p>
              <div className="space-y-2 pt-0.5">
                {ALL_API_KEY_SCOPES.map((scope) => {
                  const meta = API_KEY_SCOPES[scope];
                  const Icon = SCOPE_ICONS[scope];
                  const inputId = `api-key-scope-${scope}`;
                  return (
                    <label
                      key={scope}
                      htmlFor={inputId}
                      className="group/cap ring-offset-background has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-ring relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-1"
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        className="sr-only"
                        checked={scopes[scope]}
                        onChange={() => toggleScope(scope)}
                      />
                      <span className="bg-muted/50 text-muted-foreground group-has-[:checked]/cap:border-primary/30 group-has-[:checked]/cap:bg-primary/10 group-has-[:checked]/cap:text-primary flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block text-sm font-medium">
                          {meta.label}
                        </span>
                        <span className="text-muted-foreground block text-xs/relaxed">
                          {meta.description}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="border-muted-foreground/40 group-has-[:checked]/cap:border-primary group-has-[:checked]/cap:bg-primary group-has-[:checked]/cap:text-primary-foreground mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-transparent transition-colors"
                      >
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    </label>
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
              <Button
                type="submit"
                disabled={create.isPending || noScopePicked}
              >
                {create.isPending && (
                  <Loader2 className="size-4 animate-spin" />
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
