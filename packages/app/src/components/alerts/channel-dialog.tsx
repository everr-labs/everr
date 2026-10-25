/* oxlint-disable typescript/consistent-type-assertions -- These erased assertions describe existing trusted data and library contracts; runtime validation would change behavior. */
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import { SecretInput } from "@everr/ui/components/secret-input";
import { TagsInput } from "@everr/ui/components/tags-input";
import { cn } from "@everr/ui/lib/utils";
import { revalidateLogic, useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  type ChannelType,
  channelConfigDraft,
  EMPTY_CHANNEL_DRAFT,
  readChannelDraft,
  type WebhookHeaderDraft,
} from "#app/data/alerting/delivery/channel-input.ts";
import { testAlertingChannel } from "#app/data/alerting/delivery/server.ts";
import type { NotificationChannelView } from "#app/data/alerting/delivery/view.ts";
import { ALERTING_WEBHOOK_HEADERS_MAX } from "#app/data/alerting/delivery/webhook-headers.ts";
import type { AlertingChannelConfigInput } from "#app/data/alerting/types.ts";
import { CHANNEL_OPTIONS, CHANNEL_URL_FIELD } from "./channel-mark";

/** What the dialog is open on: a channel to make, seeded with a name when a
 *  gap row asked for one, or a channel to change. `null` while closed. */
export type ChannelTarget =
  | { mode: "new"; name: string }
  | { mode: "edit"; channel: NotificationChannelView };

/** What the dialog hands back on save. On a same-type edit, a secret left
 *  blank is omitted so the server can retain the stored one. */
export type ChannelDraft = {
  name: string;
  config: AlertingChannelConfigInput;
};

export function ChannelDialog({
  target,
  channels,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  target: ChannelTarget | null;
  /** Every channel the org has, for the duplicate-name check. */
  channels: NotificationChannelView[];
  /** A write is in flight. The dialog stays open and inert until the server
   *  answers: closing early would leave the reader unsure it happened. */
  pending: boolean;
  onClose: () => void;
  onSave: (draft: ChannelDraft) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      {target && (
        // Remounted per opening, so the fields start from whatever opened
        // this one instead of holding the last opening's text.
        <ChannelForm
          key={target.mode === "new" ? `new:${target.name}` : target.channel.name}
          target={target}
          existingNames={channels.map((c) => c.name)}
          pending={pending}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </Dialog>
  );
}

/** Which footer button submitted: both run the same validation. */
type ChannelSubmit = { action: "save" | "test" };
const SAVE: ChannelSubmit = { action: "save" };
const TEST: ChannelSubmit = { action: "test" };

function ChannelForm({
  target,
  existingNames,
  pending,
  onSave,
  onDelete,
}: {
  target: ChannelTarget;
  existingNames: string[];
  pending: boolean;
  onSave: (draft: ChannelDraft) => void;
  onDelete: (name: string) => void;
}) {
  const editing = target.mode === "edit" ? target.channel : null;
  const storedType = editing?.config.type ?? null;
  // Deleting asks first, in place: a second dialog stacked on this one is
  // dismissed by the first as an outside press.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const test = useMutation({
    mutationFn: (config: AlertingChannelConfigInput) =>
      testAlertingChannel({
        data: {
          config,
          source: editing ? { kind: "saved", name: editing.name } : { kind: "new" },
        },
      }),
  });

  // Built once per opening: the draft mints row ids, and useForm resets an
  // untouched form whenever its default values change.
  const [defaultValues] = useState(() => ({
    name: target.mode === "new" ? target.name : target.channel.name,
    draft: editing ? channelConfigDraft(editing.config) : EMPTY_CHANNEL_DRAFT,
  }));
  const form = useForm({
    defaultValues,
    onSubmitMeta: SAVE,
    // Checked on Save or Send test, then again on each edit until it passes.
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: ({ value }) => {
        const read = readChannelDraft(value.draft, storedType);
        const fields: Record<string, string | undefined> = {};
        if ("errors" in read) {
          for (const [key, error] of Object.entries(read.errors)) fields[`draft.${key}`] = error;
        }
        const name = value.name.trim();
        if (!name) fields.name = "Name is required";
        else if (name !== editing?.name && existingNames.includes(name)) {
          fields.name = "A channel with this name already exists";
        }
        return Object.keys(fields).length > 0 ? { fields } : undefined;
      },
    },
    onSubmit: ({ value, meta }) => {
      const read = readChannelDraft(value.draft, storedType);
      if (!("config" in read)) return;
      if (meta.action === "test") test.mutate(read.config);
      else onSave({ name: value.name.trim(), config: read.config });
    },
    // A verdict on an endpoint the reader has since retyped is worse than none.
    listeners: {
      onChange: ({ fieldApi }) => {
        if (fieldApi.name !== "name") test.reset();
      },
    },
  });

  const type = useStore(form.store, (state) => state.values.draft.type);
  // On an edit of the stored kind, the secret starts behind an explicit Edit
  // action. A blank draft still means keep the stored secret.
  const keepsSecret = storedType === type;
  const urlField = CHANNEL_URL_FIELD[type];
  const busy = pending || test.isPending;

  if (editing && confirmingDelete) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {editing.name}?</DialogTitle>
          <DialogDescription>
            {editing.tiers.length > 0 ? "It drops out of the default destination. " : ""}
            A rule naming it directly keeps the name and delivers nothing until a channel with that
            name exists again. Past notifications keep its name in their record.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setConfirmingDelete(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={() => onDelete(editing.name)}
          >
            Delete channel
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit channel" : "New channel"}</DialogTitle>
        <DialogDescription>
          A channel is a named endpoint alerts deliver to. Secrets are write-only and never shown
          again after saving.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <form.Field name="name">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                value={field.state.value}
                disabled={busy}
                aria-invalid={field.state.meta.errors.length > 0 || undefined}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="#oncall"
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field name="draft.type">
          {(field) => (
            <div className="space-y-1.5">
              <Label htmlFor="channel-type">Type</Label>
              <OptionCombobox
                id="channel-type"
                value={field.state.value}
                disabled={busy}
                onChange={(v) => field.handleChange(v as ChannelType)}
                options={CHANNEL_OPTIONS}
              />
            </div>
          )}
        </form.Field>
        {urlField && (
          <form.Field name="draft.url">
            {(field) => (
              <div className="space-y-1.5">
                <Label htmlFor="channel-url">{urlField.label}</Label>
                <SecretInput
                  key={type}
                  id="channel-url"
                  type="url"
                  className="font-mono"
                  value={field.state.value}
                  disabled={busy}
                  hasStoredSecret={keepsSecret}
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  onValueChange={(url) => field.handleChange(url)}
                  placeholder={urlField.placeholder}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
        )}
        {type === "webhook" && (
          <form.Field name="draft.headers" mode="array">
            {(headers) => (
              <WebhookHeaders
                count={headers.state.value.length}
                errors={headers.state.meta.errors}
                disabled={busy}
                onAdd={() =>
                  headers.pushValue({
                    id: crypto.randomUUID(),
                    name: "",
                    value: "",
                    retainedName: null,
                  })
                }
              >
                {headers.state.value.map((header, index) => (
                  <li key={header.id} className="space-y-1.5 rounded-md border p-2">
                    <form.Field name={`draft.headers[${index}].name`}>
                      {(field) => (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <Label htmlFor={`channel-header-name-${index}`}>Name</Label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={busy}
                              aria-label={`Remove header ${header.name || index + 1}`}
                              onClick={() => headers.removeValue(index)}
                            >
                              <X />
                            </Button>
                          </div>
                          <Input
                            id={`channel-header-name-${index}`}
                            aria-invalid={field.state.meta.errors.length > 0 || undefined}
                            className="font-mono"
                            value={field.state.value}
                            disabled={busy}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="Authorization"
                            onChange={(event) => field.handleChange(event.target.value)}
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </>
                      )}
                    </form.Field>
                    <form.Field name={`draft.headers[${index}].value`}>
                      {(field) => (
                        <>
                          <Label htmlFor={`channel-header-value-${index}`}>Value</Label>
                          <SecretInput
                            id={`channel-header-value-${index}`}
                            aria-invalid={field.state.meta.errors.length > 0 || undefined}
                            className="font-mono"
                            value={field.state.value}
                            disabled={busy}
                            hasStoredSecret={keepsStoredHeader(header)}
                            autoComplete="off"
                            placeholder="Bearer token"
                            onValueChange={(value) => field.handleChange(value)}
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </>
                      )}
                    </form.Field>
                  </li>
                ))}
              </WebhookHeaders>
            )}
          </form.Field>
        )}
        {type === "telegram" && (
          <>
            <form.Field name="draft.botToken">
              {(field) => (
                <div className="space-y-1.5">
                  <Label htmlFor="channel-bot-token">Bot token</Label>
                  <SecretInput
                    key={type}
                    id="channel-bot-token"
                    className="font-mono"
                    value={field.state.value}
                    disabled={busy}
                    hasStoredSecret={keepsSecret}
                    aria-invalid={field.state.meta.errors.length > 0 || undefined}
                    onValueChange={(botToken) => field.handleChange(botToken)}
                    placeholder="123456789:ABC..."
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <form.Field name="draft.chatIds">
              {(field) => (
                <div className="space-y-1.5">
                  {/* Not a <label>: the tags input has no one control to point
                      at, and carries its own accessible name. */}
                  <span className="text-xs/relaxed leading-none font-medium">Chat IDs</span>
                  <TagsInput
                    aria-label="Chat IDs"
                    placeholder="-1001234567890"
                    value={field.state.value}
                    onValueChange={(chatIds) => field.handleChange(chatIds)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </>
        )}
        {(test.isSuccess || test.isError) && (
          <p
            role={test.data?.ok ? "status" : "alert"}
            className={cn("font-mono text-xs", test.data?.ok ? "text-chart-2" : "text-destructive")}
          >
            {test.data?.ok
              ? `Delivered in ${test.data.latency_ms}ms`
              : `Not delivered: ${test.data?.error ?? test.error?.message ?? "unknown error"}`}
          </p>
        )}
      </div>

      <DialogFooter className="flex-row flex-wrap items-center justify-start sm:justify-start">
        {editing && (
          <Button
            variant="ghost"
            disabled={busy}
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void form.handleSubmit(TEST)}>
            {test.isPending ? "Sending…" : "Send test"}
          </Button>
          <Button disabled={busy} aria-busy={pending} onClick={() => void form.handleSubmit(SAVE)}>
            {editing ? "Save channel" : "Create channel"}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function keepsStoredHeader(header: WebhookHeaderDraft): boolean {
  return (
    header.retainedName !== null &&
    header.name.trim().toLowerCase() === header.retainedName.trim().toLowerCase()
  );
}

/** The header list's frame: its label, the Add button, and the rows. */
function WebhookHeaders({
  count,
  errors,
  disabled,
  onAdd,
  children,
}: {
  count: number;
  errors: unknown[];
  disabled: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs/relaxed leading-none font-medium">Headers</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || count >= ALERTING_WEBHOOK_HEADERS_MAX}
          onClick={onAdd}
        >
          <Plus className="size-3.5" />
          Add header
        </Button>
      </div>
      {count > 0 && <ul className="space-y-2">{children}</ul>}
      <FieldError errors={errors} />
    </div>
  );
}

function FieldError({ errors }: { errors: unknown[] }) {
  if (errors.length === 0) return null;
  return (
    <p className="text-destructive text-xs" role="alert">
      {String(errors[0])}
    </p>
  );
}
