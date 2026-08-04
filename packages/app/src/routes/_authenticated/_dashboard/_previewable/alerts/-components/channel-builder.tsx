import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import { TagsInput } from "@everr/ui/components/tags-input";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ccQueries } from "@/data/cc/queries";
import {
  createCcChannel,
  testCcChannel,
  updateCcChannel,
} from "@/data/cc/server";
import type { CcChannel, CcChannelConfig } from "@/data/cc/types";
import { authClient } from "@/lib/auth-client";
import { CcDrawer } from "./cc-drawer";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  CHANNEL_URL_FIELD,
  type ChannelType,
} from "./channel-meta";
import { CcConceptNote, ccErrorMessage, isDuplicateName } from "./shared";

/** Every per-type field kept side by side so switching the type never loses input. */
type ConfigDraft = {
  type: ChannelType;
  url: string;
  to: string[];
  botToken: string;
  chatIds: string[];
};

const EMPTY_DRAFT: ConfigDraft = {
  type: "webhook",
  url: "",
  to: [],
  botToken: "",
  chatIds: [],
};

// Secret fields come back redacted ("***"), so an edit starts them blank and
// the user re-enters them; non-secret fields prefill as stored.
function draftFromConfig(config: CcChannelConfig): ConfigDraft {
  switch (config.type) {
    case "webhook":
    case "slack":
    case "discord":
      return { ...EMPTY_DRAFT, type: config.type };
    case "email":
      return { ...EMPTY_DRAFT, type: config.type, to: config.to };
    case "telegram":
      return { ...EMPTY_DRAFT, type: config.type, chatIds: config.chat_ids };
  }
}

function draftToConfig(d: ConfigDraft): CcChannelConfig | null {
  switch (d.type) {
    case "webhook":
    case "slack":
    case "discord":
      return d.url ? { type: d.type, url: d.url } : null;
    case "email":
      return d.to.length > 0 ? { type: d.type, to: d.to } : null;
    case "telegram":
      return d.botToken && d.chatIds.length > 0
        ? { type: d.type, bot_token: d.botToken, chat_ids: d.chatIds }
        : null;
  }
}

export function ChannelBuilder({
  open,
  onOpenChange,
  existingNames,
  channel: editing = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** CC's create answers 409 for an existing name; block duplicates client-side. */
  existingNames: string[];
  /** Edit target; the caller remounts (key) per target, so state inits here. */
  channel?: CcChannel | null;
}) {
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const [name, setName] = useState(editing?.name ?? "");
  const [draft, setDraft] = useState<ConfigDraft>(() =>
    editing ? draftFromConfig(editing.config) : EMPTY_DRAFT,
  );
  // testedConfig = JSON.stringify of the config the request was issued for;
  // the draft can move on while the engine answers, so the result only counts
  // while it still matches the on-screen config.
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    error?: string;
    testedConfig: string;
  } | null>(null);

  const duplicate = isDuplicateName(existingNames, name.trim(), editing?.name);
  const config = draftToConfig(draft);
  const urlField = CHANNEL_URL_FIELD[draft.type];

  const patch = (p: Partial<ConfigDraft>) => {
    // Clear at the one place the draft changes, so a stale tick never vouches
    // for a config no longer on screen.
    setTestResult(null);
    setDraft((d) => ({ ...d, ...p }));
  };

  const save = useMutation({
    mutationFn: () => {
      if (!config) throw new Error("channel config is incomplete");
      const trimmed = name.trim();
      return editing
        ? updateCcChannel({
            data: { name: editing.name, newName: trimmed, config },
          })
        : createCcChannel({ data: { name: trimmed, config } });
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ccQueries.channels().queryKey });
      onOpenChange(false);
      toast.success(`Channel "${c.name}" ${editing ? "updated" : "created"}`);
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const test = useMutation({
    mutationFn: (testedConfig: CcChannelConfig) =>
      testCcChannel({ data: { config: testedConfig } }),
    onSuccess: (r, testedConfig) =>
      setTestResult({
        ok: r.ok,
        latencyMs: r.latency_ms,
        ...(r.error === undefined ? {} : { error: r.error }),
        testedConfig: JSON.stringify(testedConfig),
      }),
    onError: (e, testedConfig) =>
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: ccErrorMessage(e),
        testedConfig: JSON.stringify(testedConfig),
      }),
  });

  return (
    <CcDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit channel" : "New channel"}
      footer={
        <>
          <Button
            variant="outline"
            disabled={!config || test.isPending}
            onClick={() => config && test.mutate(config)}
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
      <CcConceptNote>
        A channel is a named delivery endpoint that any number of receivers can
        reference. Secret fields (webhook URLs, the Telegram token) are
        write-only: the engine redacts them on read, so editing a channel means
        entering them again.
      </CcConceptNote>
      <div className="space-y-1.5">
        <Label htmlFor="channel-name">Name</Label>
        <Input
          id="channel-name"
          value={name}
          aria-invalid={duplicate ? true : undefined}
          onChange={(e) => setName(e.target.value)}
          placeholder="team-slack"
        />
        {duplicate && (
          <p className="text-destructive text-xs" role="alert">
            A channel with this name already exists
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="channel-type">Type</Label>
        <OptionCombobox
          id="channel-type"
          value={draft.type}
          onChange={(v) => patch({ type: v as ChannelType })}
          options={(Object.keys(CHANNEL_LABEL) as ChannelType[]).map((t) => ({
            value: t,
            label: CHANNEL_LABEL[t],
            icon: CHANNEL_ICON[t],
          }))}
        />
      </div>
      {urlField && (
        <div className="space-y-1.5">
          <Label htmlFor="channel-url">{urlField.label}</Label>
          <Input
            id="channel-url"
            type="url"
            className="font-mono"
            value={draft.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder={urlField.placeholder}
          />
          {editing !== null && (
            <p className="text-xs text-muted-foreground">
              The stored URL stays hidden; saving replaces it with what you
              enter here.
            </p>
          )}
        </div>
      )}
      {draft.type === "email" && (
        <div className="space-y-1.5">
          <Label>Recipients</Label>
          <TagsInput
            aria-label="Recipient addresses"
            placeholder="oncall@example.com"
            value={draft.to}
            onValueChange={(to) => patch({ to })}
          />
          <p className="text-xs text-muted-foreground">
            {session?.user?.email
              ? `A test sends to ${session.user.email}, not the recipients above, so it proves delivery works without mailing the list.`
              : "A test sends to your own address, not the recipients above, so it proves delivery works without mailing the list."}
          </p>
        </div>
      )}
      {draft.type === "telegram" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="channel-bot-token">Bot token</Label>
            <Input
              id="channel-bot-token"
              className="font-mono"
              value={draft.botToken}
              onChange={(e) => patch({ botToken: e.target.value })}
              placeholder="123456789:ABC..."
            />
            {editing !== null && (
              <p className="text-xs text-muted-foreground">
                The stored token stays hidden; saving replaces it with what you
                enter here.
              </p>
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
          </div>
        </>
      )}
      {testResult && testResult.testedConfig === JSON.stringify(config) && (
        <p
          role={testResult.ok ? "status" : "alert"}
          className={cn(
            "text-xs",
            testResult.ok
              ? toneText({ tone: "healthy" })
              : toneText({ tone: "danger" }),
          )}
        >
          {testResult.ok
            ? `Delivered in ${testResult.latencyMs}ms`
            : `Not delivered: ${testResult.error ?? "unknown error"}`}
        </p>
      )}
    </CcDrawer>
  );
}
