import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { TagsInput } from "@everr/ui/components/tags-input";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  KeyRound,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import {
  createAlertingChannel,
  testAlertingChannel,
  testAlertingSavedChannel,
  updateAlertingChannel,
} from "@/data/alerting/delivery/server";
import type {
  AlertingChannel,
  AlertingChannelConfig,
} from "@/data/alerting/types";
import { AlertingDrawer } from "../common/drawer";
import { alertingErrorMessage } from "../common/query-error";
import {
  CHANNEL_NAME_PLACEHOLDER,
  CHANNEL_SOURCE_HINT,
  CHANNEL_URL_FIELD,
  type ChannelType,
} from "./channel-meta";
import { ChannelTypeChoice } from "./channel-type-picker";
import { isDuplicateName } from "./name-validation";

/** What the API returns in place of a stored secret, and accepts to keep it. */
const REDACTED = "***";

/** What "Send test" sends: the stored channel, or the draft in the form. */
type TestTarget =
  | { kind: "saved"; name: string }
  | { kind: "draft"; config: AlertingChannelConfig };

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Every per-type field kept side by side so switching the type never loses input. */
type ConfigDraft = {
  type: ChannelType | null;
  url: string;
  botToken: string;
  chatIds: string[];
};

const EMPTY_DRAFT: ConfigDraft = {
  type: null,
  url: "",
  botToken: "",
  chatIds: [],
};

function draftFromConfig(config: AlertingChannelConfig): ConfigDraft {
  switch (config.type) {
    case "webhook":
    case "slack":
    case "discord":
      return { ...EMPTY_DRAFT, type: config.type };
    case "telegram":
      return { ...EMPTY_DRAFT, type: config.type, chatIds: config.chat_ids };
  }
}

/**
 * The config to save, or null while it is incomplete.
 *
 * `secret` is the URL or token to send: the literal `***` when the stored one
 * is being kept, which the API reads as "leave the secret alone".
 */
function draftToConfig(
  d: ConfigDraft,
  secret: string,
): AlertingChannelConfig | null {
  switch (d.type) {
    case null:
      return null;
    case "webhook":
    case "slack":
    case "discord":
      return secret ? { type: d.type, url: secret } : null;
    case "telegram":
      return secret && d.chatIds.length > 0
        ? { type: d.type, bot_token: secret, chat_ids: d.chatIds }
        : null;
  }
}

function SourceHint({ type }: { type: ChannelType }) {
  const hint = CHANNEL_SOURCE_HINT[type];
  return (
    <p className="text-xs text-muted-foreground">
      {hint.text}{" "}
      <a
        href={hint.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 underline-offset-2 outline-2 outline-dotted outline-transparent hover:text-foreground hover:underline focus-visible:outline-primary"
      >
        {hint.linkLabel}
        <ArrowUpRight className="size-3" />
      </a>
    </p>
  );
}

/** The stored secret, standing in for the input until the reader replaces it. */
function StoredSecretField({
  label,
  onReplace,
}: {
  label: string;
  onReplace: () => void;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-muted/20 px-2 sm:min-h-8">
      <KeyRound
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="flex-1 text-xs text-muted-foreground">
        Stored and hidden
      </span>
      <Button variant="outline" size="sm" onClick={onReplace}>
        Replace {label.toLowerCase()}
      </Button>
    </div>
  );
}

/** The way back from a replacement to the secret that is already stored. */
function KeepStoredSecret({
  label,
  onKeep,
}: {
  label: string;
  onKeep: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onKeep}
      className="text-xs text-muted-foreground underline-offset-2 outline-2 outline-dotted outline-transparent hover:text-foreground hover:underline focus-visible:outline-primary"
    >
      Keep the stored {label.toLowerCase()}
    </button>
  );
}

function TestResult({
  result,
}: {
  result: { ok: boolean; latencyMs: number; error?: string };
}) {
  return (
    <div
      role={result.ok ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-md border p-3 text-xs",
        result.ok
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-destructive/30 bg-destructive/5",
      )}
    >
      {result.ok ? (
        <CheckCircle2
          aria-hidden
          className={cn(
            "mt-0.5 size-3.5 shrink-0",
            toneText({ tone: "healthy" }),
          )}
        />
      ) : (
        <TriangleAlert
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-destructive"
        />
      )}
      <div className="min-w-0">
        <div className="font-medium text-foreground">
          {result.ok
            ? `Test message delivered in ${result.latencyMs}ms`
            : "Test message was not delivered"}
        </div>
        {!result.ok && (
          <div className="mt-0.5 break-words text-destructive">
            {result.error ?? "unknown error"}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChannelBuilder({
  open,
  onOpenChange,
  existingNames,
  channel: editing = null,
  initialType = null,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existingNames: string[];
  /** Edit target; the caller remounts (key) per target, so state inits here. */
  channel?: AlertingChannel | null;
  /** Type chosen on the way in, so a guided entry skips the first question. */
  initialType?: ChannelType | null;
  /** The created channel's name, for a caller resuming a receiver draft. */
  onCreated?: (name: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(
    editing?.name ??
      (initialType === null ? "" : CHANNEL_NAME_PLACEHOLDER[initialType]),
  );
  const [draft, setDraft] = useState<ConfigDraft>(() =>
    editing
      ? draftFromConfig(editing.config)
      : { ...EMPTY_DRAFT, type: initialType },
  );
  const [secretReplaced, setSecretReplaced] = useState(editing === null);
  // Ignore results for drafts changed while the test is in flight.
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
    testedTarget: string;
  } | null>(null);

  const duplicate = isDuplicateName(existingNames, name.trim(), editing?.name);
  // A type switch leaves the stored secret behind: it belongs to the endpoint
  // that was there before, and sending the placeholder to a different type
  // would save the literal `***` as the new URL.
  const storedSecretUsable =
    editing !== null && draft.type === editing.config.type;
  const keepingStoredSecret = storedSecretUsable && !secretReplaced;
  const enteredSecret = draft.type === "telegram" ? draft.botToken : draft.url;
  const secret = keepingStoredSecret ? REDACTED : enteredSecret;
  const config = draftToConfig(draft, secret);
  const urlField = draft.type ? CHANNEL_URL_FIELD[draft.type] : undefined;

  // Two things can be tested and which one it is has to stay honest: the
  // saved channel while the draft still describes it, otherwise the draft
  // itself, which needs a real secret to send with.
  const storedChatIdsUnchanged =
    editing === null ||
    editing.config.type !== "telegram" ||
    sameStrings(editing.config.chat_ids, draft.chatIds);
  const testTarget: TestTarget | null =
    editing !== null && keepingStoredSecret
      ? storedChatIdsUnchanged
        ? { kind: "saved", name: editing.name }
        : null
      : config
        ? { kind: "draft", config }
        : null;
  const testKey = JSON.stringify(testTarget);

  const patch = (p: Partial<ConfigDraft>) => {
    // A changed draft invalidates its test result.
    setTestResult(null);
    setDraft((d) => ({ ...d, ...p }));
  };

  const pickType = (type: ChannelType) => {
    // A name the reader never touched is ours to keep in step with the type.
    if (
      editing === null &&
      (name === "" ||
        (draft.type !== null && name === CHANNEL_NAME_PLACEHOLDER[draft.type]))
    ) {
      setName(CHANNEL_NAME_PLACEHOLDER[type]);
    }
    patch({ type });
  };

  const save = useMutation({
    mutationFn: () => {
      if (!config) throw new Error("channel config is incomplete");
      const trimmed = name.trim();
      return editing
        ? updateAlertingChannel({
            data: { name: editing.name, newName: trimmed, config },
          })
        : createAlertingChannel({ data: { name: trimmed, config } });
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: deliveryQueries.channels().queryKey });
      onOpenChange(false);
      if (editing === null) onCreated?.(c.name);
      toast.success(`Channel "${c.name}" ${editing ? "updated" : "created"}`);
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  const test = useMutation({
    mutationFn: (target: NonNullable<typeof testTarget>) =>
      target.kind === "saved"
        ? testAlertingSavedChannel({ data: { name: target.name } })
        : testAlertingChannel({ data: { config: target.config } }),
    onSuccess: (r, target) =>
      setTestResult({
        ok: r.ok,
        latencyMs: r.latency_ms,
        ...(r.error === undefined ? {} : { error: r.error }),
        testedTarget: JSON.stringify(target),
      }),
    onError: (e, target) =>
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: alertingErrorMessage(e),
        testedTarget: JSON.stringify(target),
      }),
  });

  return (
    <AlertingDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit channel" : "New channel"}
      footer={
        <>
          <Button
            variant="outline"
            disabled={testTarget === null || test.isPending}
            onClick={() => testTarget && test.mutate(testTarget)}
          >
            {test.isPending ? "Sending..." : "Send test"}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || duplicate || !config || save.isPending}
            onClick={() => save.mutate()}
          >
            {editing ? "Save channel" : "Create channel"}
          </Button>
        </>
      }
    >
      <ChannelTypeChoice
        value={draft.type}
        onChange={pickType}
        legend="Where it delivers"
      />
      {draft.type === null ? (
        <p className="text-xs text-muted-foreground">
          Pick a destination to configure it.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={name}
              aria-invalid={duplicate ? true : undefined}
              onChange={(e) => setName(e.target.value)}
              placeholder={CHANNEL_NAME_PLACEHOLDER[draft.type]}
            />
            {duplicate ? (
              <p className="text-destructive text-xs" role="alert">
                A channel with this name already exists
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Receivers and the delivery trail refer to the channel by this
                name.
              </p>
            )}
          </div>
          {urlField && (
            <div className="space-y-1.5">
              <Label htmlFor="channel-url">{urlField.label}</Label>
              {keepingStoredSecret ? (
                <StoredSecretField
                  label={urlField.label}
                  onReplace={() => {
                    setSecretReplaced(true);
                    patch({ url: "" });
                  }}
                />
              ) : (
                <Input
                  id="channel-url"
                  type="url"
                  className="font-mono"
                  value={draft.url}
                  onChange={(e) => patch({ url: e.target.value })}
                  placeholder={urlField.placeholder}
                />
              )}
              {storedSecretUsable && secretReplaced && (
                <KeepStoredSecret
                  label={urlField.label}
                  onKeep={() => {
                    setSecretReplaced(false);
                    patch({ url: "" });
                  }}
                />
              )}
              <SourceHint type={draft.type} />
            </div>
          )}
          {draft.type === "telegram" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="channel-bot-token">Bot token</Label>
                {keepingStoredSecret ? (
                  <StoredSecretField
                    label="Bot token"
                    onReplace={() => {
                      setSecretReplaced(true);
                      patch({ botToken: "" });
                    }}
                  />
                ) : (
                  <Input
                    id="channel-bot-token"
                    className="font-mono"
                    value={draft.botToken}
                    onChange={(e) => patch({ botToken: e.target.value })}
                    placeholder="123456789:ABC..."
                  />
                )}
                {storedSecretUsable && secretReplaced && (
                  <KeepStoredSecret
                    label="Bot token"
                    onKeep={() => {
                      setSecretReplaced(false);
                      patch({ botToken: "" });
                    }}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Chat IDs</Label>
                <TagsInput
                  aria-label="Chat IDs"
                  placeholder="-1001234567890"
                  value={draft.chatIds}
                  onValueChange={(chatIds) => patch({ chatIds })}
                />
                <SourceHint type="telegram" />
              </div>
            </>
          )}
          {testTarget === null && draft.type !== null && (
            <p className="text-xs text-muted-foreground">
              Complete the fields to send a test message.
            </p>
          )}
          {testResult && testResult.testedTarget === testKey && (
            <TestResult result={testResult} />
          )}
        </>
      )}
    </AlertingDrawer>
  );
}
