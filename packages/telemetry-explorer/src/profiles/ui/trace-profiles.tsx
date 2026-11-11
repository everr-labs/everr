import { Button } from "@everr/ui/components/button";
import { Cpu } from "lucide-react";
import type { ReactElement } from "react";
import type { TraceProfiles } from "../../traces/ui/viewer/viewer";
import type { ProfilesRepositoryLike } from "../data/repository";
import { profiledSpansForTrace, profilesSearchForTrace } from "../data/trace-link";
import { SpanProfile } from "./span-profile";

/**
 * The trace viewer's profiles: which spans have samples, links to them, and
 * the span Profile tab. The host renders the link to its Profiles route.
 */
export function traceProfiles(
  repo: ProfilesRepositoryLike,
  traceId: string,
  profilesLink: (search: ReturnType<typeof profilesSearchForTrace>) => ReactElement,
): TraceProfiles {
  return {
    profiledSpans: profiledSpansForTrace(repo),
    renderLink: (window, spanId) => (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={profilesLink(profilesSearchForTrace(traceId, window, spanId))}
      >
        <Cpu data-icon="inline-start" />
        {spanId ? "Span profile" : "Profiles"}
      </Button>
    ),
    renderSpanProfile: (target) => <SpanProfile repo={repo} {...target} />,
  };
}
