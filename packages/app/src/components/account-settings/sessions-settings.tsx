import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { RetryError } from "@everr/ui/components/retry-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { accountSessionsQueryOptions } from "./queries";

function deviceName(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown device";
  const browser = [
    [/Edg\//, "Edge"],
    [/OPR\//, "Opera"],
    [/Firefox\/|FxiOS\//, "Firefox"],
    [/Chrome\/|CriOS\//, "Chrome"],
    [/Safari\//, "Safari"],
  ] as const;
  const name = browser.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!name) return userAgent;
  const platform = [
    [/Android/, "Android"],
    [/iPhone|iPad/, "iOS"],
    [/Windows/, "Windows"],
    [/Macintosh/, "macOS"],
    [/Linux/, "Linux"],
  ] as const;
  const os = platform.find(([pattern]) => pattern.test(userAgent))?.[1];
  return os ? `${name} on ${os}` : name;
}

export function SessionsSettings({
  userId,
  currentSessionId,
}: {
  userId: string;
  currentSessionId: string;
}) {
  const queryClient = useQueryClient();
  const options = accountSessionsQueryOptions(userId);
  const sessions = useQuery(options);
  const revoke = useMutation({
    mutationFn: async (token: string | null) => {
      const result =
        token === null
          ? await authClient.revokeOtherSessions()
          : await authClient.revokeSession({ token });
      if (result.error)
        throw new Error(
          result.error.message ?? "Could not sign out the session.",
        );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
  });
  const hasOtherSessions = sessions.data?.some(
    (session) => session.id !== currentSessionId,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Manage your browser and CLI sessions. Your current session stays
          signed in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sessions.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading sessions...
          </p>
        )}
        {sessions.isError && (
          <RetryError
            variant="inline"
            title="Could not load sessions"
            message={sessions.error.message}
            onRetry={() => void sessions.refetch()}
          />
        )}
        {sessions.data && (
          <>
            <ul className="divide-y">
              {sessions.data.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p
                      className="break-all text-sm"
                      title={session.userAgent ?? undefined}
                    >
                      {deviceName(session.userAgent)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.ipAddress || "Unknown IP address"}
                      {" · Signed in "}
                      <time
                        dateTime={new Date(session.createdAt).toISOString()}
                      >
                        {new Date(session.createdAt).toLocaleString()}
                      </time>
                    </p>
                  </div>
                  {session.id === currentSessionId ? (
                    <Badge variant="secondary" className="shrink-0">
                      Current session
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(session.token)}
                    >
                      Sign out session
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              disabled={
                !hasOtherSessions || revoke.isPending || sessions.isFetching
              }
              onClick={() => revoke.mutate(null)}
            >
              Sign out other sessions
            </Button>
          </>
        )}
        {revoke.error && (
          <p role="alert" className="text-sm text-destructive">
            {revoke.error.message}
          </p>
        )}
        {revoke.isSuccess && (
          <p role="status" className="text-sm text-muted-foreground">
            Session sign-out completed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
